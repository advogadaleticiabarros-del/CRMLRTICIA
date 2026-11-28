import { Router, Request, Response, NextFunction } from 'express';
import { servicoChavesClaude } from '../services/chavesClaudeMysql';

/**
 * API do Claude (extensão do Claude Desktop, 28/11/2026).
 * Quem chama é a extensão no computador do advogado, com a chave que ele
 * gerou no CRM (Authorization: Bearer crm_...). O Claude age em nome da
 * pessoa, com as permissões dela. Fase 0: só leitura.
 */
const router = Router();

export async function autenticarChaveClaude(req: Request, res: Response, next: NextFunction): Promise<void> {
  const m = /^Bearer\s+(crm_\S+)$/i.exec(String(req.headers.authorization || ''));
  if (!m) { res.status(401).json({ error: 'Chave do Claude ausente. Gere uma no CRM: Configurações → Claude.' }); return; }
  try {
    const u = await servicoChavesClaude.autenticar(m[1]);
    if (!u) { res.status(401).json({ error: 'Chave do Claude inválida ou revogada. Gere outra no CRM.' }); return; }
    req.user = { id: u.id, email: u.email, name: u.name, role: u.role };
    next();
  } catch {
    res.status(503).json({ error: 'CRM indisponível no momento. Tente de novo em instantes.' });
  }
}

router.use(autenticarChaveClaude);

router.get('/eu', (req: Request, res: Response) => {
  res.json({ nome: req.user!.name, papel: req.user!.role });
});

router.get('/semana', async (req: Request, res: Response) => {
  const { minhaSemana } = await import('../services/claudeConsultasMysql');
  res.json(await minhaSemana(req.user!));
});

router.get('/identificar', async (req: Request, res: Response) => {
  const texto = String(req.query.texto || '').slice(0, 4000);
  const nome = String(req.query.nome || '').slice(0, 120);
  if (!texto.trim() && !nome.trim()) { res.status(400).json({ error: 'Informe o texto (com nº do processo ou CPF) ou o nome do cliente.' }); return; }
  const { identificarCaso } = await import('../services/claudeConsultasMysql');
  res.json(await identificarCaso(texto, nome));
});

router.get('/casos/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Caso inválido' }); return; }
  const { resumoDoCaso } = await import('../services/claudeConsultasMysql');
  const r = await resumoDoCaso(id);
  if (!r) { res.status(404).json({ error: 'Caso não encontrado' }); return; }
  res.json(r);
});

export default router;
