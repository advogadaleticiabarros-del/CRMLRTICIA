import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';
import { ajustarEntradaParceria } from '../services/partnerEntry';
import { createProductionFolder } from '../services/DriveService';
import { slaDiasEfetivosSql, pendenciasAbertasSql } from '../services/productionSla';
import { normalizePhone } from '../services/whatsappQueue';

const router = Router();

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

// ── GET /api/partners — lista de parceiros ──────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM partners ORDER BY active DESC, name ASC') as any;
  res.json(rows);
});

// ── POST /api/partners — cadastra um parceiro ───────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) { res.status(400).json({ error: 'O nome do parceiro é obrigatório' }); return; }
  const [r] = await db.query(
    `INSERT INTO partners (name, phone, success_fee_percent, partner_split_percent, sucumbencia_split_percent, entry_value_single, entry_value_double, entry_split, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [String(b.name).trim(), normalizePhone(b.phone), Number(b.success_fee_percent) || 30, Number(b.partner_split_percent) || 50,
     Number(b.sucumbencia_split_percent) || 50, Number(b.entry_value_single) || 100, Number(b.entry_value_double) || 130,
     b.entry_split ? 1 : 0, b.notes ?? null]
  ) as any;
  res.status(201).json({ id: r.insertId });
});

// ── PUT /api/partners/:id ───────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const b = req.body || {};
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any) => { if (val !== undefined) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('name', b.name?.trim?.());
  setIf('phone', b.phone !== undefined ? normalizePhone(b.phone) : undefined);
  setIf('success_fee_percent', b.success_fee_percent !== undefined ? Number(b.success_fee_percent) : undefined);
  setIf('partner_split_percent', b.partner_split_percent !== undefined ? Number(b.partner_split_percent) : undefined);
  setIf('sucumbencia_split_percent', b.sucumbencia_split_percent !== undefined ? Number(b.sucumbencia_split_percent) : undefined);
  setIf('entry_value_single', b.entry_value_single !== undefined ? Number(b.entry_value_single) : undefined);
  setIf('entry_value_double', b.entry_value_double !== undefined ? Number(b.entry_value_double) : undefined);
  setIf('entry_split', b.entry_split !== undefined ? (b.entry_split ? 1 : 0) : undefined);
  setIf('notes', b.notes);
  setIf('active', b.active !== undefined ? (b.active ? 1 : 0) : undefined);
  if (!fields.length) { res.status(400).json({ error: 'Nada para atualizar' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE partners SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ── POST /api/partners/:id/cases — registra cliente + processos da parceria ──
// Cria o cliente (sem passar pelo lead), os casos já na esteira de produção
// (mesmo SLA) e a entrada por protocolo no financeiro.
router.post('/:id/cases', async (req: Request, res: Response) => {
  const b = req.body || {};
  const [[partner]] = await db.query('SELECT * FROM partners WHERE id = ?', [req.params.id]) as any;
  if (!partner) { res.status(404).json({ error: 'Parceiro não encontrado' }); return; }

  const nome = String(b.client_name || '').trim();
  if (!nome) { res.status(400).json({ error: 'Nome do cliente é obrigatório' }); return; }
  const area = AREAS.includes(b.legal_area) ? b.legal_area : 'outro';
  const processos: any[] = Array.isArray(b.processos) && b.processos.length ? b.processos : [{ title: nome }];

  // Cliente — dedup por nome (ou cria)
  let clientId: number;
  // Uma pessoa = uma ficha (CPF, nome sem acento, telefone, e-mail); completa só o que falta.
  {
    const { encontrarOuCriarCliente } = await import('../services/fichaUnica');
    clientId = (await encontrarOuCriarCliente({ nome, cpf: b.cpf || null, email: b.email || null, phone: b.phone || null,
      notes: `Cliente indicado pela parceria ${partner.name}.`, createdBy: req.user!.id })).id;
  }

  // Casos — um por processo, já na esteira de produção (SLA conta a partir de agora)
  const labels = JSON.stringify([`Parceria: ${partner.name}`]);
  const caseIds: number[] = [];
  for (const proc of processos) {
    const title = String(proc.title || proc.process_number || nome).trim() || nome;
    const [cr] = await db.query(
      `INSERT INTO cases (user_id, client_id, partner_id, title, case_number, legal_area, status,
                          production_stage, production_started_at, production_labels, description)
       VALUES (?, ?, ?, ?, ?, ?, 'ativo', 'em_analise', NOW(), ?, ?)`,
      [req.user!.id, clientId, partner.id, title, proc.process_number || null, area, labels, b.case_summary || null]
    ) as any;
    caseIds.push(cr.insertId);

    // NOVO: Auto-criar pasta Drive para o novo caso
    const description = (proc.process_number || proc.title || nome).substring(0, 50);
    createProductionFolder(req.user!.id, nome, area, description)
      .then((result) => {
        if (result) {
          db.query('UPDATE cases SET drive_folder_url = ? WHERE id = ?', [result.folderUrl, cr.insertId]).catch(() => {});
        }
      })
      .catch(() => {}); // Silent fail — não bloqueia o fluxo
  }

  // Etiqueta o cliente com a área
  try {
    const [[cl]] = await db.query('SELECT areas FROM clients WHERE id = ?', [clientId]) as any;
    let arr: string[] = [];
    try { arr = cl?.areas ? (typeof cl.areas === 'string' ? JSON.parse(cl.areas) : cl.areas) : []; } catch {}
    if (!Array.isArray(arr)) arr = [];
    if (!arr.includes(area)) { arr.push(area); await db.query('UPDATE clients SET areas = ? WHERE id = ?', [JSON.stringify(arr), clientId]); }
  } catch { /* coluna areas pode não existir antes da migration 046 */ }

  // Entrada da parceria: NÃO é lançada no registro — a cobrança só nasce (fica
  // "a receber") quando o caso é PROTOCOLADO (ver rota production-stage em cases.ts).
  await logTimeline({
    clientId, caseId: caseIds[0] ?? null, eventType: 'parceria_registrada',
    description: `Cliente registrado pela parceria ${partner.name} — ${processos.length} processo(s) na esteira · entrada será cobrada no protocolo.`,
    userId: req.user!.id,
  });

  res.status(201).json({ success: true, client_id: clientId, case_ids: caseIds, entrada: 0 });
});

// ── GET /api/partners/:id/cases — acompanhamento dos casos da parceria ──────
router.get('/:id/cases', async (req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT c.id, c.title, c.case_number, c.legal_area, c.production_stage, c.production_started_at, c.status,
           ${slaDiasEfetivosSql('c.id', 'c.production_started_at')} AS sla_days,
           ${pendenciasAbertasSql('c.id')} AS pendencias,
           cl.name AS client_name,
           (SELECT COALESCE(SUM(valor),0) FROM financial_records fr WHERE fr.case_id = c.id AND fr.tipo='receita') AS receita,
           (SELECT COALESCE(SUM(valor),0) FROM repasses r WHERE r.case_id = c.id) AS repasse_parceiro,
           pf.id AS fechamento_id, pf.valor_sacado AS fech_sacado, pf.valor_repasse AS fech_repasse,
           pf.valor_cliente AS fech_cliente, pf.valor_parceira AS fech_parceira, pf.valor_escritorio AS fech_escritorio,
           pf.recibo_document_id AS fech_recibo, pf.video_document_id AS fech_video
      FROM cases c
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN parceria_fechamentos pf ON pf.case_id = c.id
     WHERE c.partner_id = ?
     ORDER BY c.created_at DESC`, [req.params.id]) as any;
  res.json(rows);
});

