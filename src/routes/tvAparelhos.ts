import { Router, Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import { authenticate, requireStaff, requireWhatsappAccess } from '../middleware/auth';
import { servicoTv } from '../services/tvAparelhosMysql';

/**
 * TV liberada por código (19/11/2026). Três peças:
 * - tvPublicoRoutes (/api/public/tv): a TV pede o código e pergunta se já foi liberada;
 * - tvAparelhosRoutes (/api/tv-aparelhos, equipe logada): liberar pelo código, listar, desligar;
 * - autenticarTvOuEquipe: na frente de /api/tv, aceita a chave da TV (X-TV-Chave)
 *   ou o login normal da equipe.
 */

export const tvPublicoRoutes = Router();

tvPublicoRoutes.post('/parear', async (req: Request, res: Response) => {
  try {
    const r = await servicoTv.iniciar();
    if (!r.ok) { res.status(429).json({ error: r.erro }); return; }
    const base = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
    const link = `${base}/tv/liberar?codigo=${r.codigo}`;
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#15110c', light: '#ffffff' } });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ codigo: r.codigo, segredo: r.segredo, expiraEm: r.expiraEm, link, qr });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

tvPublicoRoutes.post('/situacao', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ situacao: await servicoTv.situacao(String(req.body?.segredo || '')) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export const tvAparelhosRoutes = Router();

tvAparelhosRoutes.post('/liberar', async (req: Request, res: Response) => {
  try {
    const r = await servicoTv.liberar(String(req.body?.codigo || ''), { id: req.user!.id }, String(req.body?.nome || ''));
    if (!r.ok) { res.status(400).json({ error: r.erro }); return; }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
tvAparelhosRoutes.get('/', async (_req: Request, res: Response) => {
  try { res.json(await servicoTv.listar()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});
tvAparelhosRoutes.post('/:id/desligar', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Pedido inválido' }); return; }
  try { await servicoTv.revogar(id); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/** Chave da TV liberada (só leitura em /api/tv) ou login da equipe com acesso ao WhatsApp. */
export async function autenticarTvOuEquipe(req: Request, res: Response, next: NextFunction): Promise<void> {
  const chave = req.get('X-TV-Chave');
  if (!chave) {
    authenticate(req, res, () => requireStaff(req, res, () => requireWhatsappAccess(req, res, next)));
    return;
  }
  if (req.method !== 'GET') { res.status(403).json({ error: 'A TV só pode ver o painel' }); return; }
  try {
    const usuario = await servicoTv.autenticar(chave);
    if (!usuario) { res.status(401).json({ error: 'Esta TV não está liberada' }); return; }
    req.user = usuario;
    next();
  } catch { res.status(500).json({ error: 'Falha ao conferir a TV' }); }
}
