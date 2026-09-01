import crypto from 'crypto';
import { db } from '../config/database';

/**
 * Fatura do Cartão — importa o CSV da fatura Nubank (formato diferente do
 * extrato da conta: date,title,amount — sem Identificador único, valor em
 * "1.234,56"/"- 150,00") e categoriza por comerciante.
 *
 * DELIBERADAMENTE não grava em cashflow_entries: o valor total da fatura
 * já é uma saída no Extrato Consolidado ("Pagamento de fatura", quando o
 * cartão é pago pela conta corrente). Isto aqui é só o detalhamento de uma
 * saída que já existe — nunca deve entrar de novo no saldo real.
 */

export const CARD_CATEGORY_PT: Record<string, string> = {
  mercado: 'Mercado', farmacia: 'Farmácia', alimentacao: 'Alimentação',
  compras_online: 'Compras online', vestuario: 'Vestuário', combustivel: 'Combustível',
  transporte: 'Transporte', viagem: 'Viagem', assinaturas: 'Assinaturas', pet: 'Pet',
  pagamento_estorno: 'Pagamento / Estorno', outro: 'Outros',
};

export interface CardRow { date: string; title: string; amount: number; }

// Parser genérico de CSV (RFC4180-ish): a fatura tem campos entre aspas
// com vírgula/aspas escapadas dentro ("Estorno de ""X"" (Y)") — o truque
// de cortar por posição fixa (usado no extrato da conta) não serve aqui.
export function parseCsvGeneric(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; const next = s[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; continue; }
      if (c === '"') { inQuotes = false; continue; }
      field += c; continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim().length));
}

function parseBrValor(raw: string): number {
  const clean = String(raw).replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  return Number(clean);
}

export interface ParseCardResult { rows: CardRow[]; billRefMonth: string; }

export function parseCardCsv(csvText: string, filename?: string): ParseCardResult {
  const table = parseCsvGeneric(csvText);
  if (!table.length) throw new Error('Arquivo CSV vazio');
  const header = table[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('date') || !header.includes('title') || !header.includes('amount')) {
    throw new Error('Formato de CSV não reconhecido — esperado cabeçalho "date,title,amount" (fatura Nubank)');
  }
  const iDate = header.indexOf('date'), iTitle = header.indexOf('title'), iAmount = header.indexOf('amount');

  const rows: CardRow[] = [];
  for (const r of table.slice(1)) {
    const date = String(r[iDate] || '').trim();
    const title = String(r[iTitle] || '').trim();
    const amount = parseBrValor(r[iAmount] || '');
    if (!date || !title || Number.isNaN(amount)) continue;
    rows.push({ date, title, amount });
  }
  if (rows.length > 5000) throw new Error('Arquivo tem linhas demais — confirme se é o arquivo certo');

  // O nome do arquivo do Nubank já traz a data de vencimento da fatura
  // (ex.: Nubank_2026-09-08.csv → vence 08/09/2026 → mês de referência 09).
  const m = /(\d{4})-(\d{2})-\d{2}/.exec(filename || '');
  const billRefMonth = m ? `${m[1]}-${m[2]}` : new Date().toISOString().slice(0, 7);

  return { rows, billRefMonth };
}

function rowHash(row: CardRow, billRefMonth: string): string {
  return crypto.createHash('sha256').update(`${row.date}|${row.title}|${row.amount}|${billRefMonth}`).digest('hex');
}

// "- Parcela 3/6" no fim do título — extrai e devolve o título limpo, pra
// não atrapalhar o match de categoria por comerciante.
function extractParcela(title: string): { clean: string; no: number | null; total: number | null } {
  const m = / - Parcela (\d+)\/(\d+)\s*$/i.exec(title);
  if (!m) return { clean: title, no: null, total: null };
  return { clean: title.slice(0, m.index).trim(), no: Number(m[1]), total: Number(m[2]) };
}

export async function matchCardCategory(title: string): Promise<{ category: string; label: string | null } | null> {
  const [rules] = await db.query(
    'SELECT match_value, category, label_override FROM card_statement_rules WHERE active = 1'
  ) as any;
  const up = title.toUpperCase();
  const hit = rules.find((r: any) => up.includes(String(r.match_value).toUpperCase()));
  return hit ? { category: hit.category, label: hit.label_override } : null;
}

export interface CardImportResult {
  import_id: number; bill_ref_month: string;
  total: number; imported: number; duplicates: number; pending: number;
}

