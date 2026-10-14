import { Router, Request, Response } from 'express';

/**
 * Cérebro (biblioteca do escritório).
 *   POST /api/cerebro/importar   { notas: [{ caminho, texto }] }  → lote do cofre Obsidian
 *   POST /api/cerebro/concluir   { caminhos: [...] }              → apaga o que saiu do cofre
 *   POST /api/cerebro/perguntar  { pergunta, cliente?, processo?, area? }
 *   GET  /api/cerebro/organizacao                                  → o que arrumar no cofre
 *   GET  /api/cerebro/resumo
 */
const router = Router();
const svc = () => import('../services/cerebroServico');

router.post('/importar', async (req: Request, res: Response) => {
  const notas = Array.isArray(req.body?.notas) ? req.body.notas.slice(0, 100) : [];
  try { res.json(await (await svc()).importarNotas(notas)); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/concluir', async (req: Request, res: Response) => {
  const caminhos = Array.isArray(req.body?.caminhos) ? req.body.caminhos.map(String) : null;
  if (!caminhos || !caminhos.length) { res.status(400).json({ error: 'Lista de caminhos vazia: nada foi apagado.' }); return; }
  try {
    const s = await svc();
    const apagadas = await s.removerAusentes(caminhos);
    s.indexarPendentes(300).catch(() => {});
    res.json({ apagadas, ...(await s.resumoCerebro()) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/perguntar', async (req: Request, res: Response) => {
  const pergunta = String(req.body?.pergunta || '').trim();
  if (pergunta.length < 3) { res.status(400).json({ error: 'Escreva a pergunta.' }); return; }
  const ctx = { cliente: req.body?.cliente || null, processo: req.body?.processo || null, area: req.body?.area || null };
  const nome = String((req as any).user?.name || 'a equipe').split(' ')[0];
  try { res.json(await (await svc()).perguntarAoCerebro(pergunta.slice(0, 1000), ctx, nome)); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/organizacao', async (_req: Request, res: Response) => {
  try { res.json(await (await svc()).relatorioOrganizacao()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/resumo', async (_req: Request, res: Response) => {
  try { res.json(await (await svc()).resumoCerebro()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
