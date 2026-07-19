import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

/**
 * Relatório mensal EXECUTIVO — o escritório inteiro num documento só:
 * faturamento por frente, protocolos, funil comercial, inadimplência e
 * produção. O front imprime no papel timbrado (salvar como PDF).
 */
router.get('/', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month))
    ? String(req.query.month)
    : new Date().toISOString().slice(0, 7);
  const N = (x: any) => Number(x) || 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const one = async (sql: string, params: any[] = []) => { const [[row]] = await db.query(sql, params) as any; return row || {}; };

  // ── Receita RECEBIDA no mês, por frente ────────────────────────────────────
  const rec = await one(`
    SELECT
      (SELECT COALESCE(SUM(fr.valor),0) FROM financial_records fr LEFT JOIN cases c ON c.id = fr.case_id
        WHERE fr.tipo='receita' AND fr.status='pago' AND DATE_FORMAT(COALESCE(fr.paid_at, fr.due_date),'%Y-%m') = ? AND c.partner_id IS NULL) AS clientes_avulso,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE status='pago' AND DATE_FORMAT(paid_at,'%Y-%m') = ?) AS parcelas_propostas,
      (SELECT COALESCE(SUM(valor_final),0) FROM parcelas WHERE status='pago' AND DATE_FORMAT(data_pagamento,'%Y-%m') = ?) AS parcelas_contratos,
      (SELECT COALESCE(SUM(fr.valor),0) FROM financial_records fr JOIN cases c ON c.id = fr.case_id
        WHERE fr.tipo='receita' AND fr.status='pago' AND DATE_FORMAT(COALESCE(fr.paid_at, fr.due_date),'%Y-%m') = ? AND c.partner_id IS NOT NULL) AS parcerias,
      (SELECT COALESCE(SUM(value),0) FROM dative_payments WHERE status='recebido' AND DATE_FORMAT(received_date,'%Y-%m') = ?) AS dativo,
      (SELECT COALESCE(SUM(value),0) FROM correspondent_hearings WHERE status='paga' AND DATE_FORMAT(paid_at,'%Y-%m') = ?) AS correspondente,
      (SELECT COALESCE(SUM(valor_escritorio),0) FROM case_awards WHERE status='recebido' AND DATE_FORMAT(data_recebimento,'%Y-%m') = ?) AS exitos
  `, [month, month, month, month, month, month, month]);

  // ── Saídas pagas no mês ────────────────────────────────────────────────────
  const sai = await one(`
    SELECT
      (SELECT COALESCE(SUM(valor),0) FROM financial_records WHERE tipo='despesa' AND status='pago' AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ?) AS despesas,
      (SELECT COALESCE(SUM(valor),0) FROM repasses WHERE status='repassado' AND DATE_FORMAT(data_repasse,'%Y-%m') = ?) AS repasses
  `, [month, month]);

  // ── Funil comercial do mês ─────────────────────────────────────────────────
  const funil = await one(`
    SELECT
      (SELECT COUNT(*) FROM leads WHERE DATE_FORMAT(created_at,'%Y-%m') = ?) AS leads_novos,
      (SELECT COUNT(*) FROM leads WHERE status='fechada' AND DATE_FORMAT(updated_at,'%Y-%m') = ?) AS leads_fechados,
      (SELECT COUNT(*) FROM propostas WHERE DATE_FORMAT(created_at,'%Y-%m') = ?) AS propostas_criadas,
      (SELECT COUNT(*) FROM propostas WHERE status='aceita' AND DATE_FORMAT(COALESCE(aceito_em, updated_at),'%Y-%m') = ?) AS propostas_aceitas
  `, [month, month, month, month]);

  // ── Produção do mês ────────────────────────────────────────────────────────
  const prod = await one(`
    SELECT
      (SELECT COUNT(DISTINCT case_id) FROM client_timeline WHERE event_type = 'etapa_protocolado' AND DATE_FORMAT(created_at,'%Y-%m') = ?) AS protocolados,
      (SELECT COUNT(*) FROM cases WHERE production_stage IS NOT NULL AND DATE_FORMAT(production_started_at,'%Y-%m') = ?) AS entraram_esteira,
      (SELECT COUNT(*) FROM cases WHERE production_stage = 'recusado' AND DATE_FORMAT(rejected_at,'%Y-%m') = ?) AS recusados
  `, [month, month, month]);

  // ── Situação atual (foto de hoje, não do mês) ──────────────────────────────
  const hoje = await one(`
    SELECT
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE status IN ('pendente','vencido') AND due_date < CURDATE())
      + (SELECT COALESCE(SUM(valor),0) FROM financial_records WHERE tipo='receita' AND status IN ('pendente','vencido') AND due_date < CURDATE()) AS inadimplencia,
      (SELECT COUNT(*) FROM cases WHERE production_stage IN ('em_analise','separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')) AS na_esteira
  `);

  const receitas = {
    clientes: r2(N(rec.clientes_avulso) + N(rec.parcelas_propostas) + N(rec.parcelas_contratos)),
    parcerias: r2(N(rec.parcerias)),
    dativo: r2(N(rec.dativo)),
    correspondente: r2(N(rec.correspondente)),
    exitos: r2(N(rec.exitos)),
  };
  const receita_total = r2(Object.values(receitas).reduce((a, b) => a + b, 0));
  const saida_total = r2(N(sai.despesas) + N(sai.repasses));

  res.json({
    month,
    receitas, receita_total,
    saidas: { despesas: r2(N(sai.despesas)), repasses: r2(N(sai.repasses)), total: saida_total },
    resultado: r2(receita_total - saida_total),
    funil: {
      leads_novos: N(funil.leads_novos), leads_fechados: N(funil.leads_fechados),
      propostas_criadas: N(funil.propostas_criadas), propostas_aceitas: N(funil.propostas_aceitas),
      conversao_pct: N(funil.leads_novos) ? Math.round((N(funil.leads_fechados) / N(funil.leads_novos)) * 100) : 0,
    },
    producao: { protocolados: N(prod.protocolados), entraram_esteira: N(prod.entraram_esteira), recusados: N(prod.recusados) },
    situacao_atual: { inadimplencia: r2(N(hoje.inadimplencia)), casos_na_esteira: N(hoje.na_esteira) },
  });
});

export default router;
