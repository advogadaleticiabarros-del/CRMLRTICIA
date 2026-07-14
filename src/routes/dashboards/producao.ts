import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

/**
 * Dashboard de PRODUÇÃO — a esteira real do escritório.
 *
 * ANTES ESTAVA ERRADO: consultava a tabela `legal_pieces`, onde NADA é inserido
 * (nenhum INSERT no código inteiro). O painel mostrava zero para sempre, mesmo
 * com a esteira cheia. Também filtrava por `user_id`, escondendo os casos dos
 * outros — o mesmo bug que quebrou o dashboard de Processos.
 *
 * A produção de verdade vive em `cases.production_stage`.
 */

const SLA_DIAS = 10; // meta: 10 dias do início da produção até o protocolo

const ETAPAS: Record<string, string> = {
  separacao_documentos: 'Separação de docs',
  criacao_inicial:      'Criação inicial',
  revisao_inicial:      'Revisão inicial',
  aguardando_protocolo: 'Aguardando protocolo',
  protocolado:          'Protocolado',
  concluido:            'Concluído',
};
const ATIVAS = ['separacao_documentos', 'criacao_inicial', 'revisao_inicial', 'aguardando_protocolo'];

router.get('/', async (_req: Request, res: Response) => {
  try {
    // 1. Casos por etapa (a esteira inteira)
    const [porEtapa] = await db.query(`
      SELECT production_stage AS etapa, COUNT(*) AS total
        FROM cases
       WHERE production_stage IS NOT NULL
       GROUP BY production_stage
    `) as any;
    const mapa: Record<string, number> = {};
    for (const r of porEtapa) mapa[r.etapa] = Number(r.total);

    const emProducao = ATIVAS.reduce((s, e) => s + (mapa[e] || 0), 0);

    // 2. Atrasados: em etapa ativa há mais de SLA_DIAS
    const [[atr]] = await db.query(`
      SELECT COUNT(*) AS n FROM cases
       WHERE production_stage IN (${ATIVAS.map(() => '?').join(',')})
         AND production_started_at IS NOT NULL
         AND DATEDIFF(NOW(), production_started_at) > ?
    `, [...ATIVAS, SLA_DIAS]) as any;

    // 3. Pendências abertas (o que falta para a peça andar)
    const [[pend]] = await db.query(`
      SELECT COUNT(*) AS n FROM production_notes
       WHERE kind = 'pendencia' AND resolved = 0
    `).catch(() => [[{ n: 0 }]]) as any;

    // 4. Protocolados e concluídos NO MÊS
    const [[mes]] = await db.query(`
      SELECT
        SUM(protocoled_at IS NOT NULL
            AND YEAR(protocoled_at) = YEAR(NOW())
            AND MONTH(protocoled_at) = MONTH(NOW()))                AS protocolados_mes,
        SUM(production_stage = 'concluido')                          AS concluidos_total
      FROM cases
    `).catch(() => [[{ protocolados_mes: 0, concluidos_total: 0 }]]) as any;

    // 5. Produtividade: protocolados por responsável (últimos 90 dias)
    const [produtividade] = await db.query(`
      SELECT COALESCE(u.name, 'sem responsável') AS responsavel,
             COUNT(*) AS protocolados
        FROM cases c
        LEFT JOIN users u ON u.id = c.production_assignee
       WHERE c.protocoled_at IS NOT NULL
         AND c.protocoled_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP BY u.id, u.name
       ORDER BY protocolados DESC
    `).catch(() => [[]]) as any;

    // 6. Os que estão parados há mais tempo (é aqui que o dinheiro trava)
    const [parados] = await db.query(`
      SELECT c.id, c.title, c.production_stage,
             DATEDIFF(NOW(), c.production_started_at) AS dias,
             cl.name AS client_name,
             (SELECT COUNT(*) FROM production_notes pn
               WHERE pn.case_id = c.id AND pn.kind = 'pendencia' AND pn.resolved = 0) AS pendencias
        FROM cases c
        LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE c.production_stage IN (${ATIVAS.map(() => '?').join(',')})
         AND c.production_started_at IS NOT NULL
       ORDER BY dias DESC
       LIMIT 10
    `, ATIVAS) as any;

    res.json({
      kpis: {
        em_producao:      emProducao,
        atrasados:        Number(atr?.n) || 0,
        pendencias:       Number(pend?.n) || 0,
        protocolados_mes: Number(mes?.protocolados_mes) || 0,
        concluidos:       Number(mes?.concluidos_total) || 0,
        sla_dias:         SLA_DIAS,
      },
      por_etapa: Object.keys(ETAPAS).map((k) => ({ etapa: ETAPAS[k], chave: k, total: mapa[k] || 0 })),
      produtividade,
      parados,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro ao carregar o dashboard de produção' });
  }
});

export default router;
