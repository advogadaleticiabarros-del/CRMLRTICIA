import { Router, Request, Response } from 'express';
import { carregarLote, arquivoDoKit, padronizarNomes } from '../services/loteProducaoMysql';
import { montarKit } from '../services/kitProtocolo';
import { db } from '../config/database';

/**
 * Card único do cliente na produção (30/10/2026). Montado em /api/lote (equipe).
 *  GET  /:clientId                       → ações, documentos classificados, kit e o que falta
 *  GET  /:clientId/acao/:caseId/kit      → .zip da ação (peça .docx + anexos renomeados, fotos em PDF)
 *  POST /:clientId/padronizar            → dá o nome padrão aos documentos do cliente
 */
const router = Router();

router.get('/:clientId', async (req: Request, res: Response) => {
  const lote = await carregarLote(Number(req.params.clientId));
  if (!lote) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }
  res.json(lote);
});

router.get('/:clientId/acao/:caseId/kit', async (req: Request, res: Response) => {
  const clientId = Number(req.params.clientId), caseId = Number(req.params.caseId);
  const lote = await carregarLote(clientId);
  const acao = lote?.acoes.find((a) => a.id === caseId);
  if (!lote || !acao) { res.status(404).json({ error: 'Ação não encontrada neste cliente' }); return; }
  const kit = await montarKit(acao, lote.cliente, { arquivo: (id) => arquivoDoKit(clientId, id) });
  await db.query(
    "INSERT INTO production_notes (case_id, user_id, author_name, kind, text) VALUES (?, ?, ?, 'atualizacao', ?)",
    [caseId, req.user!.id, req.user!.name, `Baixou o kit de protocolo: ${kit.incluidos} anexo(s)${kit.fora.length ? `, ${kit.fora.length} fora (sem arquivo no CRM)` : ''}.`]).catch(() => {});
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="kit.zip"; filename*=UTF-8''${encodeURIComponent(kit.nome)}`);
  res.send(kit.zip);
});

router.post('/:clientId/padronizar', async (req: Request, res: Response) => {
  res.json(await padronizarNomes(Number(req.params.clientId)));
});

export default router;