// ── POST /api/partners/cases/:caseId/resultado — êxito/sucumbência + repasse ─
// Calcula a receita do escritório e o repasse ao parceiro conforme o acordo:
// - êxito: receita = ganho × success_fee% (ex.: 30%); repasse = receita × split% (50%).
// - sucumbência: receita = valor recebido; repasse = valor × sucumbencia_split% (50%).
router.post('/cases/:caseId/resultado', async (req: Request, res: Response) => {
  const kind = req.body?.kind === 'sucumbencia' ? 'sucumbencia' : 'exito';
  const val = Number(req.body?.amount) || 0;
  if (val <= 0) { res.status(400).json({ error: 'Informe o valor (maior que zero)' }); return; }

  const [[c]] = await db.query(`
    SELECT c.id, c.client_id, cl.name AS client_name, c.partner_id,
           p.name AS partner_name, p.success_fee_percent, p.partner_split_percent, p.sucumbencia_split_percent
      FROM cases c
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN partners p ON p.id = c.partner_id
     WHERE c.id = ?`, [req.params.caseId]) as any;
  if (!c || !c.partner_id) { res.status(404).json({ error: 'Caso de parceria não encontrado' }); return; }

  let receita = 0, repasse = 0, desc = '', pct = 0;
  if (kind === 'sucumbencia') {
    pct = Number(c.sucumbencia_split_percent) || 50;
    receita = val;
    repasse = val * pct / 100;
    desc = `Sucumbência — ${c.client_name}`;
  } else {
    const feePct = Number(c.success_fee_percent) || 30;
    pct = Number(c.partner_split_percent) || 50;
    receita = val * feePct / 100;       // o escritório recebe o % do êxito
    repasse = receita * pct / 100;      // metade desse % vai ao parceiro
    desc = `Êxito (${feePct}% sobre R$ ${val.toFixed(2)}) — ${c.client_name}`;
  }
  receita = Math.round(receita * 100) / 100;
  repasse = Math.round(repasse * 100) / 100;

  // Receita da parceria (êxito/sucumbência) e repasse ficam "pendentes de data": o vencimento
  // só é definido quando o valor for efetivamente pago (pedido 02/10/2026).
  await db.query(
    `INSERT INTO financial_records (user_id, client_id, case_id, tipo, description, valor, status, due_date)
     VALUES (?, ?, ?, 'receita', ?, ?, 'pendente', NULL)`,
    [req.user!.id, c.client_id, c.id, desc, receita]
  );
  await db.query(
    `INSERT INTO repasses (case_id, parceiro, tipo, valor, percentual, descricao, status, data_vencimento)
     VALUES (?, ?, 'indicacao', ?, ?, ?, 'pendente', NULL)`,
    [c.id, c.partner_name, repasse, pct, `Repasse ${kind === 'sucumbencia' ? 'sucumbência' : 'êxito'} — ${c.client_name}`]
  );

  await logTimeline({
    clientId: c.client_id, caseId: c.id, eventType: `parceria_${kind}`,
    description: `${kind === 'sucumbencia' ? 'Sucumbência' : 'Êxito'} registrado: receita R$ ${receita.toFixed(2)} · repasse ${c.partner_name} R$ ${repasse.toFixed(2)}.`,
    userId: req.user!.id,
  });

  res.json({ success: true, receita, repasse });
});

