import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { aiComplete } from '../services/aiAssistant';
import { registrarAcaoAgente } from '../services/usoIa';
import { slaDiasEfetivosSql } from '../services/productionSla';
import {
  sanitizarHtmlPeca, htmlParaTexto, textoParaHtml, contarColchetes, compararTextos, etapasDaMesa,
  promptLicoes, parseLicoes, nomeVersaoDra, numeroDaVersao, abaDaEtapa, resumoColeta, ordenarAchados,
} from '../services/mesaCaso';

/**
 * Mesa do caso: a tela de trabalho da produção (regras em services/mesaCaso.ts).
 * A Dra. edita a petição aqui. A 1ª edição de uma versão da equipe cria uma
 * versão dela (versao_de aponta para a da equipe, que fica intacta); a equipe
 * compara as duas e anota lições, que viram regras das próximas peças.
 */

const router = Router();
const ehPeticao = (nome: string) => /^Petição Inicial/i.test(String(nome || ''));
const MAX_HTML = 2_000_000;

async function documentosDoCaso(caseId: number) {
  const [rows] = await db.query(
    `SELECT id, case_id, name, type, status, created_at, updated_at, visible_to_client, versao_de, final_em, file_url,
            (content IS NOT NULL AND content <> '') AS tem_texto, (data IS NOT NULL) AS tem_arquivo
       FROM documents
      WHERE case_id = ? OR id IN (SELECT document_id FROM pecas_conjuntas WHERE case_id = ?)
      ORDER BY id ASC`, [caseId, caseId]) as any;
  return rows as any[];
}

