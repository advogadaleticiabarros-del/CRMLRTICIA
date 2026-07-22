import { Router, Request, Response } from 'express';
import { db } from '../../config/database';
import { getReceitasRecebidasNoMes, getInadimplencia } from '../../services/monthlyFinance';

const router = Router();

/**
 * Relatório mensal EXECUTIVO — o escritório inteiro num documento só:
 * faturamento por frente, protocolos, funil comercial, inadimplência e
 * produção. O front imprime no papel timbrado (salvar como PDF).
 *
 * A receita usa services/monthlyFinance — a MESMA fonte do DRE do contador e
 * do painel do Dashboard, pra nunca mais os três relatórios divergirem.
 */
router.get('/', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month))
    ? String(req.query.month)
    : new Date().toISOString().slice(0, 7);
  const N = (x: any) => Number(x) || 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const one = async (sql: string, params: any[] = []) => { const [[row]] = await db.query(sql, params) as any; return row || {}; };

  const rec = await getReceitasRecebidasNoMes(month);

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
  const [[esteira]] = await db.query(
    `SELECT COUNT(*) AS n FROM cases WHERE production_stage IN ('em_analise','separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')`
  ) as any;
  const inadimplenciaAtual = await getInadimplencia();

  const receitas = {
    clientes: r2(rec.avulsas_clientes + rec.parcelas_contratos),
    parcerias: rec.entradas_parceria,
    dativo: rec.dativo,
    correspondente: rec.correspondente,
    exitos: rec.exitos,
  };
  const receita_total = rec.total;
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
    situacao_atual: { inadimplencia: inadimplenciaAtual.total, casos_na_esteira: N(esteira.n) },
  });
});

export default router;
