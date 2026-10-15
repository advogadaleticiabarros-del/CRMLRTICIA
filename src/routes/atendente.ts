import { Router, Request, Response } from 'express';

/**
 * Dra. Lívia (atendente do WhatsApp), modo rascunho.
 *   GET  /api/atendente/rascunhos?status=pendente
 *   POST /api/atendente/rascunhos/:id/enviar     { texto }   (texto editado ou o original)
 *   POST /api/atendente/rascunhos/:id/descartar  { motivo? }
 *   GET  /api/atendente/guia                                 → guia de tom de voz atual
 *   POST /api/atendente/estudar-tom                          → estuda as conversas de novo
 */
const router = Router();
const svc = () => import('../services/atendenteServico');
const quem = (req: Request) => String((req as any).user?.name || 'Equipe').split(' ')[0];

router.get('/rascunhos', async (req: Request, res: Response) => {
  const status = ['pendente', 'enviada', 'editada', 'descartada'].includes(String(req.query.status)) ? String(req.query.status) : 'pendente';
  try { res.json(await (await svc()).listarRascunhos(status)); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/rascunhos/:id/enviar', async (req: Request, res: Response) => {
  try {
    const r = await (await svc()).enviarRascunho(Number(req.params.id), String(req.body?.texto || ''), quem(req));
    if (!r.ok) { res.status(400).json({ error: r.erro }); return; }
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/rascunhos/:id/descartar', async (req: Request, res: Response) => {
  try { await (await svc()).descartarRascunho(Number(req.params.id), quem(req), req.body?.motivo ? String(req.body.motivo) : null); res.json({ success: true }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/guia', async (_req: Request, res: Response) => {
  try { res.json(await (await svc()).guiaAtual()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/estudar-tom', async (_req: Request, res: Response) => {
  try { res.json(await (await svc()).estudarTomDeVoz()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
