import { Router, Request, Response } from 'express';
import { listarAndamentos, resumoAndamentos, marcarLidas, marcarTratada, Situacao } from '../services/centralAndamentos';
import { clientesParaBuscar, registrarBusca, listarAcoesNovas, confirmarAcaoNova, descartarAcaoNova } from '../services/acoesNovasClientes';

/** Central de andamentos (equipe, ver app.ts). */
const router = Router();

router.get('/', async (req: Request, res: Response) => {
  res.json(await listarAndamentos({
    situacao: String(req.query.situacao || 'nao_lidas') as Situacao,
    q: req.query.q ? String(req.query.q) : undefined,
    tribunal: req.query.tribunal ? String(req.query.tribunal) : undefined,
    tipo: req.query.tipo ? String(req.query.tipo) : undefined,
  }));
});

router.get('/resumo', async (_req: Request, res: Response) => {
  res.json(await resumoAndamentos());
});

// Termômetro dos casos: dias parados, fase e login do tribunal que falta.
router.get('/termometro', async (_req: Request, res: Response) => {
  const { termometroDoBanco } = await import('../services/termometroCasos');
  res.json(await termometroDoBanco());
});

router.post('/lidas',async (req: Request, res: Response) => {
  const ids = req.body?.todas ? 'todas' : (Array.isArray(req.body?.ids) ? req.body.ids : []);
  res.json({ marcadas: await marcarLidas(req.user!.id, ids) });
});

router.post('/:id/tratada', async (req: Request, res: Response) => {
  const ok = await marcarTratada(req.user!.id, Number(req.params.id), !!req.body?.desfazer);
  res.status(ok ? 200 : 404).json(ok ? { success: true } : { error: 'Andamento não encontrado' });
});

// ── Ações novas envolvendo clientes ─────────────────────────────────────────
router.get('/acoes-novas', async (_req: Request, res: Response) => {
  res.json(await listarAcoesNovas());
});

router.get('/acoes-novas/clientes', async (_req: Request, res: Response) => {
  res.json(await clientesParaBuscar());
});

router.post('/acoes-novas/busca', async (req: Request, res: Response) => {
  const resultados = Array.isArray(req.body?.resultados) ? req.body.resultados.slice(0, 2000) : [];
  res.json(await registrarBusca(req.user?.id ?? null, resultados, !!req.body?.bloqueado, {
    finalizar: req.body?.finalizar !== false,
    clientes: Number(req.body?.clientes) || undefined,
    achados: Number(req.body?.achados) || 0,
  }));
});

// Intimações pendentes no tribunal (MNI) — leitura para a equipe; o login fica só com admin.
router.get('/intimacoes', async (_req: Request, res: Response) => {
  const { avisosPendentes } = await import('../services/mni');
  res.json(await avisosPendentes());
});

router.post('/acoes-novas/:id/confirmar', async (req: Request, res: Response) => {
  const r = await confirmarAcaoNova(Number(req.params.id), req.user!.id);
  res.status(r.ok ? 200 : 404).json(r.ok ? r : { ...r, error: r.mensagem });
});

router.post('/acoes-novas/:id/descartar', async (req: Request, res: Response) => {
  const r = await descartarAcaoNova(Number(req.params.id), req.user!.id);
  res.status(r.ok ? 200 : 404).json(r.ok ? r : { error: 'Item não encontrado ou já resolvido' });
});

export default router;
