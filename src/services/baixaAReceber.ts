import { db } from '../config/database';
import { logFinancialAudit } from './FinancialAuditService';

/**
 * Baixa (marcar como recebido) dos itens do A Receber de cliente — uma só regra
 * para as telas (rotas) e para o assistente do WhatsApp (desde 08/10/2026):
 *  - 'lancamento' → financial_records
 *  - 'parcela'    → installments (parcelas de proposta) + recibo por e-mail
 *  - 'contrato'   → parcelas de contrato: registra recebimento, recalcula a
 *                   receita-mãe, resolve inadimplência e grava auditoria.
 */
export type FonteCliente = 'lancamento' | 'parcela' | 'contrato';
export type ResultadoBaixa = 'ok' | 'ja_pago' | 'nao_encontrado';
export interface Ator { id: number | null; name: string; ip?: string | null }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recalcula total_recebido / saldo_pendente / status da receita a partir das parcelas pagas. */
export async function recalcReceita(receitaId: number): Promise<void> {
  const [[r]] = await db.query('SELECT valor FROM receitas WHERE id = ?', [receitaId]) as any;
  if (!r) return;
  const [[agg]] = await db.query(
    `SELECT COALESCE(SUM(rb.valor), 0) AS recebido
       FROM recebimentos rb
       JOIN parcelas p ON p.id = rb.parcela_id
      WHERE p.receita_id = ?`, [receitaId]
  ) as any;
  const recebido = Number(agg.recebido);
  const saldo = round2(Number(r.valor) - recebido);
  const status = recebido <= 0 ? 'aberto' : (recebido >= Number(r.valor) ? 'recebido' : 'parcial');
  await db.query(
    'UPDATE receitas SET total_recebido = ?, saldo_pendente = ?, status = ? WHERE id = ?',
    [round2(recebido), saldo, status, receitaId]
  );
}

const METODOS = ['pix', 'transferencia', 'boleto', 'cartao', 'cheque', 'dinheiro'];

/** Baixa de parcela de CONTRATO (POST /api/parcelas/:id/pagar e assistente). */
export async function pagarParcelaContrato(
  id: number,
  opts: { data?: string | null; valor?: number | null; metodo?: string | null; comprovante?: string | null },
  ator: Ator,
): Promise<{ resultado: ResultadoBaixa; parcela: any }> {
  const [existing] = await db.query('SELECT * FROM parcelas WHERE id = ?', [id]) as any;
  if (!existing.length) return { resultado: 'nao_encontrado', parcela: null };
  const prev = existing[0];
  if (prev.status === 'pago') return { resultado: 'ja_pago', parcela: prev };

  const dataPg = opts.data || new Date().toISOString().split('T')[0];
  const valorPago = opts.valor !== undefined && opts.valor !== null ? Number(opts.valor) : Number(prev.valor_final);
  const metodoPg = METODOS.includes(String(opts.metodo)) ? String(opts.metodo) : 'pix';

  await db.query(
    'INSERT INTO recebimentos (parcela_id, data, valor, metodo, comprovante) VALUES (?, ?, ?, ?, ?)',
    [id, dataPg, valorPago, metodoPg, opts.comprovante ?? null]
  );
  await db.query(
    'UPDATE parcelas SET status = ?, data_pagamento = ?, comprovante = COALESCE(?, comprovante) WHERE id = ?',
    ['pago', dataPg, opts.comprovante ?? null, id]
  );
  await recalcReceita(prev.receita_id);
  await db.query(
    "UPDATE inadimplencias SET status = 'resolvido', data_resolucao = NOW() WHERE parcela_id = ? AND status <> 'resolvido'",
    [id]
  );
  await logFinancialAudit({
    entityType: 'Parcela', entityId: Number(id), action: 'paid',
    userId: ator.id, userName: ator.name, receitaId: prev.receita_id, parcelaId: Number(id),
    oldStatus: prev.status, newStatus: 'pago', newValue: valorPago,
    reason: `Parcela ${prev.numero} paga (${metodoPg})`, ipAddress: ator.ip ?? null,
  });
  const [rows] = await db.query('SELECT * FROM parcelas WHERE id = ?', [id]) as any;
  return { resultado: 'ok', parcela: rows[0] };
}

