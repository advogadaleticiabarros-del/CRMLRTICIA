import { db } from '../config/database';
import { CATEGORY_PT } from './cashflowService';

/**
 * Extrato Consolidado — importa o CSV mensal do Nubank, categoriza
 * automaticamente por regras aprendidas (bank_statement_rules) e grava
 * como cashflow_entries reais (status='realizado'), reaproveitando a
 * mesma tabela/categorias que o Fluxo de Caixa já usa — não um sistema
 * paralelo. Ver migrations/126_bank_statement_import.sql para o porquê
 * de cada coluna nova.
 */

export interface ParsedRow {
  data: string;         // YYYY-MM-DD
  valor: number;        // sinal original: negativo = saída, positivo = entrada
  identificador: string;
  descricao: string;
}

const MAX_ROWS = 5000;

function toIsoDate(dmy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

// Descrição é sempre o último campo — cortar só nas 3 primeiras vírgulas
// evita quebrar quando o texto do banco tiver vírgula dentro (nomes de
// empresa, endereço etc.).
function splitCsvLine(line: string): string[] | null {
  const i1 = line.indexOf(',');
  if (i1 < 0) return null;
  const i2 = line.indexOf(',', i1 + 1);
  if (i2 < 0) return null;
  const i3 = line.indexOf(',', i2 + 1);
  if (i3 < 0) return null;
  return [line.slice(0, i1), line.slice(i1 + 1, i2), line.slice(i2 + 1, i3), line.slice(i3 + 1)];
}

export interface ParseWarning { line: number; reason: string; }
export interface ParseResult { rows: ParsedRow[]; warnings: ParseWarning[]; }

export function parseNubankCsv(csvText: string): ParseResult {
  const text = String(csvText || '').replace(/^﻿/, '');
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.length) throw new Error('Arquivo CSV vazio');

  const header = lines[0].toLowerCase();
  if (!header.includes('data') || !header.includes('valor') || !header.includes('identificador') || !header.includes('descri')) {
    throw new Error('Formato de CSV não reconhecido — esperado cabeçalho "Data,Valor,Identificador,Descrição" (extrato Nubank)');
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_ROWS) {
    throw new Error(`Arquivo tem ${dataLines.length} linhas — limite de ${MAX_ROWS} por importação. Confirme se é o arquivo certo.`);
  }

  const rows: ParsedRow[] = [];
  const warnings: ParseWarning[] = [];

  dataLines.forEach((line, idx) => {
    const parts = splitCsvLine(line);
    if (!parts) { warnings.push({ line: idx + 2, reason: 'linha com formato inesperado (ignorada)' }); return; }
    const [rawData, rawValor, rawId, rawDescricao] = parts;
    const data = toIsoDate(rawData);
    const valor = Number(String(rawValor).trim().replace(',', '.'));
    const identificador = rawId.trim();
    const descricao = rawDescricao.trim();
    if (!data) { warnings.push({ line: idx + 2, reason: 'data inválida (ignorada)' }); return; }
    if (Number.isNaN(valor)) { warnings.push({ line: idx + 2, reason: 'valor inválido (ignorada)' }); return; }
    if (!identificador) { warnings.push({ line: idx + 2, reason: 'sem Identificador — não é possível conferir duplicidade (ignorada)' }); return; }
    rows.push({ data, valor, identificador, descricao });
  });

  return { rows, warnings };
}

// Heurística: tira prefixos padrão do Nubank e blocos de CPF/CNPJ/agência
// pra sobrar só o nome — usada tanto pro matching de regra quanto pra
// exibição. É "melhor esforço", não identidade formal.
const PREFIXES = [
  /^Transferência enviada pelo Pix - /i,
  /^Transferência recebida pelo Pix - /i,
  /^Transferência Recebida - /i,
  /^Transferência enviada - /i,
  /^Reembolso recebido pelo Pix - /i,
  /^Compra no débito - /i,
];

export function extractCounterparty(descricao: string): string {
  let s = String(descricao || '').trim();
  for (const p of PREFIXES) s = s.replace(p, '');
  // corta a partir do primeiro bloco "- 12.345.678/..." (CNPJ) ou "- •••.123.456-••" (CPF mascarado)
  s = s.split(/ - \d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)[0];
  s = s.split(/ - •••\.\d{3}\.\d{3}-••/)[0];
  return s.trim();
}