// ── Fechamento do caso com RPV (13/11/2026) ─────────────────────────────────
// A Dra. saca o RPV, repassa à parceira (cliente + parte da parceria), a parceira
// paga a cliente e manda recibo + vídeo-depoimento. Regra em fechamentoRpvParceria.ts.

router.get('/cases/:caseId/fechamento', async (req: Request, res: Response) => {
  const caseId = Number(req.params.caseId);
  const { repoFechamentoMysql, lerFechamento } = await import('../services/fechamentoRpvParceriaMysql');
  const { situacaoFechamento } = await import('../services/fechamentoRpvParceria');
  const caso = await repoFechamentoMysql.buscarCaso(caseId);
  if (!caso || !caso.partner_id) { res.status(404).json({ error: 'Caso de parceria não encontrado' }); return; }
  const f = await lerFechamento(caseId);
  const [[cv]] = await db.query('SELECT valor_causa FROM cases WHERE id = ?', [caseId]).catch(() => [[null]]) as any;
  res.json({
    caso: { id: caso.id, client_name: caso.client_name, case_number: caso.case_number, partner_name: caso.partner_name, valor_causa: cv?.valor_causa ?? null },
    acordo: { honorarios_percentual: Number(caso.success_fee_percent ?? 30), parceira_percentual: Number(caso.partner_split_percent ?? 50) },
    fechamento: f,
    situacao: f ? situacaoFechamento(f) : null,
  });
});

