import { db } from '../config/database';

/**
 * Resumo financeiro CONSOLIDADO — todas as frentes de trabalho num só número.
 *
 * ANTES ESTAVA ERRADO: o /summary somava só financial_records (filtrado por
 * user_id, escondendo lançamentos dos outros usuários) + installments.
 * Dativas, correspondente, parcelas de contratos e repasses ficavam FORA da
 * Visão Geral — só apareciam na aba Fluxo de Caixa.
 *
 * Fontes (mesmo modelo do cashflowService, que é a referência completa):
 *  ENTRADAS: financial_records (receita) · installments · parcelas ·
 *            dative_payments · correspondent_hearings
 *  SAÍDAS:   financial_records (despesa) · repasses
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const N = (x: any) => Number(x) || 0;

export interface OrigemResumo {
  origem: string;
  label: string;
  previsto: number;   // pendente/a receber
  realizado: number;  // recebido/pago
  vencido: number;    // pendente com vencimento no passado
}

export async function getFinanceSummary() {
  const one = async (sql: string, params: any[] = []) => {
    const [[r]] = await db.query(sql, params) as any; return r;
  };

  // ── ENTRADAS por origem ────────────────────────────────────────────────────
  // Parcerias = receitas ligadas a caso com partner_id (entrada, êxito, sucumbência).
  // Clientes próprios = receitas avulsas sem parceiro + parcelas de propostas/contratos.
  const recFR = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN fr.status='pendente' AND (c.partner_id IS NULL) THEN fr.valor END),0) AS prop_prev,
      COALESCE(SUM(CASE WHEN fr.status='pago'     AND (c.partner_id IS NULL) THEN fr.valor END),0) AS prop_real,
      COALESCE(SUM(CASE WHEN fr.status IN ('pendente','vencido') AND fr.due_date < CURDATE() AND (c.partner_id IS NULL) THEN fr.valor END),0) AS prop_venc,
      COALESCE(SUM(CASE WHEN fr.status='pendente' AND c.partner_id IS NOT NULL THEN fr.valor END),0) AS parc_prev,
      COALESCE(SUM(CASE WHEN fr.status='pago'     AND c.partner_id IS NOT NULL THEN fr.valor END),0) AS parc_real,
      COALESCE(SUM(CASE WHEN fr.status IN ('pendente','vencido') AND fr.due_date < CURDATE() AND c.partner_id IS NOT NULL THEN fr.valor END),0) AS parc_venc
    FROM financial_records fr
    LEFT JOIN cases c ON c.id = fr.case_id
    WHERE fr.tipo='receita'`);

  const inst = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('pendente','em_processamento') THEN valor END),0) AS prev,
      COALESCE(SUM(CASE WHEN status='pago' THEN valor END),0) AS realz,
      COALESCE(SUM(CASE WHEN status IN ('pendente','vencido') AND due_date < CURDATE() THEN valor END),0) AS venc
    FROM installments`);

  const parcelas = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN status='pendente' THEN valor_final END),0) AS prev,
      COALESCE(SUM(CASE WHEN status='pago' THEN valor_final END),0) AS realz,
      COALESCE(SUM(CASE WHEN status='pendente' AND data_vencimento < CURDATE() THEN valor_final END),0) AS venc
    FROM parcelas`).catch(() => ({ prev: 0, realz: 0, venc: 0 }));

  const dativo = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN status='previsto' THEN value END),0) AS prev,
      COALESCE(SUM(CASE WHEN status='recebido' THEN value END),0) AS realz,
      COALESCE(SUM(CASE WHEN status='previsto' AND expected_date < CURDATE() THEN value END),0) AS venc
    FROM dative_payments`);

  const corresp = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('agendada','realizada','faturada') THEN value END),0) AS prev,
      COALESCE(SUM(CASE WHEN status='paga' THEN value END),0) AS realz,
      COALESCE(SUM(CASE WHEN status IN ('realizada','faturada') AND due_date < CURDATE() THEN value END),0) AS venc
    FROM correspondent_hearings`);

  // ── SAÍDAS ─────────────────────────────────────────────────────────────────
  const desp = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN status='pendente' THEN valor END),0) AS prev,
      COALESCE(SUM(CASE WHEN status='pago' THEN valor END),0) AS realz
    FROM financial_records WHERE tipo='despesa'`);

  const repasses = await one(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('pendente','processando') THEN valor END),0) AS prev,
      COALESCE(SUM(CASE WHEN status='repassado' THEN valor END),0) AS realz
    FROM repasses`);

  const origens: OrigemResumo[] = [
    { origem: 'clientes',       label: 'Clientes & contratos',      previsto: N(recFR.prop_prev) + N(inst.prev) + N(parcelas.prev), realizado: N(recFR.prop_real) + N(inst.realz) + N(parcelas.realz), vencido: N(recFR.prop_venc) + N(inst.venc) + N(parcelas.venc) },
    { origem: 'parcerias',      label: 'Parcerias (entrada/êxito/sucumb.)', previsto: N(recFR.parc_prev), realizado: N(recFR.parc_real), vencido: N(recFR.parc_venc) },
    { origem: 'dativo',         label: 'Dativo (Estado)',           previsto: N(dativo.prev),  realizado: N(dativo.realz),  vencido: N(dativo.venc) },
    { origem: 'correspondente', label: 'Correspondente jurídico',   previsto: N(corresp.prev), realizado: N(corresp.realz), vencido: N(corresp.venc) },
  ].map((o) => ({ ...o, previsto: round2(o.previsto), realizado: round2(o.realizado), vencido: round2(o.vencido) }));

  const receita_prevista = round2(origens.reduce((s, o) => s + o.previsto, 0));
  const receita_realizada = round2(origens.reduce((s, o) => s + o.realizado, 0));
  const inadimplencia = round2(origens.reduce((s, o) => s + o.vencido, 0));
  const despesa_prevista = round2(N(desp.prev) + N(repasses.prev));
  const despesa_paga = round2(N(desp.realz) + N(repasses.realz));

  return {
    receita_prevista, receita_realizada,
    despesa_prevista, despesa_paga,
    saldo_previsto: round2(receita_prevista - despesa_prevista),
    saldo_realizado: round2(receita_realizada - despesa_paga),
    inadimplencia,
    por_origem: origens,
    saidas: {
      despesas: { previsto: round2(N(desp.prev)), realizado: round2(N(desp.realz)) },
      repasses: { previsto: round2(N(repasses.prev)), realizado: round2(N(repasses.realz)) },
    },
  };
}
