import { Router, Request, Response } from 'express';
import { servicoChavesClaude } from '../services/chavesClaudeMysql';

/**
 * Chaves do Claude da própria pessoa (Configurações → Claude). Cada um só vê
 * e revoga as suas. A chave completa aparece só na resposta da criação.
 */
const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const lista = await servicoChavesClaude.listar(req.user!.id);
  res.json(lista.map((c) => ({ id: c.id, nome: c.nome, prefixo: c.prefixo, criada_em: c.criadaEm, ultimo_uso: c.ultimoUso, usos: c.usos })));
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const r = await servicoChavesClaude.criar(req.user!.id, String(req.body?.nome || ''));
    res.status(201).json({ id: r.id, prefixo: r.prefixo, chave: r.chave, aviso: 'Copie agora: a chave não aparece de novo.' });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const ok = await servicoChavesClaude.revogar(Number(req.params.id), req.user!.id);
  res.status(ok ? 200 : 404).json(ok ? { success: true } : { error: 'Chave não encontrada' });
});

export default router;