router.post('/cases/:caseId/fechamento', async (req: Request, res: Response) => {
  const { registrarFechamentoRpv, ErroFechamento } = await import('../services/fechamentoRpvParceria');
  const { repoFechamentoMysql } = await import('../services/fechamentoRpvParceriaMysql');
  const b = req.body || {};
  try {
    const out = await registrarFechamentoRpv(repoFechamentoMysql, {
      caseId: Number(req.params.caseId), userId: req.user!.id, valorSacado: Number(b.valor_sacado),
      honorariosPercentual: b.honorarios_percentual, parceiraPercentual: b.parceira_percentual,
      valorCliente: b.valor_cliente, valorParceira: b.valor_parceira,
      dataSaque: b.data_saque, dataRepasse: b.data_repasse, dataPagamentoCliente: b.data_pagamento_cliente,
      observacoes: b.observacoes,
    });
    res.json({ success: true, ...out });
  } catch (err) {
    if (err instanceof ErroFechamento) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

const LIMITE_RECIBO = 15 * 1024 * 1024;
const LIMITE_VIDEO = 500 * 1024 * 1024;

/** Recibo/vídeo: corpo cru (o arquivo em si), tipo e nome na URL. Vai para a pasta do caso no Drive. */
router.post('/cases/:caseId/fechamento/arquivo', async (req: Request, res: Response) => {
  const caseId = Number(req.params.caseId);
  const tipo = req.query.tipo === 'video' ? 'video' : req.query.tipo === 'recibo' ? 'recibo' : null;
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const nomeOriginal = String(req.query.nome || '').replace(/[\\/:*?"<>|\r\n]/g, ' ').trim().slice(0, 150);
  if (!tipo) { res.status(400).json({ error: 'Tipo deve ser recibo ou video' }); return; }
  const aceito = tipo === 'video' ? mime.startsWith('video/') : (mime.startsWith('image/') || mime === 'application/pdf');
  if (!aceito) { res.status(400).json({ error: tipo === 'video' ? 'Envie um arquivo de vídeo' : 'O recibo deve ser PDF ou foto' }); return; }
  const limite = tipo === 'video' ? LIMITE_VIDEO : LIMITE_RECIBO;
  if (Number(req.headers['content-length'] || 0) > limite) {
    res.status(413).json({ error: tipo === 'video' ? 'Vídeo maior que 500 MB: cole o link do Drive' : 'Recibo maior que 15 MB' }); return;
  }

  const { lerFechamento, ligarComprovante } = await import('../services/fechamentoRpvParceriaMysql');
  const f = await lerFechamento(caseId);
  if (!f) { res.status(400).json({ error: 'Registre os valores do fechamento antes de anexar' }); return; }
  const [[c]] = await db.query('SELECT client_id FROM cases WHERE id = ?', [caseId]) as any;
  const rotulo = tipo === 'video' ? 'Vídeo-depoimento do recebimento' : 'Recibo de pagamento à cliente';
  const nome = `${rotulo}${nomeOriginal ? ' - ' + nomeOriginal : ''}`;

  const { enviarArquivoParaPastaDoCaso } = await import('../services/partnerInboxService');
  const { PassThrough, Readable } = await import('stream');
  let documentId: number;
  try {
    if (tipo === 'recibo') {
      // Recibo é pequeno: lê inteiro; se o Drive falhar, guarda no próprio CRM.
      const partes: Buffer[] = []; let total = 0;
      for await (const ch of req) { total += ch.length; if (total > LIMITE_RECIBO) { res.status(413).json({ error: 'Recibo maior que 15 MB' }); return; } partes.push(ch as Buffer); }
      const buf = Buffer.concat(partes);
      if (!buf.length) { res.status(400).json({ error: 'Arquivo vazio' }); return; }
      let url: string | null = null;
      try { url = (await enviarArquivoParaPastaDoCaso(c.client_id, caseId, nome, mime, Readable.from(buf))).url; }
      catch (e) { console.warn('[fechamento] recibo fica no CRM — Drive falhou:', e instanceof Error ? e.message : e); }
      const [ins] = await db.query(
        `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, data, mime, status, created_by)
         VALUES (?, ?, ?, 'recibo_parceria', 'financeiro', ?, ?, ?, 'recebido', ?)`,
        [c.client_id, caseId, nome, url, url ? null : buf, url ? null : mime, req.user!.id]) as any;
      documentId = ins.insertId;
    } else {
      // Vídeo: em fluxo direto para o Drive, contando o tamanho.
      let total = 0;
      const contador = new PassThrough();
      req.on('data', (ch: Buffer) => { total += ch.length; if (total > LIMITE_VIDEO) req.destroy(new Error('Vídeo maior que 500 MB')); });
      req.pipe(contador);
      const up = await enviarArquivoParaPastaDoCaso(c.client_id, caseId, nome, mime, contador);
      const [ins] = await db.query(
        `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, status, created_by)
         VALUES (?, ?, ?, 'video_depoimento', 'financeiro', ?, 'recebido', ?)`,
        [c.client_id, caseId, nome, up.url, req.user!.id]) as any;
      documentId = ins.insertId;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[fechamento] envio do arquivo falhou:', msg);
    if (!res.headersSent) res.status(502).json({ error: `Não foi possível enviar ao Drive (${msg}). Cole o link do arquivo.` });
    return;
  }
  await ligarComprovante(caseId, tipo, documentId);
  await logTimeline({ clientId: c.client_id, caseId, eventType: 'parceria_fechamento_comprovante', description: `${rotulo} anexado ao fechamento.`, userId: req.user!.id });
  res.status(201).json({ success: true, document_id: documentId });
});

/** Recibo/vídeo que já está num link (Drive, por exemplo). */
router.post('/cases/:caseId/fechamento/link', async (req: Request, res: Response) => {
  const caseId = Number(req.params.caseId);
  const tipo = req.body?.tipo === 'video' ? 'video' : req.body?.tipo === 'recibo' ? 'recibo' : null;
  const url = String(req.body?.url || '').trim();
  if (!tipo) { res.status(400).json({ error: 'Tipo deve ser recibo ou video' }); return; }
  if (!/^https:\/\/\S+$/i.test(url) || url.length > 1000) { res.status(400).json({ error: 'Cole um link começando com https://' }); return; }
  const { lerFechamento, ligarComprovante } = await import('../services/fechamentoRpvParceriaMysql');
  if (!(await lerFechamento(caseId))) { res.status(400).json({ error: 'Registre os valores do fechamento antes de anexar' }); return; }
  const [[c]] = await db.query('SELECT client_id FROM cases WHERE id = ?', [caseId]) as any;
  const rotulo = tipo === 'video' ? 'Vídeo-depoimento do recebimento' : 'Recibo de pagamento à cliente';
  const [ins] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, status, created_by)
     VALUES (?, ?, ?, ?, 'financeiro', ?, 'recebido', ?)`,
    [c.client_id, caseId, rotulo, tipo === 'video' ? 'video_depoimento' : 'recibo_parceria', url, req.user!.id]) as any;
  await ligarComprovante(caseId, tipo, ins.insertId);
  await logTimeline({ clientId: c.client_id, caseId, eventType: 'parceria_fechamento_comprovante', description: `${rotulo} (link) anexado ao fechamento.`, userId: req.user!.id });
  res.status(201).json({ success: true, document_id: ins.insertId });
});

export default router;
