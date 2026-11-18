import { Router, Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { ponteEscritorio } from '../services/mni/ponteEscritorio';

/**
 * Ponte do escritório → TJES (ver services/mni/ponteEscritorio.ts).
 * Quem chama é o programa do computador do escritório (scripts/ponte-escritorio),
 * não um usuário: a autenticação é a chave MNI_PONTE_TOKEN do .env
 * (Authorization: Bearer <chave>). Sem a chave configurada, a ponte fica desligada.
 */
const router = Router();

const hash = (s: string) => createHash('sha256').update(s).digest();

function exigirChave(req: Request, res: Response, next: NextFunction) {
  const chave = process.env.MNI_PONTE_TOKEN || '';
  if (chave.length < 32) { res.status(503).json({ error: 'Ponte do escritório desligada' }); return; }
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!m || !timingSafeEqual(hash(m[1].trim()), hash(chave))) { res.status(401).json({ error: 'Chave inválida' }); return; }
  next();
}

router.use(exigirChave);

router.get('/pedidos', async (req: Request, res: Response) => {
  const espera = Math.min(Math.max(Number(req.query.espera) || 25, 1), 30) * 1000;
  res.json(await ponteEscritorio.aguardarPedidos(espera));
});

router.post('/respostas/:id', (req: Request, res: Response) => {
  const b = req.body || {};
  const r = typeof b.erro === 'string'
    ? { erro: b.erro.slice(0, 300) }
    : { status: Number(b.status) || 0, corpo: typeof b.corpo === 'string' ? b.corpo : '' };
  const ok = ponteEscritorio.responder(String(req.params.id), r);
  res.status(ok ? 200 : 404).json({ ok });
});

export default router;