router.get('/:caseId', async (req: Request, res: Response) => {
  const caseId = Number(req.params.caseId);
  const [[c]] = await db.query(
    `SELECT c.id, c.title, c.client_id, c.legal_area, c.production_stage, c.case_number, c.valor_causa, c.prescricao_data,
            c.partner_id, c.description, c.origin_contract_id, c.production_assignee, c.production_started_at, c.protocoled_at,
            c.rejected_at, c.rejection_reason,
            ${slaDiasEfetivosSql('c.id', 'c.production_started_at')} AS sla_days,
            cl.name AS client_name, p.name AS partner_name, u.name AS assignee_name
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN partners p ON p.id = c.partner_id
       LEFT JOIN users u ON u.id = c.production_assignee
      WHERE c.id = ?`, [caseId]) as any;
  if (!c) { res.status(404).json({ error: 'Caso não encontrado' }); return; }

  const [partes] = await db.query('SELECT id, papel, nome, cpf_cnpj FROM case_partes WHERE case_id = ? ORDER BY id', [caseId]) as any;
  let relato = c.description || '';
  if (c.origin_contract_id) {
    const [[ct]] = await db.query('SELECT lead_id FROM contracts WHERE id = ?', [c.origin_contract_id]) as any;
    if (ct?.lead_id) { const [[l]] = await db.query('SELECT case_summary FROM leads WHERE id = ?', [ct.lead_id]) as any; relato = l?.case_summary || relato; }
  }
  const { buildCaseChecklist } = await import('../services/caseChecklists');
  const checklist = await buildCaseChecklist(caseId).catch(() => null);

  const docs = await documentosDoCaso(caseId);
  const pecasDocs = docs.filter((d) => ehPeticao(d.name));
  const textos = new Map<number, string>();
  if (pecasDocs.length) {
    const [rows] = await db.query('SELECT id, content FROM documents WHERE id IN (?)', [pecasDocs.map((d) => d.id)]) as any;
    for (const r of rows) textos.set(r.id, String(r.content || ''));
  }
  const pecas = pecasDocs.map((d) => ({
    id: d.id, case_id: d.case_id, name: d.name, versao: numeroDaVersao(d.name), origem: d.versao_de ? 'dra' : 'equipe',
    versao_de: d.versao_de, final_em: d.final_em, created_at: d.created_at, updated_at: d.updated_at,
    colchetes: contarColchetes(textos.get(d.id) || ''),
  }));
  const ultimo = (prefixo: RegExp) => [...docs].reverse().find((d) => prefixo.test(d.name)) || null;
  const dossie = ultimo(/^Dossiê da peça/i);
  const revisao = ultimo(/^Revisão da Petição/i);
  const documentos = docs.filter((d) => !ehPeticao(d.name) && d !== dossie && !/^(Dossiê da peça|Revisão da Petição)/i.test(d.name));

  const [conjunta] = await db.query(
    `SELECT DISTINCT c2.id, c2.title, pc.case_principal_id
       FROM pecas_conjuntas pc
       JOIN pecas_conjuntas pc2 ON pc2.document_id = pc.document_id
       JOIN cases c2 ON c2.id = pc2.case_id
      WHERE pc.case_id = ? ORDER BY c2.id`, [caseId]) as any;
  const [[pend]] = await db.query("SELECT COUNT(*) AS n FROM production_notes WHERE case_id = ? AND kind = 'pendencia' AND resolved = 0", [caseId]) as any;
  const [licoes] = await db.query('SELECT id, document_id, titulo, mudou, regra, decisao FROM peca_licoes WHERE case_id = ? ORDER BY id', [caseId]) as any;
  const [[regras]] = await db.query("SELECT COUNT(*) AS n FROM peca_licoes WHERE area = ? AND decisao = 'regra'", [c.legal_area || '']) as any;

  // Dra. Helena (análise dos documentos x história) e Dra. Camila (coleta e cobranças).
  const [[analise]] = await db.query(
    'SELECT documentos, graves, atencao, achados, created_at FROM analises_documentos WHERE case_id = ? ORDER BY id DESC LIMIT 1', [caseId]) as any;
  const [[coleta]] = await db.query(
    'SELECT id, itens, pedido_em, concluido_em FROM coletas_documentos WHERE case_id = ? OR (? IS NOT NULL AND contract_id = ?) ORDER BY id DESC LIMIT 1',
    [caseId, c.origin_contract_id, c.origin_contract_id]) as any;
  let resumoDaColeta = null;
  if (coleta) {
    const [avisos] = await db.query('SELECT marco, created_at FROM esteira_avisos WHERE ref = ?', [`coleta:${coleta.id}`]) as any;
    const [arqs] = await db.query('SELECT name FROM documents WHERE case_id = ? OR client_id = ?', [caseId, c.client_id]) as any;
    const [midias] = await db.query('SELECT file_name AS name FROM whatsapp_media WHERE client_id = ?', [c.client_id]).catch(() => [[]]) as any;
    resumoDaColeta = resumoColeta(coleta, [...arqs, ...midias].map((x: any) => String(x.name || '')), avisos);
  }
  const [rascunhos] = c.client_id
    ? await db.query("SELECT id, agente, created_at FROM atendente_rascunhos WHERE client_id = ? AND status = 'pendente' ORDER BY id DESC LIMIT 10", [c.client_id]) as any
    : [[]];
  const [[monit]] = await db.query('SELECT COUNT(*) AS n FROM legal_processes WHERE case_id = ?', [caseId]) as any;

  const recente = pecas[pecas.length - 1] || null;
  const { etapas, atual } = etapasDaMesa({
    stage: c.production_stage, relato: !!String(relato).trim(),
    partesContrarias: partes.filter((p: any) => p.papel === 'contraria').length,
    checklist: checklist ? { completos: checklist.completos, total: checklist.total } : null,
    documentos: documentos.length, temPeticaoEquipe: pecas.some((p) => p.origem === 'equipe'),
    colchetes: recente ? recente.colchetes : null, temVersaoDra: pecas.some((p) => p.origem === 'dra'),
    revisaoDepoisDaEdicao: !!(revisao && recente && new Date(revisao.created_at) >= new Date(recente.updated_at)),
    pendenciasAbertas: Number(pend?.n || 0), temFinal: pecas.some((p) => p.final_em), numeroProcesso: !!c.case_number,
  });

  res.json({
    caso: { ...c, relato }, partes, checklist, pecas, documentos, etapas, atual,
    dossie: dossie ? { id: dossie.id, name: dossie.name, created_at: dossie.created_at } : null,
    revisao: revisao ? { id: revisao.id, name: revisao.name, created_at: revisao.created_at } : null,
    conjunta: conjunta.length > 1 ? { principal: conjunta[0].case_principal_id, casos: conjunta.map((x: any) => ({ id: x.id, title: x.title })) } : null,
    licoes, regrasDaArea: Number(regras?.n || 0), pendenciasAbertas: Number(pend?.n || 0),
    analise: analise ? { documentos: analise.documentos, graves: analise.graves, atencao: analise.atencao, created_at: analise.created_at, achados: ordenarAchados(analise.achados) } : null,
    coleta: resumoDaColeta, rascunhosPendentes: rascunhos.length, monitorado: Number(monit?.n || 0) > 0,
    ...abaDaEtapa(c.production_stage),
  });
});

