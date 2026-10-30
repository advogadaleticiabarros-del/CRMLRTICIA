import { Router, Request, Response } from 'express';
import { carregarLote, arquivoDoKit, padronizarNomes, enviarVersaoFinal, pecaParaBaixar } from '../services/loteProducaoMysql';
import { montarKit } from '../services/kitProtocolo';
import { db } from '../config/database';

/**
 * Card único do cliente na produção (30/10/2026). Montado em /api/lote (equipe).
 *  GET  /:clientId                       → ações, documentos classificados, kit e o que falta
 *  GET  /:clientId/acao/:caseId/kit      → .zip da ação (peça .docx + anexos renomeados, fotos em PDF)
 *  POST /:clientId/acao/:caseId/versao-final → peça colada (ou Word/PDF) vira a versão final, no timbrado
 *  GET  /:clientId/acao/:caseId/peca     → a peça no papel timbrado (.docx)
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

// A Dra. revisou: cola a peça na tela (vira .docx no papel timbrado) ou envia o Word/PDF. Vira a versão final da ação.
router.post('/:clientId/acao/:caseId/versao-final', async (req: Request, res: Response) => {
  const { paragrafos, file_base64, name, mime } = req.body || {};
  if (!paragrafos && !(file_base64 && name)) { res.status(400).json({ error: 'Cole a peça ou envie o arquivo' }); return; }
  const base = { clientId: Number(req.params.clientId), caseId: Number(req.params.caseId), userId: req.user!.id, autor: req.user!.name };
  try {
    const r = await enviarVersaoFinal(paragrafos
      ? { ...base, paragrafos }
      : { ...base, nome: String(name), base64: String(file_base64), mime: String(mime || '') });
    res.status(201).json(r);
  } catch (e: any) { res.status(e?.status || 500).json({ error: e?.message || 'Não foi possível guardar a versão final' }); }
});

// A peça da ação no papel timbrado (.docx): a versão final ou a mais nova.
router.get('/:clientId/acao/:caseId/peca', async (req: Request, res: Response) => {
  const p = await pecaParaBaixar(Number(req.params.clientId), Number(req.params.caseId));
  if (!p) { res.status(404).json({ error: 'Esta ação ainda não tem peça' }); return; }
  res.setHeader('Content-Type', p.mime);
  res.setHeader('Content-Disposition', `attachment; filename="peca.${p.mime === 'application/pdf' ? 'pdf' : 'docx'}"; filename*=UTF-8''${encodeURIComponent(p.nome)}`);
  res.send(p.data);
});

router.post('/:clientId/padronizar', async (req: Request, res: Response) => {
  res.json(await padronizarNomes(Number(req.params.clientId)));
});

export default router;
