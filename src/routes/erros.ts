import { Router, Request, Response } from 'express';
import { requireStaff } from '../middleware/auth';
import { registrarErro, listarErros, marcarResolvido } from '../services/errosServico';

/**
 * Rastreador de erros.
 *   POST /api/erros               → a tela manda um erro de JavaScript (qualquer usuário logado)
 *   GET  /api/erros               → lista (equipe); ?todos=1 inclui os resolvidos
 *   POST /api/erros/:id/resolvido → marca como resolvido (volta se acontecer de novo)
 */
const router = Router();

// Até 30 erros por minuto por usuário: uma tela em loop não enche o banco.
const janela = new Map<string, { n: number; desde: number }>();
function permitido(chave: string): boolean {
  const agora = Date.now();
  const j = janela.get(chave);
  if (!j || agora - j.desde > 60_000) { janela.set(chave, { n: 1, desde: agora }); return true; }
  j.n++;
  return j.n <= 30;
}

router.post('/', async (req: Request, res: Response) => {
  res.status(204).end();
  const b = req.body || {};
  const quem = req.user?.name || null;
  if (!permitido(String(req.user?.id || req.ip))) return;
  await registrarErro({
    origem: 'tela',
    mensagem: String(b.mensagem || '').slice(0, 500),
    pilha: [b.pilha, b.tela ? `tela: ${b.tela}` : null, b.navegador ? `navegador: ${b.navegador}` : null].filter(Boolean).join('\n').slice(0, 4000) || null,
    // "Onde" na tela = arquivo:linha do JavaScript (ex.: app.js:9586), ou a tela aberta.
    local: b.local ? String(b.local).replace(/^https?:\/\/[^/]+\//, '').slice(0, 200) : (b.tela ? `tela ${String(b.tela).slice(0, 80)}` : null),
    usuario: quem,
  });
});

router.get('/', requireStaff, async (req: Request, res: Response) => {
  res.json(await listarErros(req.query.todos === '1'));
});

router.post('/:id/resolvido', requireStaff, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Erro inválido' }); return; }
  await marcarResolvido(id);
  res.json({ ok: true });
});

export default router;