// Dra. Helena confere de novo os documentos contra a história contada. Sem aviso
// no WhatsApp da Dra. (ela está na tela); pedido de reenvio ao cliente vira rascunho.
router.post('/:caseId/analisar', async (req: Request, res: Response) => {
  const caseId = Number(req.params.caseId), userId = req.user!.id;
  const [[c]] = await db.query('SELECT id, title FROM cases WHERE id = ?', [caseId]) as any;
  if (!c) { res.status(404).json({ error: 'Caso não encontrado' }); return; }
  const { analisarCaso } = await import('../services/analistaServico');
  const { notificationService } = await import('../services/NotificationService');
  analisarCaso(caseId, { avisar: false })
    .then((r: any) => notificationService.create({
      userId, caseId, title: r?.ok === false ? 'A Dra. Helena não conseguiu analisar' : 'Análise dos documentos pronta',
      message: r?.ok === false ? `${c.title || 'Processo'} — ${r.erro || 'sem documentos para ler'}` : `${c.title || 'Processo'} — veja na aba Caso da mesa.`,
      notificationType: 'analise_documentos', channel: 'sistema', scheduledAt: new Date(),
    }))
    .catch(() => {});
  res.status(202).json({ success: true, emAndamento: true });
});

router.get('/documento/:id', async (req: Request, res: Response) => {
  const [[d]] = await db.query('SELECT id, case_id, name, content, content_html, versao_de, final_em, updated_at FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!d) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
  res.json({
    id: d.id, case_id: d.case_id, name: d.name, versao_de: d.versao_de, final_em: d.final_em, updated_at: d.updated_at,
    peticao: ehPeticao(d.name), origem: d.versao_de ? 'dra' : 'equipe',
    html: d.content_html ? sanitizarHtmlPeca(d.content_html) : textoParaHtml(d.content || ''),
    colchetes: contarColchetes(d.content || ''),
  });
});

// Salva a edição. Versão da equipe: cria (ou continua) a versão da Dra.; a da equipe não muda.
router.post('/documento/:id/edicao', async (req: Request, res: Response) => {
  const html = req.body?.html;
  if (typeof html !== 'string' || !html.trim()) { res.status(400).json({ error: 'Texto vazio' }); return; }
  if (html.length > MAX_HTML) { res.status(413).json({ error: 'A peça passou do tamanho máximo' }); return; }
  const [[base]] = await db.query('SELECT id, client_id, case_id, name, versao_de, final_em FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!base) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
  if (!ehPeticao(base.name)) { res.status(400).json({ error: 'Só a petição é editada na mesa' }); return; }
  if (base.final_em) { res.status(409).json({ error: 'Esta é a versão final, travada. Destrave para editar.' }); return; }

  const limpo = sanitizarHtmlPeca(html);
  const texto = htmlParaTexto(limpo);
  let alvo = base.versao_de ? base : null;
  if (!alvo) {
    const [[aberta]] = await db.query('SELECT id, name FROM documents WHERE versao_de = ? AND final_em IS NULL ORDER BY id DESC LIMIT 1', [base.id]) as any;
    alvo = aberta || null;
  }
  if (alvo) {
    await db.query('UPDATE documents SET content = ?, content_html = ? WHERE id = ?', [texto, limpo, alvo.id]);
    res.json({ id: alvo.id, name: alvo.name, criada: false, colchetes: contarColchetes(texto), salvo_em: new Date() });
    return;
  }
  const [irmas] = await db.query(
    "SELECT name FROM documents WHERE (case_id = ? OR id IN (SELECT document_id FROM pecas_conjuntas WHERE case_id = ?)) AND name LIKE 'Petição Inicial%'",
    [base.case_id, base.case_id]) as any;
  const n = Math.max(0, ...irmas.map((d: any) => numeroDaVersao(d.name))) + 1;
  const nome = nomeVersaoDra(base.name, n);
  const [ins] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, content_html, status, created_by, versao_de)
     VALUES (?, ?, ?, 'peca', 'processos', ?, ?, 'pendente', ?, ?)`,
    [base.client_id, base.case_id, nome, texto, limpo, req.user!.id, base.id]) as any;
  await db.query(
    "INSERT INTO production_notes (case_id, user_id, author_name, kind, text) VALUES (?, ?, ?, 'atualizacao', ?)",
    [base.case_id, req.user!.id, req.user!.name, `Começou a editar a petição: v${n} criada a partir da v${numeroDaVersao(base.name)} da equipe, que fica intacta.`]).catch(() => {});
  res.status(201).json({ id: ins.insertId, name: nome, criada: true, colchetes: contarColchetes(texto), salvo_em: new Date() });
});

async function aprender(docId: number): Promise<any[]> {
  const [[d]] = await db.query(
    `SELECT d.id, d.case_id, d.content, d.versao_de, c.legal_area, cl.name AS cliente
       FROM documents d LEFT JOIN cases c ON c.id = d.case_id LEFT JOIN clients cl ON cl.id = c.client_id WHERE d.id = ?`, [docId]) as any;
  if (!d?.versao_de) throw new Error('Esta versão não foi editada a partir de uma versão da equipe');
  const [[base]] = await db.query('SELECT content FROM documents WHERE id = ?', [d.versao_de]) as any;
  const { pares } = compararTextos(base?.content || '', d.content || '');
  let licoes: Array<{ titulo: string; mudou: string; regra: string }> = [];
  if (pares.length) {
    const r = await aiComplete(promptLicoes(d.legal_area, pares), 'openai-medio');
    if (!r.ok || !r.text) throw new Error(r.message || 'A IA não respondeu');
    licoes = parseLicoes(r.text);
  }
  await db.query("DELETE FROM peca_licoes WHERE document_id = ? AND decisao = 'pendente'", [docId]);
  for (const l of licoes) {
    await db.query('INSERT INTO peca_licoes (case_id, area, document_id, titulo, mudou, regra) VALUES (?, ?, ?, ?, ?, ?)',
      [d.case_id, d.legal_area || null, docId, l.titulo, l.mudou, l.regra]);
  }
  registrarAcaoAgente('laya', `comparou a correção da Dra. na peça de ${d.cliente || 'cliente'} e anotou ${licoes.length} lição(ões)`);
  const [rows] = await db.query('SELECT id, document_id, titulo, mudou, regra, decisao FROM peca_licoes WHERE case_id = ? ORDER BY id', [d.case_id]) as any;
  return rows;
}

router.post('/documento/:id/final', async (req: Request, res: Response) => {
  const [[d]] = await db.query('SELECT id, case_id, name, versao_de FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!d || !ehPeticao(d.name)) { res.status(400).json({ error: 'Só a petição pode ser a versão final' }); return; }
  if (req.body?.final) {
    await db.query("UPDATE documents SET final_em = NULL WHERE case_id = ? AND name LIKE 'Petição Inicial%' AND id <> ?", [d.case_id, d.id]);
    await db.query('UPDATE documents SET final_em = NOW() WHERE id = ?', [d.id]);
    await db.query("INSERT INTO production_notes (case_id, user_id, author_name, kind, text) VALUES (?, ?, ?, 'atualizacao', ?)",
      [d.case_id, req.user!.id, req.user!.name, `Versão final marcada: ${d.name}.`]).catch(() => {});
    if (d.versao_de) aprender(d.id).catch((e) => console.error('[mesa] lições:', e?.message || e));
  } else {
    await db.query('UPDATE documents SET final_em = NULL WHERE id = ?', [d.id]);
  }
  res.json({ success: true });
});

router.get('/documento/:id/comparar', async (req: Request, res: Response) => {
  const [[d]] = await db.query('SELECT id, name, content, versao_de FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!d?.versao_de) { res.status(400).json({ error: 'Esta versão não tem uma versão da equipe para comparar' }); return; }
  const [[base]] = await db.query('SELECT id, name, content FROM documents WHERE id = ?', [d.versao_de]) as any;
  res.json({ base: base ? { id: base.id, name: base.name } : null, doc: { id: d.id, name: d.name }, ...compararTextos(base?.content || '', d.content || '') });
});

router.post('/documento/:id/aprender', async (req: Request, res: Response) => {
  try { res.json({ licoes: await aprender(Number(req.params.id)) }); }
  catch (e: any) { res.status(502).json({ error: e?.message || 'Não foi possível comparar agora' }); }
});

// Revisão automática sob demanda (depois de editar a peça). Em segundo plano, com aviso no sino.
router.post('/:caseId/revisar', async (req: Request, res: Response) => {
  const caseId = Number(req.params.caseId), userId = req.user!.id;
  const [[c]] = await db.query('SELECT id, title FROM cases WHERE id = ?', [caseId]) as any;
  if (!c) { res.status(404).json({ error: 'Caso não encontrado' }); return; }
  const { revisarPeticaoDoCaso } = await import('../services/peticaoReviewer');
  const { notificationService } = await import('../services/NotificationService');
  const avisar = (ok: boolean, message: string) => notificationService.create({
    userId, caseId, title: ok ? 'Revisão da petição concluída' : 'Falha ao revisar a petição', message,
    notificationType: ok ? 'revisao_concluida' : 'revisao_falhou', channel: 'sistema', scheduledAt: new Date(),
  }).catch(() => {});
  revisarPeticaoDoCaso(caseId, userId)
    .then((r) => avisar(r.ok, r.ok ? `${c.title || 'Processo'} — parecer na aba Revisão da mesa do caso.` : (r.message || 'Erro desconhecido')))
    .catch((e: any) => avisar(false, `${c.title || 'Processo'} — ${e?.message || 'Erro desconhecido'}`));
  res.status(202).json({ success: true, emAndamento: true });
});

router.post('/licao/:id', async (req: Request, res: Response) => {
  const decisao = String(req.body?.decisao || '');
  if (!['regra', 'caso', 'pendente'].includes(decisao)) { res.status(400).json({ error: 'Decisão inválida' }); return; }
  const [[l]] = await db.query('SELECT id, regra FROM peca_licoes WHERE id = ?', [req.params.id]) as any;
  if (!l) { res.status(404).json({ error: 'Lição não encontrada' }); return; }
  await db.query('UPDATE peca_licoes SET decisao = ?, decidida_por = ?, decidida_em = ? WHERE id = ?',
    [decisao, decisao === 'pendente' ? null : req.user!.id, decisao === 'pendente' ? null : new Date(), l.id]);
  if (decisao === 'regra') registrarAcaoAgente('laya', `aprendeu uma regra nova: ${String(l.regra).slice(0, 140)}`);
  res.json({ success: true });
});

export default router;