export function normalizeCounterparty(s: string): string {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export interface RuleCandidate { type: 'entrada' | 'saida'; category: string; escopo: string; is_transferencia_interna: boolean; label_override: string | null; }
export interface RuleMatch { status: 'matched' | 'ambiguous' | 'unmatched'; rule?: RuleCandidate; candidates?: RuleCandidate[]; }

export async function matchRule(counterparty: string, descricaoCrua: string, type?: 'entrada' | 'saida'): Promise<RuleMatch> {
  const norm = normalizeCounterparty(counterparty);

  // A direção (entrada/saída) já é conhecida com certeza pelo sinal do valor
  // no CSV — filtrar por ela aqui evita colisão entre regras "opostas" do
  // mesmo texto (ex.: "Aplicação RDB" e "Resgate RDB" contêm "RDB" nas
  // duas direções; sem esse filtro, toda transação de RDB virava ambígua).
  const typeFilter = type ? ' AND type = ?' : '';
  const typeParams = type ? [type] : [];

  const [exact] = await db.query(
    `SELECT type, category, escopo, is_transferencia_interna, label_override
       FROM bank_statement_rules
      WHERE active = 1 AND match_type = 'counterparty' AND UPPER(match_value) = ?${typeFilter}`,
    [norm, ...typeParams]
  ) as any;

  let candidates: any[] = exact;
  if (!candidates.length) {
    const [contains] = await db.query(
      `SELECT type, category, escopo, is_transferencia_interna, label_override, match_value
         FROM bank_statement_rules
        WHERE active = 1 AND match_type = 'contains'${typeFilter}`,
      typeParams
    ) as any;
    candidates = contains.filter((r: any) => descricaoCrua.toUpperCase().includes(String(r.match_value).toUpperCase()));
  }

  if (!candidates.length) return { status: 'unmatched' };

  const distinct = new Map<string, any>();
  for (const c of candidates) distinct.set(`${c.type}|${c.category}|${c.escopo}`, c);
  const list: RuleCandidate[] = [...distinct.values()].map((c) => ({
    type: c.type, category: c.category, escopo: c.escopo,
    is_transferencia_interna: !!c.is_transferencia_interna, label_override: c.label_override,
  }));

  if (list.length === 1) return { status: 'matched', rule: list[0] };
  return { status: 'ambiguous', candidates: list };
}

export interface ImportResult {
  import_id: number; ref_month: string;
  total: number; imported: number; duplicates: number; pending: number;
  warnings: ParseWarning[];
}

function modeMonth(rows: ParsedRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) { const ym = r.data.slice(0, 7); counts.set(ym, (counts.get(ym) || 0) + 1); }
  let best = ''; let bestN = -1;
  for (const [ym, n] of counts) if (n > bestN) { best = ym; bestN = n; }
  return best;
}

