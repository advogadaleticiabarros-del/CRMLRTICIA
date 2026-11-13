import { Router, Request, Response } from 'express';
import { previaRelatorio, enviarRelatorioIntimacoes } from '../services/relatorioIntimacoesJob';

/**
 * Relatório diário de intimações (admin). O envio automático roda às 7h25
 * (crons/index.ts); aqui dá para ver a prévia ou mandar agora.
 */
const router = Router();

// ── GET /api/relatorio-intimacoes/previa?dias=1 — HTML do e-mail, sem enviar ──
router.get('/previa', async (req: Request, res: Response) => {
  const dias = Math.min(Math.max(parseInt(String(req.query.dias || '1')) || 1, 1), 30);
  const rel = await previaRelatorio(dias);
  if (req.query.formato === 'json') { res.json({ assunto: rel.assunto, totais: rel.totais, texto: rel.texto, itens: rel.itens }); return; }
  res.type('html').send(rel.html);
});

// ── POST /api/relatorio-intimacoes/enviar — manda agora o que ainda não foi relatado ──
router.post('/enviar', async (_req: Request, res: Response) => {
  res.json(await enviarRelatorioIntimacoes());
});

export default router;
