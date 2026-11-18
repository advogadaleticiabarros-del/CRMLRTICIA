import { Router, Request, Response } from 'express';
import { statusDosSistemas, salvarCredencial, removerCredencial, avisosPendentes, rodarMonitoramentoMniAgora } from '../services/mni';
import { sistemaPorId } from '../services/mni/sistemas';

/**
 * Ligação oficial com os tribunais (MNI). Só administrador (ver app.ts).
 * CPF, senha e chave do autenticador entram por aqui e NUNCA saem: as respostas não trazem nenhum deles.
 */
const router = Router();

router.get('/sistemas', async (_req: Request, res: Response) => {
  res.json(await statusDosSistemas());
});

router.put('/sistemas/:id', async (req: Request, res: Response) => {
  if (!sistemaPorId(req.params.id)) { res.status(404).json({ error: 'Sistema desconhecido' }); return; }
  const { cpf, senha, chave_autenticador } = req.body || {};
  const r = await salvarCredencial(req.params.id, String(cpf || ''), String(senha || ''), req.user?.id ?? null, chave_autenticador ? String(chave_autenticador) : undefined);
  res.status(r.ok ? 200 : 400).json(r.ok ? r : { ...r, error: r.mensagem });
});

router.delete('/sistemas/:id', async (req: Request, res: Response) => {
  if (!sistemaPorId(req.params.id)) { res.status(404).json({ error: 'Sistema desconhecido' }); return; }
  await removerCredencial(req.params.id);
  res.json({ success: true });
});

router.get('/avisos', async (_req: Request, res: Response) => {
  res.json(await avisosPendentes());
});

router.post('/rodar', async (_req: Request, res: Response) => {
  res.json(await rodarMonitoramentoMniAgora());
});

export default router;