export async function importStatement(csvText: string, filename: string | null, userId: number): Promise<ImportResult> {
  const { rows, warnings } = parseNubankCsv(csvText);
  if (!rows.length) throw new Error('Nenhuma linha válida encontrada no CSV');

  const refMonth = modeMonth(rows);
  const refs = rows.map((r) => r.identificador);
  const [existingRows] = await db.query(
    `SELECT bank_ref FROM cashflow_entries WHERE bank_ref IN (${refs.map(() => '?').join(',')})`, refs
  ) as any;
  const existing = new Set(existingRows.map((r: any) => r.bank_ref));

  let imported = 0; let pending = 0;
  for (const row of rows) {
    if (existing.has(row.identificador)) continue;

    const counterparty = extractCounterparty(row.descricao);
    const type: 'entrada' | 'saida' = row.valor < 0 ? 'saida' : 'entrada';
    const match = await matchRule(counterparty, row.descricao, type);

    let category: string; let escopo: string; let isTransf = 0; let reviewStatus: 'ok' | 'pendente'; let description: string;
    if (match.status === 'matched' && match.rule) {
      category = match.rule.category; escopo = match.rule.escopo;
      isTransf = match.rule.is_transferencia_interna ? 1 : 0;
      reviewStatus = 'ok';
      description = match.rule.label_override || row.descricao;
    } else {
      category = type === 'entrada' ? 'outro_entrada' : 'outro_saida';
      escopo = 'empresa';
      reviewStatus = 'pendente';
      description = row.descricao;
      pending++;
    }

    await db.query(
      `INSERT INTO cashflow_entries
         (user_id, type, category, description, amount, due_date, status, paid_at,
          escopo, pagador, banco, bank_ref, counterparty, is_transferencia_interna, origin, review_status)
       VALUES (?, ?, ?, ?, ?, ?, 'realizado', ?, ?, NULL, 'Nubank', ?, ?, ?, 'extrato_nubank', ?)`,
      [userId, type, category, description, Math.abs(row.valor), row.data, row.data,
       escopo, row.identificador, counterparty, isTransf, reviewStatus]
    );
    imported++;
  }

  const duplicates = rows.length - imported;
  const [ins] = await db.query(
    `INSERT INTO bank_statement_imports (filename, ref_month, total_rows, imported_rows, duplicate_rows, pending_rows, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [filename || null, refMonth, rows.length, imported, duplicates, pending, userId]
  ) as any;

  return { import_id: ins.insertId, ref_month: refMonth, total: rows.length, imported, duplicates, pending, warnings };
}

export class RuleConflictError extends Error {
  existing: { type: string; category: string; escopo: string }[];
  constructor(existing: { type: string; category: string; escopo: string }[]) {
    super('Já existe outra categoria cadastrada para esse nome');
    this.existing = existing;
  }
}

export async function saveRuleFromReview(params: {
  id: number; category: string; escopo: string; saveAsRule?: boolean; forceAmbiguous?: boolean; userId: number;
}): Promise<{ rule_created: boolean }> {
  const { id, category, escopo, saveAsRule, forceAmbiguous, userId } = params;

  const [rows] = await db.query('SELECT * FROM cashflow_entries WHERE id = ?', [id]) as any;
  if (!rows.length) throw Object.assign(new Error('Lançamento não encontrado'), { status: 404 });
  const entry = rows[0];

  await db.query(
    "UPDATE cashflow_entries SET category = ?, escopo = ?, review_status = 'ok' WHERE id = ?",
    [category, escopo, id]
  );

  let ruleCreated = false;
  if (saveAsRule && entry.counterparty) {
    const norm = normalizeCounterparty(entry.counterparty);
    const [existingRules] = await db.query(
      `SELECT DISTINCT type, category, escopo FROM bank_statement_rules
        WHERE active = 1 AND match_type = 'counterparty' AND UPPER(match_value) = ?`,
      [norm]
    ) as any;

    const alreadyThisOne = existingRules.some((r: any) => r.type === entry.type && r.category === category && r.escopo === escopo);
    if (!alreadyThisOne) {
      if (existingRules.length > 0 && !forceAmbiguous) {
        throw new RuleConflictError(existingRules);
      }
      await db.query(
        `INSERT INTO bank_statement_rules (match_type, match_value, type, category, escopo, created_by)
         VALUES ('counterparty', ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE active = 1, updated_at = CURRENT_TIMESTAMP`,
        [entry.counterparty, entry.type, category, escopo, userId]
      );
      ruleCreated = true;
    }
  }

  return { rule_created: ruleCreated };
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endD = new Date(y, m, 1);
  const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-01`;
  return { start, end };
}

export interface SummaryFilters { category?: string; escopo?: string; counterparty?: string; type?: string; }

function buildFilterWhere(month: string, filters: SummaryFilters): { where: string[]; params: any[] } {
  const { start, end } = monthBounds(month);
  const where: string[] = ["origin = 'extrato_nubank'", 'due_date >= ?', 'due_date < ?'];
  const params: any[] = [start, end];
  if (filters.type === 'entrada' || filters.type === 'saida') { where.push('type = ?'); params.push(filters.type); }
  if (filters.category) { where.push('category = ?'); params.push(filters.category); }
  if (filters.escopo === 'empresa' || filters.escopo === 'pessoal') { where.push('escopo = ?'); params.push(filters.escopo); }
  if (filters.counterparty) { where.push('counterparty LIKE ?'); params.push(`%${filters.counterparty}%`); }
  return { where, params };
}

// Lista os lançamentos do mês um a um — o extrato de fato (data, descrição,
// contraparte, categoria, valor), não só o resumo agregado. É o que a tela
// mostra quando ela clica num mês específico.
export async function getEntries(month: string, filters: SummaryFilters = {}) {
  const { where, params } = buildFilterWhere(month, filters);
  const [rows] = await db.query(
    `SELECT id, due_date, description, counterparty, category, type, escopo,
            amount, is_transferencia_interna, review_status
       FROM cashflow_entries
      WHERE ${where.join(' AND ')}
      ORDER BY due_date ASC, id ASC
      LIMIT 1000`,
    params
  ) as any;
  return rows.map((r: any) => ({ ...r, amount: Number(r.amount), label: CATEGORY_PT[r.category] || r.category }));
}

export async function getConsolidatedSummary(month: string, filters: SummaryFilters = {}) {
  const { where, params } = buildFilterWhere(month, filters);

  const [rows] = await db.query(
    `SELECT category, type, escopo, counterparty, is_transferencia_interna, review_status,
            SUM(amount) AS total, COUNT(*) AS n
       FROM cashflow_entries
      WHERE ${where.join(' AND ')}
      GROUP BY category, type, escopo, counterparty, is_transferencia_interna, review_status`,
    params
  ) as any;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  let entradasReais = 0, saidasReais = 0, rdbAportes = 0, rdbResgates = 0;
  const porCategoria = new Map<string, { category: string; label: string; type: string; total: number }>();

  for (const r of rows) {
    const total = Number(r.total) || 0;
    if (r.is_transferencia_interna) {
      if (r.type === 'entrada') rdbResgates += total; else rdbAportes += total;
      continue;
    }
    if (r.type === 'entrada') entradasReais += total; else saidasReais += total;
    const key = `${r.type}|${r.category}`;
    const cur = porCategoria.get(key) || { category: r.category, label: CATEGORY_PT[r.category] || r.category, type: r.type, total: 0 };
    cur.total += total;
    porCategoria.set(key, cur);
  }

  const [pendCount] = await db.query(
    `SELECT COUNT(*) AS n FROM cashflow_entries WHERE ${where.join(' AND ')} AND review_status = 'pendente'`,
    params
  ) as any;

  return {
    month,
    kpis: {
      entradas_reais: round2(entradasReais),
      saidas_reais: round2(saidasReais),
      saldo_real: round2(entradasReais - saidasReais),
      // saldo = quanto a reserva CRESCEU no mês (aportes − resgates). Positivo
      // = guardou mais do que tirou. É o oposto do efeito na conta corrente
      // (aportes saem da conta) — de propósito: aqui o número é sobre a
      // reserva, não sobre o caixa do dia a dia.
      reserva_rdb: { aportes: round2(rdbAportes), resgates: round2(rdbResgates), saldo: round2(rdbAportes - rdbResgates) },
    },
    por_categoria: [...porCategoria.values()].map((c) => ({ ...c, total: round2(c.total) })).sort((a, b) => b.total - a.total),
    pendentes: pendCount[0]?.n || 0,
  };
}

export async function getMonthlySeries(fromMonth: string, months: number) {
  const out: { label: string; a: number; b: number }[] = [];
  const [y, m] = fromMonth.split('-').map(Number);
  for (let i = 0; i < months; i++) {
    const d = new Date(y, m - 1 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const s = await getConsolidatedSummary(ym);
    out.push({ label: ym, a: s.kpis.entradas_reais, b: s.kpis.saidas_reais });
  }
  return out;
}

export interface PendenteRow {
  id: number; due_date: string; description: string; counterparty: string | null;
  amount: number; type: string; category: string; escopo: string;
  candidates: RuleCandidate[];
}

export async function getPendentes(month?: string): Promise<PendenteRow[]> {
  const where: string[] = ["origin = 'extrato_nubank'", "review_status = 'pendente'"];
  const params: any[] = [];
  if (month) { const { start, end } = monthBounds(month); where.push('due_date >= ?', 'due_date < ?'); params.push(start, end); }

  const [rows] = await db.query(
    `SELECT id, due_date, description, counterparty, amount, type, category, escopo
       FROM cashflow_entries WHERE ${where.join(' AND ')} ORDER BY due_date ASC LIMIT 500`,
    params
  ) as any;

  const out: PendenteRow[] = [];
  for (const r of rows) {
    let candidates: RuleCandidate[] = [];
    if (r.counterparty) {
      const match = await matchRule(r.counterparty, r.description, r.type);
      if (match.status === 'ambiguous') candidates = match.candidates || [];
    }
    out.push({ ...r, amount: Number(r.amount), candidates });
  }
  return out;
}