/** Baixa de lançamento (financial_records). Sem data = agora. */
export async function pagarLancamento(id: number, data?: string | null): Promise<ResultadoBaixa> {
  const [[r]] = await db.query('SELECT status FROM financial_records WHERE id = ?', [id]) as any;
  if (!r) return 'nao_encontrado';
  if (r.status === 'pago') return 'ja_pago';
  await db.query("UPDATE financial_records SET status = 'pago', paid_at = COALESCE(?, NOW()) WHERE id = ?", [data || null, id]);
  return 'ok';
}

/** Baixa de parcela de proposta (installments) + recibo por e-mail ao cliente (best-effort). */
export async function pagarInstallment(id: number, data?: string | null): Promise<ResultadoBaixa> {
  const [[r]] = await db.query('SELECT status FROM installments WHERE id = ?', [id]) as any;
  if (!r) return 'nao_encontrado';
  if (r.status === 'pago') return 'ja_pago';
  await db.query("UPDATE installments SET status = 'pago', paid_at = COALESCE(?, NOW()) WHERE id = ?", [data || null, id]);
  try {
    const [[info]] = await db.query(
      `SELECT i.valor, i.numero, cl.name, cl.email, pr.title AS proposta
         FROM installments i
         JOIN clients cl ON cl.id = i.client_id
         LEFT JOIN propostas pr ON pr.id = i.proposta_id
        WHERE i.id = ?`, [id]) as any;
    if (info?.email && info.email.includes('@')) {
      const { sendReceipt } = await import('./EmailService');
      sendReceipt(info.email, {
        name: info.name,
        valor: Number(info.valor),
        referencia: `${info.numero ? info.numero + 'ª parcela' : 'Parcela'}${info.proposta ? ` — ${info.proposta}` : ''}`,
        pagoEm: data ? new Date(data + 'T12:00:00') : new Date(),
        numeroRecibo: `I${id}-${new Date().getFullYear()}`,
      }).catch(() => {});
    }
  } catch { /* recibo é best-effort */ }
  return 'ok';
}

export async function baixarItemCliente(fonte: string, id: number, opts: { data?: string | null; valor?: number | null }, ator: Ator): Promise<ResultadoBaixa> {
  if (fonte === 'lancamento') return pagarLancamento(id, opts.data);
  if (fonte === 'parcela') return pagarInstallment(id, opts.data);
  if (fonte === 'contrato') return (await pagarParcelaContrato(id, { data: opts.data, valor: opts.valor, metodo: 'pix' }, ator)).resultado;
  return 'nao_encontrado';
}

export interface ItemAbertoCliente { fonte: FonteCliente; id: number; descricao: string; valor: number; vencimento: string | null }

/** Tudo o que o cliente ainda deve (as 3 fontes de cliente do A Receber), vencimento mais antigo primeiro. */
export async function abertosDoCliente(clientId: number): Promise<ItemAbertoCliente[]> {
  const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const out: ItemAbertoCliente[] = [];
  const [fr] = await db.query(
    `SELECT id, description, valor, due_date FROM financial_records
      WHERE client_id = ? AND tipo = 'receita' AND status IN ('pendente','vencido')`, [clientId]) as any;
  for (const r of fr) out.push({ fonte: 'lancamento', id: r.id, descricao: r.description, valor: Number(r.valor) || 0, vencimento: iso(r.due_date) });
  const [inst] = await db.query(
    `SELECT i.id, i.numero, i.valor, i.due_date, p.title FROM installments i LEFT JOIN propostas p ON p.id = i.proposta_id
      WHERE i.client_id = ? AND i.status IN ('pendente','em_processamento','vencido')`, [clientId]) as any;
  for (const r of inst) out.push({ fonte: 'parcela', id: r.id, descricao: `${r.numero}ª parcela${r.title ? ' — ' + r.title : ''}`, valor: Number(r.valor) || 0, vencimento: iso(r.due_date) });
  const [parc] = await db.query(
    `SELECT pa.id, pa.numero, pa.total_parcelas, pa.valor_final, pa.data_vencimento, re.descricao
       FROM parcelas pa JOIN receitas re ON re.id = pa.receita_id
      WHERE re.client_id = ? AND pa.status IN ('aberto','atrasado','parcial')`, [clientId]).catch(() => [[]]) as any;
  for (const r of parc) out.push({ fonte: 'contrato', id: r.id, descricao: `${r.numero}/${r.total_parcelas}${r.descricao ? ' — ' + r.descricao : ''}`, valor: Number(r.valor_final) || 0, vencimento: iso(r.data_vencimento) });
  return out.sort((a, b) => String(a.vencimento || '9').localeCompare(String(b.vencimento || '9')));
}
