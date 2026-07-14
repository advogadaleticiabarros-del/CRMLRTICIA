import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { runRetention, POLITICAS, INTOCADAS } from '../services/retentionService';

const router = Router();

/**
 * Retenção de dados (LGPD). Permite VER o que seria apagado antes de apagar,
 * e comprova a diligência do escritório (histórico de expurgos).
 */

// GET /api/retention/preview — SIMULA: conta o que seria apagado, sem apagar nada
router.get('/preview', async (_req: Request, res: Response) => {
  try {
    res.json(await runRetention(true));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erro ao simular o expurgo' });
  }
});

// GET /api/retention/politicas — o que a rotina faz e o que ela NUNCA toca
router.get('/politicas', (_req: Request, res: Response) => {
  res.json({
    politicas: POLITICAS.map((p) => ({
      nome: p.nome, tabela: p.tabela, acao: p.acao, criterio: p.criterio, porque: p.porque,
    })),
    nunca_toca: INTOCADAS,
    observacao:
      'Processo, procuração, contrato, documento e financeiro NÃO são expurgados: ' +
      'há dever legal de guarda e podem ser prova. O expurgo atinge apenas logs, ' +
      'tokens vencidos, e-mails descartados, leads que nunca viraram cliente ' +
      '(anonimizados) e mídia de WhatsApp sem cliente vinculado.',
  });
});

// POST /api/retention/run — EXECUTA o expurgo de verdade
router.post('/run', async (_req: Request, res: Response) => {
  try {
    res.json(await runRetention(false));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erro ao executar o expurgo' });
  }
});

// GET /api/retention/historico — prova de conformidade (o que já foi expurgado)
router.get('/historico', async (_req: Request, res: Response) => {
  try {
    const [rows] = await db.query(
      `SELECT politica, tabela, acao, linhas, criterio, simulacao, ran_at
         FROM retention_log ORDER BY ran_at DESC LIMIT 200`
    ) as any;
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erro ao ler o histórico' });
  }
});

export default router;