export async function importCardStatement(csvText: string, filename: string | null, userId: number): Promise<CardImportResult> {
  const { rows, billRefMonth } = parseCardCsv(csvText, filename || undefined);
  if (!rows.length) throw new Error('Nenhuma linha válida encontrada no CSV');

  const hashes = rows.map((r) => rowHash(r, billRefMonth));
  const [existingRows] = await db.query(
    `SELECT row_hash FROM card_statement_entries WHERE row_hash IN (${hashes.map(() => '?').join(',')})`, hashes
  ) as any;
  const existing = new Set(existingRows.map((r: any) => r.row_hash));

  let imported = 0, pending = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; const hash = hashes[i];
    if (existing.has(hash)) continue;

    const isPaymentOrRefund = row.amount < 0;
    const { clean, no, total } = extractParcela(row.title);

    let category: string; let reviewStatus: 'ok' | 'pendente';
    if (isPaymentOrRefund) {
      category = 'pagamento_estorno'; reviewStatus = 'ok';
    } else {
      const match = await matchCardCategory(clean);
      if (match) { category = match.category; reviewStatus = 'ok'; }
      else { category = 'outro'; reviewStatus = 'pendente'; pending++; }
    }

    await db.query(
      `INSERT INTO card_statement_entries
         (purchase_date, title, amount, is_payment_or_refund, installment_no, installment_total,
          category, review_status, bill_ref_month, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.date, row.title, Math.abs(row.amount), isPaymentOrRefund ? 1 : 0, no, total,
       category, reviewStatus, billRefMonth, hash]
    );
    imported++;
  }

  const duplicates = rows.length - imported;
  const [ins] = await db.query(
    `INSERT INTO card_statement_imports (filename, bill_ref_month, total_rows, imported_rows, duplicate_rows, pending_rows)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [filename || null, billRefMonth, rows.length, imported, duplicates, pending]
  ) as any;

  return { import_id: ins.insertId, bill_ref_month: billRefMonth, total: rows.length, imported, duplicates, pending };
}

export async function getCardSummary(billRefMonth: string) {
  const [rows] = await db.query(
    `SELECT category, is_payment_or_refund, SUM(amount) AS total, COUNT(*) AS n
       FROM card_statement_entries WHERE bill_ref_month = ? GROUP BY category, is_payment_or_refund`,
    [billRefMonth]
  ) as any;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  let totalGasto = 0, totalPagoEstornado = 0;
  const porCategoria: { category: string; label: string; total: number; n: number }[] = [];
  for (const r of rows) {
    const total = Number(r.total) || 0;
    if (r.is_payment_or_refund) { totalPagoEstornado += total; continue; }
    totalGasto += total;
    porCategoria.push({ category: r.category, label: CARD_CATEGORY_PT[r.category] || r.category, total: round2(total), n: Number(r.n) });
  }
  porCategoria.sort((a, b) => b.total - a.total);

  const [pendCount] = await db.query(
    "SELECT COUNT(*) AS n FROM card_statement_entries WHERE bill_ref_month = ? AND review_status = 'pendente'", [billRefMonth]
  ) as any;

  return {
    bill_ref_month: billRefMonth,
    total_gasto: round2(totalGasto),
    total_pago_estornado: round2(totalPagoEstornado),
    por_categoria: porCategoria,
    pendentes: pendCount[0]?.n || 0,
  };
}

export async function getCardEntries(billRefMonth: string) {
  const [rows] = await db.query(
    `SELECT id, purchase_date, title, amount, is_payment_or_refund, installment_no, installment_total,
            category, review_status
       FROM card_statement_entries WHERE bill_ref_month = ? ORDER BY purchase_date DESC, id DESC LIMIT 1000`,
    [billRefMonth]
  ) as any;
  return rows.map((r: any) => ({ ...r, amount: Number(r.amount), label: CARD_CATEGORY_PT[r.category] || r.category }));
}

export async function getCardPendentes(billRefMonth?: string) {
  const where = ["review_status = 'pendente'"]; const params: any[] = [];
  if (billRefMonth) { where.push('bill_ref_month = ?'); params.push(billRefMonth); }
  const [rows] = await db.query(
    `SELECT id, purchase_date, title, amount, installment_no, installment_total
       FROM card_statement_entries WHERE ${where.join(' AND ')} ORDER BY purchase_date ASC LIMIT 500`,
    params
  ) as any;
  return rows.map((r: any) => ({ ...r, amount: Number(r.amount) }));
}

export async function reviewCardEntry(id: number, category: string, saveAsRule: boolean): Promise<void> {
  const [rows] = await db.query('SELECT title FROM card_statement_entries WHERE id = ?', [id]) as any;
  if (!rows.length) throw Object.assign(new Error('Lançamento não encontrado'), { status: 404 });

  await db.query("UPDATE card_statement_entries SET category = ?, review_status = 'ok' WHERE id = ?", [category, id]);

  if (saveAsRule) {
    const { clean } = extractParcela(rows[0].title);
    // Usa um trecho estável do título (antes de qualquer sufixo de loja
    // tipo "Mp *Fulano123") como padrão — aqui, o título limpo inteiro.
    await db.query(
      `INSERT INTO card_statement_rules (match_value, category) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE active = 1`,
      [clean, category]
    );
  }
}
