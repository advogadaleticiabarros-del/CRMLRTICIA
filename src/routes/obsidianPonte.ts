import { Router, Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Ponte do Obsidian (ver services/obsidianPonte.ts e scripts/ponte-obsidian).
 * Quem chama é o programa do computador do escritório, não um usuário: a
 * autenticação é a chave OBSIDIAN_PONTE_TOKEN do .env (Authorization: Bearer
 * <chave>), separada da ponte do TJES. Sem a chave configurada, fica desligada.
 *
 *   GET  /clientes          → notas de Clientes/ (uma por cliente)
 *   GET  /anexos/:id        → arquivo de um documento de caso
 *   GET  /espelho           → manual, ficha do Escritório Virtual e Mapa do cofre
 *   POST /notas             { notas: [{ caminho, texto }] } → Cérebro
 *   POST /notas/concluir    { caminhos: [...] }  → tira do Cérebro o que saiu do cofre
 *   POST /modelos           { ficha }            → biblioteca de modelos de peça
 *   POST /sinal             { versao, resumo, erro } → sinal de vida
 */
const router = Router();

const hash = (s: string) => createHash('sha256').update(s).digest();

function exigirChave(req: Request, res: Response, next: NextFunction) {
  const chave = process.env.OBSIDIAN_PONTE_TOKEN || '';
  if (chave.length < 32) { res.status(503).json({ error: 'Ponte do Obsidian desligada' }); return; }
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!m || !timingSafeEqual(hash(m[1].trim()), hash(chave))) { res.status(401).json({ error: 'Chave inválida' }); return; }
  next();
}

router.use(exigirChave);

const svc = () => import('../services/obsidianPonteServico');
const erro = (res: Response, e: any) => res.status(500).json({ error: e?.message || 'Erro na ponte do Obsidian' });

router.get('/clientes', async (_req: Request, res: Response) => {
  try { res.json({ notas: await (await svc()).indiceClientes() }); } catch (e) { erro(res, e); }
});

router.get('/anexos/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id inválido' }); return; }
  try {
    const a = await (await svc()).anexo(id);
    if (!a) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
    res.setHeader('Content-Type', a.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(a.data);
  } catch (e) { erro(res, e); }
});

router.get('/espelho', async (_req: Request, res: Response) => {
  try { res.json({ arquivos: await (await svc()).espelho() }); } catch (e) { erro(res, e); }
});

router.post('/notas', async (req: Request, res: Response) => {
  const notas = Array.isArray(req.body?.notas) ? req.body.notas.slice(0, 100) : [];
  try { res.json(await (await import('../services/cerebroServico')).importarNotas(notas)); } catch (e) { erro(res, e); }
});

router.post('/notas/concluir', async (req: Request, res: Response) => {
  const caminhos = Array.isArray(req.body?.caminhos) ? req.body.caminhos.map(String) : null;
  if (!caminhos || !caminhos.length) { res.status(400).json({ error: 'Lista de caminhos vazia: nada foi apagado.' }); return; }
  try {
    const s = await import('../services/cerebroServico');
    const apagadas = await s.removerAusentes(caminhos);
    s.indexarPendentes(300).catch(() => {});
    res.json({ apagadas });
  } catch (e) { erro(res, e); }
});

router.post('/modelos', async (req: Request, res: Response) => {
  const m = await import('../services/pecaModelosImport');
  try { res.json(await m.importarFichaModelo(req.body || {})); } catch (e: any) {
    if (e instanceof m.FichaInvalida) { res.status(400).json({ error: e.message }); return; }
    erro(res, e);
  }
});

router.post('/sinal', async (req: Request, res: Response) => {
  const b = req.body || {};
  try {
    await (await svc()).registrarSinal({ versao: b.versao, resumo: b.resumo, erro: typeof b.erro === 'string' ? b.erro : null });
    res.json({ ok: true });
  } catch (e) { erro(res, e); }
});

export default router;
