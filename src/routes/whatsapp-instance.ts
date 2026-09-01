import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { env } from '../config/env';
import {
  startInstance, disconnectInstance, sendText, sendMedia, getStatus, getLastError, setAutoSend, editarMensagem, apagarMensagem,
  reagirMensagem, marcarComoLida, bloquearContato, obterNotaDoChat, salvarNotaDoChat, enviarPresenca,
  arquivarConversaNativo, fixarConversaNativo, marcarChatLido, silenciarChat, apagarConversaWhatsapp,
  configurarMensagensEfemeras, solicitarHistoricoAntigo, listarRespostasRapidas, salvarRespostaRapida, excluirRespostaRapida,
} from '../services/uazapiInstance';
import { uazapi } from '../services/uazapiClient';
import { stripDataUrlPrefix } from '../utils/dataUrl';

const router = Router();

// ── URLs de mídia ASSINADAS (HMAC) ───────────────────────────────────────────
// Links de anexo abrem em nova aba (sem header Authorization). Em vez de expor
// o token de sessão na URL (fica em logs), assinamos o link com HMAC curto e
// validade de 24h — o link só serve para AQUELE arquivo.
function mediaSig(id: string | number, exp: number): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`media:${id}:${exp}`).digest('hex').slice(0, 32);
}
export function signMediaUrl(url: string): string {
  const m = String(url || '').match(/^\/api\/whatsapp-instance\/media\/(\d+)/);
  if (!m) return url;
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  return `/api/whatsapp-instance/media/${m[1]}?e=${exp}&s=${mediaSig(m[1], exp)}`;
}

/** Handler PÚBLICO da mídia (montado antes do authenticate no app.ts):
 *  aceita a assinatura HMAC (?e=&s=) — sem ela, cai no fluxo autenticado normal. */
export async function mediaHandler(req: Request, res: Response, next: () => void): Promise<void> {
  const exp = Number(req.query.e);
  const sig = String(req.query.s || '');
  const okSig = exp && sig.length === 32 && exp > Math.floor(Date.now() / 1000)
    && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mediaSig(req.params.id, exp)));
  if (!okSig) { next(); return; } // sem assinatura válida → exige login (rota autenticada)
  const [rows] = await db.query(
    'SELECT file_name, mime, data FROM whatsapp_media WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Arquivo não encontrado' }); return; }
  const f = rows[0];
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.file_name)}"`);
  res.send(f.data);
}

// ── GET /api/whatsapp-instance/status — conexão + QR (quando aguardando) ────
// getStatus() consulta a Uazapi ao vivo (não é mais estado em memória só) — precisa de await.
router.get('/status', async (_req: Request, res: Response) => {
  res.json(await getStatus());
});

// ── POST /api/whatsapp-instance/connect — inicia (gera QR se sem sessão) ────
router.post('/connect', async (_req: Request, res: Response) => {
  await startInstance();
  res.json(await getStatus());
});

// ── POST /api/whatsapp-instance/disconnect — encerra e apaga a sessão ───────
router.post('/disconnect', async (_req: Request, res: Response) => {
  await disconnectInstance();
  res.json(await getStatus());
});

// ── POST /api/whatsapp-instance/auto — liga/desliga o envio automático ──────
router.post('/auto', async (req: Request, res: Response) => {
  setAutoSend(!!req.body?.on);
  res.json(await getStatus());
});

// ── Mensagens prontas (modelos jurídicos com {{nome}}) ──────────────────────
router.get('/templates', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT id, title, body FROM whatsapp_templates ORDER BY title ASC') as any;
  res.json(rows);
});
router.post('/templates', async (req: Request, res: Response) => {
  const { title, body } = req.body || {};
  if (!title || !body) { res.status(400).json({ error: 'Informe título e mensagem' }); return; }
  const [r] = await db.query('INSERT INTO whatsapp_templates (title, body) VALUES (?, ?)',
    [String(title).slice(0, 120), String(body).slice(0, 4000)]) as any;
  res.status(201).json({ id: r.insertId });
});
router.put('/templates/:id', async (req: Request, res: Response) => {
  const { title, body } = req.body || {};
  if (!title || !body) { res.status(400).json({ error: 'Informe título e mensagem' }); return; }
  await db.query('UPDATE whatsapp_templates SET title = ?, body = ? WHERE id = ?',
    [String(title).slice(0, 120), String(body).slice(0, 4000), req.params.id]);
  res.json({ success: true });
});
router.delete('/templates/:id', async (req: Request, res: Response) => {
  await db.query('DELETE FROM whatsapp_templates WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── Editar/apagar uma mensagem já enviada (só as nossas) ────────────────────
router.put('/messages/:id', async (req: Request, res: Response) => {
  const texto = String(req.body?.text || '').trim();
  if (!texto) { res.status(400).json({ error: 'Escreva o novo texto' }); return; }
  const ok = await editarMensagem(Number(req.params.id), texto);
  if (!ok) { res.status(400).json({ error: 'Não deu pra editar — pode ter passado do prazo do WhatsApp (~15min), ou a mensagem não é sua' }); return; }
  res.json({ success: true });
});
router.delete('/messages/:id', async (req: Request, res: Response) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) { res.status(400).json({ error: 'Informe o motivo da exclusão' }); return; }
  const ok = await apagarMensagem(Number(req.params.id), reason, req.user!.id);
  if (!ok) { res.status(400).json({ error: 'Não deu pra apagar — pode ter passado do prazo do WhatsApp, ou a mensagem não é sua' }); return; }
  res.json({ success: true });
});

// ── GET /api/whatsapp-instance/messages/deletions — auditoria de exclusões ──
router.get('/messages/deletions', async (_req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT d.id, d.phone, d.body_original, d.reason, d.deleted_at, u.name AS deleted_by_name
      FROM whatsapp_message_deletions d
      LEFT JOIN users u ON u.id = d.deleted_by
     ORDER BY d.deleted_at DESC LIMIT 200`) as any;
  res.json(rows);
});

// ── POST /api/whatsapp-instance/media/:id/transcricao — áudio → texto (Whisper)
// Usa o Whisper do Groq (grátis com a GROQ_API_KEY já usada na IA). A transcrição
// fica gravada na própria mensagem — vira prova legível e entra na busca.
router.post('/media/:id/transcricao', async (req: Request, res: Response) => {
  const [[m]] = await db.query('SELECT id, file_name, mime, data FROM whatsapp_media WHERE id = ?', [req.params.id]) as any;
  if (!m) { res.status(404).json({ error: 'Áudio não encontrado' }); return; }
  const { transcreverAudio } = await import('../services/whatsappTranscricao');
  const r = await transcreverAudio(m);
  if (!r.ok) { res.status(400).json({ error: r.erro }); return; }
  // Grava na mensagem (vira registro permanente e pesquisável)
  await db.query(
    "UPDATE whatsapp_messages SET body = CONCAT(body, '\n📝 Transcrição: ', ?) WHERE media_id = ? AND body NOT LIKE '%📝 Transcrição:%'",
    [r.texto.slice(0, 3000), m.id]).catch(() => {});
  res.json({ texto: r.texto });
});

// ── GET /api/whatsapp-instance/chats — conversas (última msg + etiquetas + não lidas)
// ?q= busca também DENTRO das mensagens (nome, telefone ou conteúdo/assunto)
router.get('/chats', async (req: Request, res: Response) => {
  const q = String((req.query as any).q || '').trim();
  const like = `%${q}%`;
  const whereQ = q
    ? `WHERE (w.phone LIKE ?
          OR w.client_id IN (SELECT id FROM clients WHERE name LIKE ?)
          OR w.client_id IN (SELECT client_id FROM cases WHERE case_number LIKE ?)
          OR w.phone IN (SELECT DISTINCT phone FROM whatsapp_messages WHERE body LIKE ?))`
    : '';
  const [rows] = await db.query(`
    SELECT w.phone,
           MAX(w.msg_time) AS last_time,
           SUBSTRING_INDEX(GROUP_CONCAT(w.body ORDER BY w.msg_time DESC, w.id DESC SEPARATOR '\\n§§'), '\\n§§', 1) AS last_body,
           SUBSTRING_INDEX(GROUP_CONCAT(w.from_me ORDER BY w.msg_time DESC, w.id DESC), ',', 1) AS last_from_me,
           MAX(w.client_id) AS client_id,
           MAX(cl.name) AS client_name,
           MAX(m.unread) AS unread,
           MAX(m.labels) AS labels,
           MAX(m.push_name) AS push_name,
           MAX(m.pinned) AS pinned,
           MAX(m.archived) AS archived,
           MAX(m.blocked) AS blocked,
           MAX(m.muted_until) AS muted_until,
           MAX(m.assigned_user_id) AS assigned_user_id,
           MAX(au.name) AS assigned_user_name,
           MIN(aud.dias) AS proxima_audiencia_dias,
           MIN(parc.dias) AS parcela_vencendo_dias
      FROM whatsapp_messages w
      LEFT JOIN clients cl ON cl.id = w.client_id
      LEFT JOIN whatsapp_chat_meta m ON m.phone = w.phone
      LEFT JOIN users au ON au.id = m.assigned_user_id
      LEFT JOIN (
        SELECT COALESCE(ce.client_id, c.client_id) AS client_id, DATEDIFF(ce.start_datetime, CURDATE()) AS dias
          FROM calendar_events ce
          LEFT JOIN cases c ON c.id = ce.case_id
         WHERE ce.event_type = 'audiencia' AND ce.start_datetime >= CURDATE() AND ce.start_datetime < DATE_ADD(CURDATE(), INTERVAL 8 DAY)
      ) aud ON aud.client_id = w.client_id
      LEFT JOIN (
        SELECT client_id, DATEDIFF(due_date, CURDATE()) AS dias
          FROM installments
         WHERE status IN ('pendente', 'vencido', 'em_processamento') AND due_date < DATE_ADD(CURDATE(), INTERVAL 4 DAY)
      ) parc ON parc.client_id = w.client_id
     ${whereQ}
     GROUP BY w.phone
     ORDER BY last_time DESC LIMIT 100`, q ? [like, like, like, like] : []) as any;
  res.json(rows);
});

// ── POST /api/whatsapp-instance/chats/:phone/pin — fixa/desfixa a conversa ──
// Sincroniza com o WhatsApp de verdade (best-effort — se a Uazapi falhar,
// o estado local abaixo já garante o comportamento na tela do CRM).
router.post('/chats/:phone/pin', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const pinned = req.body?.pinned ? 1 : 0;
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, pinned) VALUES (?, ?) ON DUPLICATE KEY UPDATE pinned = VALUES(pinned)',
    [phone, pinned]);
  fixarConversaNativo(phone, !!pinned).catch(() => {});
  res.json({ success: true, pinned: !!pinned });
});

// ── POST /api/whatsapp-instance/chats/:phone/archive — arquiva/desarquiva ───
router.post('/chats/:phone/archive', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const archived = req.body?.archived ? 1 : 0;
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, archived) VALUES (?, ?) ON DUPLICATE KEY UPDATE archived = VALUES(archived)',
    [phone, archived]);
  arquivarConversaNativo(phone, !!archived).catch(() => {});
  res.json({ success: true, archived: !!archived });
});

// ── POST /api/whatsapp-instance/chats/:phone/mute — silencia notificações ───
router.post('/chats/:phone/mute', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const horas = [0, 8, 168, -1].includes(Number(req.body?.hours)) ? Number(req.body.hours) as 0 | 8 | 168 | -1 : 0;
  const mutedUntil = horas === 0 ? null : (horas === -1 ? -1 : Date.now() + horas * 3600_000);
  const ok = await silenciarChat(phone, horas);
  if (!ok) { res.status(400).json({ error: 'Não deu pra silenciar — confira se o WhatsApp está conectado' }); return; }
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, muted_until) VALUES (?, ?) ON DUPLICATE KEY UPDATE muted_until = VALUES(muted_until)',
    [phone, mutedUntil]);
  res.json({ success: true, muted_until: mutedUntil });
});

// ── POST /api/whatsapp-instance/chats/:phone/delete — apaga/limpa a conversa ─
// Sempre limpa (não deleta) o chat NO WHATSAPP por padrão — deletar de fato
// exigiria confirmar de novo do lado da usuária; "limpar" já resolve o caso
// de uso real (conversa de teste, dado sujo) sem correr risco de some sem querer.
router.post('/chats/:phone/delete', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const apagarNoWhatsapp = !!req.body?.deleteChatWhatsApp;
  const ok = await apagarConversaWhatsapp(phone, {
    clearChatWhatsApp: !apagarNoWhatsapp,
    deleteChatWhatsApp: apagarNoWhatsapp,
    deleteChatDB: true,
    deleteMessagesDB: true,
  });
  await db.query('DELETE FROM whatsapp_messages WHERE phone = ?', [phone]).catch(() => {});
  await db.query('DELETE FROM whatsapp_media WHERE phone = ?', [phone]).catch(() => {});
  await db.query('DELETE FROM whatsapp_chat_meta WHERE phone = ?', [phone]).catch(() => {});
  if (!ok) { res.status(400).json({ error: 'A conversa foi removida do CRM, mas não deu pra limpar do lado do WhatsApp (confira a conexão)' }); return; }
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/chats/:phone/ephemeral — mensagens temporárias ─
router.post('/chats/:phone/ephemeral', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const duration = ['off', '1d', '7d', '90d'].includes(req.body?.duration) ? req.body.duration : 'off';
  const ok = await configurarMensagensEfemeras(phone, duration);
  if (!ok) { res.status(400).json({ error: 'Não deu pra configurar — confira se o WhatsApp está conectado' }); return; }
  res.json({ success: true, duration });
});

// ── POST /api/whatsapp-instance/chats/:phone/historico — pede mensagens antigas ─
router.post('/chats/:phone/historico', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const ok = await solicitarHistoricoAntigo(phone, req.body?.count ? Number(req.body.count) : 50);
  if (!ok) { res.status(400).json({ error: 'Não deu pra pedir o histórico — confira se o WhatsApp está conectado' }); return; }
  res.json({ success: true, aviso: 'As mensagens antigas chegam aos poucos pelo webhook — pode levar alguns segundos' });
});

// ── POST /api/whatsapp-instance/chats/:phone/assign — atendente responsável ─
// Atribuição manual (não é fila automática). user_id null = "sem atendente".
router.post('/chats/:phone/assign', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const userId = req.body?.user_id ? Number(req.body.user_id) : null;
  if (userId) {
    const [[u]] = await db.query("SELECT id FROM users WHERE id = ? AND active = 1", [userId]) as any;
    if (!u) { res.status(400).json({ error: 'Usuário não encontrado' }); return; }
  }
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, assigned_user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE assigned_user_id = VALUES(assigned_user_id)',
    [phone, userId]);
  res.json({ success: true, assigned_user_id: userId });
});

// ── POST /api/whatsapp-instance/chats/:phone/read — zera as não lidas ───────
router.post('/chats/:phone/read', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, unread) VALUES (?, 0) ON DUPLICATE KEY UPDATE unread = 0', [phone]);
  marcarChatLido(phone, true).catch(() => {});
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/chats/:phone/labels — etiquetas da conversa ─
router.post('/chats/:phone/labels', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const labels = Array.isArray(req.body?.labels)
    ? req.body.labels.map((l: any) => String(l).trim().slice(0, 30)).filter(Boolean).slice(0, 6)
    : [];
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, labels) VALUES (?, ?) ON DUPLICATE KEY UPDATE labels = VALUES(labels)',
    [phone, JSON.stringify(labels)]);
  res.json({ success: true, labels });
});

// ── POST /api/whatsapp-instance/messages/:id/react — reage com emoji (ou remove) ─
router.post('/messages/:id/react', async (req: Request, res: Response) => {
  const emoji = String(req.body?.emoji ?? '');
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (!phone) { res.status(400).json({ error: 'Informe o telefone da conversa' }); return; }
  const ok = await reagirMensagem(phone, Number(req.params.id), emoji);
  if (!ok) { res.status(400).json({ error: 'Não deu pra reagir a essa mensagem' }); return; }
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/messages/markread — confirma leitura no WhatsApp ─
router.post('/messages/markread', async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) { res.status(400).json({ error: 'Informe os ids das mensagens' }); return; }
  const ok = await marcarComoLida(ids);
  res.json({ success: ok });
});

// ── POST /api/whatsapp-instance/chats/:phone/block — bloqueia/desbloqueia contato ─
router.post('/chats/:phone/block', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const block = !!req.body?.block;
  const ok = await bloquearContato(phone, block);
  if (!ok) { res.status(400).json({ error: 'Não deu pra bloquear/desbloquear — confira se o WhatsApp está conectado' }); return; }
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, blocked) VALUES (?, ?) ON DUPLICATE KEY UPDATE blocked = VALUES(blocked)',
    [phone, block ? 1 : 0]);
  res.json({ success: true, blocked: block });
});

// ── Nota interna do chat (nativa do WhatsApp Business) ──────────────────────
router.get('/chats/:phone/notes', async (req: Request, res: Response) => {
  const notes = await obterNotaDoChat(String(req.params.phone));
  res.json({ notes });
});
router.post('/chats/:phone/notes', async (req: Request, res: Response) => {
  const ok = await salvarNotaDoChat(String(req.params.phone), String(req.body?.notes || ''));
  if (!ok) { res.status(400).json({ error: 'Não deu pra salvar a nota' }); return; }
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/chats/:phone/presence — "digitando…"/"gravando…" ─
router.post('/chats/:phone/presence', async (req: Request, res: Response) => {
  const tipo = req.body?.tipo === 'recording' ? 'recording' : 'composing';
  await enviarPresenca(String(req.params.phone), tipo, req.body?.delay ? Number(req.body.delay) : undefined);
  res.json({ success: true });
});

// ── GET /api/whatsapp-instance/message-limits — diagnóstico de restrição de envio ─
router.get('/message-limits', async (_req: Request, res: Response) => {
  try { res.json(await uazapi.getMessageLimits()); }
  catch (e: any) { res.status(500).json({ error: e?.message || 'Falha ao consultar limites' }); }
});

// ── POST /api/whatsapp-instance/chats/:phone/vincular-cliente — liga a um
// cliente já cadastrado. O reconhecimento de "de quem é essa conversa" no
// resto do módulo é todo por clients.phone (LIKE nos últimos 8 dígitos) —
// então vincular aqui é justamente gravar esse número no cadastro do
// cliente. Se o cliente já tem outro telefone, troca (é uma ação explícita
// da usuária, não automática).
router.post('/chats/:phone/vincular-cliente', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const clientId = Number(req.body?.client_id);
  if (!clientId) { res.status(400).json({ error: 'Selecione um cliente' }); return; }
  const [[cli]] = await db.query('SELECT id, name, phone FROM clients WHERE id = ?', [clientId]) as any;
  if (!cli) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }
  await db.query('UPDATE clients SET phone = ? WHERE id = ?', [phone, clientId]);
  res.json({ success: true, client: { id: cli.id, name: cli.name } });
});

// ── GET /api/whatsapp-instance/chats/:phone — mensagens da conversa ─────────
router.get('/chats/:phone', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const [rows] = await db.query(
    `SELECT w.id, w.from_me, w.body, w.msg_time, w.media_id, w.sent_by, w.status, wm.mime AS media_mime,
            w.reply_to_message_id, w.reply_to_body, w.reply_to_from_me
       FROM whatsapp_messages w LEFT JOIN whatsapp_media wm ON wm.id = w.media_id
      WHERE w.phone = ? ORDER BY w.msg_time ASC, w.id ASC LIMIT 300`, [phone]) as any;
  for (const r of rows) if (r.media_id) r.media_url = signMediaUrl(`/api/whatsapp-instance/media/${r.media_id}`);
  res.json(rows);
});

// ── GET /api/whatsapp-instance/media/:id — arquivo recebido pelo WhatsApp ───
router.get('/media/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    'SELECT file_name, mime, data FROM whatsapp_media WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Arquivo não encontrado' }); return; }
  const f = rows[0];
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.file_name)}"`);
  res.send(f.data);
});

// ── GET /api/whatsapp-instance/chats/:phone/context — painel do cliente ─────
// Tudo que importa sobre quem está do outro lado: ficha, processos, próxima
// audiência, financeiro e última conversa — sem sair do chat.
router.get('/chats/:phone/context', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const tail = phone.slice(-8);

  const [cliRows] = await db.query(
    `SELECT id, name, cpf_cnpj, email FROM clients
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ? LIMIT 1`,
    [`%${tail}`]) as any;
  const client = cliRows[0] || null;

  let lead: any = null;
  if (!client) {
    const [leadRows] = await db.query(
      `SELECT id, name, legal_area, status FROM leads
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ? LIMIT 1`,
      [`%${tail}`]).catch(() => [[]]) as any;
    lead = leadRows[0] || null;
  }

  let cases: any[] = [];
  let audiencia: any = null;
  let financeiro: any = null;
  if (client) {
    const [cs] = await db.query(
      `SELECT id, title, case_number, legal_area, production_stage, status FROM cases
        WHERE client_id = ? ORDER BY created_at DESC LIMIT 6`, [client.id]) as any;
    cases = cs;
    const [[aud]] = await db.query(
      `SELECT title, start_datetime, location, video_link FROM calendar_events
        WHERE event_type = 'audiencia' AND start_datetime >= NOW()
          AND (client_id = ? OR case_id IN (SELECT id FROM cases WHERE client_id = ?))
        ORDER BY start_datetime ASC LIMIT 1`, [client.id, client.id]) as any;
    audiencia = aud || null;
    const [[fin]] = await db.query(
      `SELECT COUNT(*) AS pendentes,
              COALESCE(SUM(valor), 0) AS valor_aberto,
              SUM(CASE WHEN due_date < CURDATE() THEN 1 ELSE 0 END) AS vencidas
         FROM installments WHERE client_id = ? AND status IN ('pendente', 'em_processamento')`, [client.id]) as any;
    financeiro = fin;
  }

  const [[ultima]] = await db.query(
    'SELECT MAX(msg_time) AS t FROM whatsapp_messages WHERE phone = ? AND from_me = 0', [phone]) as any;

  let leadSugerido: any = null;
  if (!client && !lead) {
    const [[meta]] = await db.query(
      'SELECT lead_summary, lead_area, lead_nome FROM whatsapp_chat_meta WHERE phone = ?', [phone]).catch(() => [[]]) as any;
    if (meta?.lead_summary) leadSugerido = { resumo: meta.lead_summary, area: meta.lead_area, nome: meta.lead_nome };
  }

  res.json({ client, lead, cases, audiencia, financeiro, ultima_resposta: ultima?.t || null, lead_sugerido: leadSugerido });
});

// ── POST /api/whatsapp-instance/chats/:phone/send — responder pela instância ─
router.post('/chats/:phone/send', async (req: Request, res: Response) => {
  const text = String(req.body?.text || '').trim();
  if (!text) { res.status(400).json({ error: 'Escreva a mensagem' }); return; }
  const replyTo = req.body?.reply_to ? Number(req.body.reply_to) : undefined;
  const ok = await sendText(req.params.phone, text, req.user!.name, replyTo);
  if (!ok) { res.status(400).json({ error: 'Instância desconectada — conecte na aba Conexão' }); return; }
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/chats/:phone/send-media — envia arquivo ─────
// Duas origens possíveis: um documento já existente no GED do cliente
// (document_id) ou um upload novo do computador (file_base64). Em ambos os
// casos o arquivo é copiado pra whatsapp_media primeiro — é o que permite
// reusar o link assinado (signMediaUrl) que a Uazapi busca, e faz a mensagem
// enviada aparecer na conversa igual a uma recebida.
const MEDIA_ENVIO_MAX = 15 * 1024 * 1024;
router.post('/chats/:phone/send-media', async (req: Request, res: Response) => {
  const phone = req.params.phone;
  const text = String(req.body?.text || '').trim();
  const { document_id, file_base64 } = req.body || {};
  let fileName: string, mime: string, data: Buffer;

  if (document_id) {
    const [[doc]] = await db.query('SELECT name, mime, data FROM documents WHERE id = ?', [document_id]) as any;
    if (!doc || !doc.data) { res.status(400).json({ error: 'Documento sem arquivo anexado' }); return; }
    fileName = doc.name || 'documento'; mime = doc.mime || 'application/octet-stream'; data = doc.data;
  } else if (file_base64) {
    const nome = String(req.body?.file_name || 'arquivo').slice(0, 255);
    const m = String(req.body?.mime || 'application/octet-stream');
    const buf = Buffer.from(stripDataUrlPrefix(file_base64), 'base64');
    if (!buf.length) { res.status(400).json({ error: 'Arquivo vazio' }); return; }
    if (buf.length > MEDIA_ENVIO_MAX) { res.status(400).json({ error: 'Arquivo maior que 15MB' }); return; }
    fileName = nome; mime = m; data = buf;
  } else {
    res.status(400).json({ error: 'Envie document_id ou file_base64' }); return;
  }

  const tail = phone.replace(/\D/g, '').slice(-8);
  const [[cli]] = await db.query(
    "SELECT id FROM clients WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ? LIMIT 1",
    [`%${tail}`]) as any;
  const [ins] = await db.query(
    'INSERT INTO whatsapp_media (phone, client_id, file_name, mime, data) VALUES (?, ?, ?, ?, ?)',
    [phone.replace(/\D/g, ''), cli?.id ?? null, fileName.slice(0, 255), mime, data]) as any;

  const ok = await sendMedia(phone, ins.insertId, text, req.user!.name, !!req.body?.as_voice);
  if (!ok) { res.status(400).json({ error: getLastError() || 'Falha ao enviar — confira a conexão na aba Conexão' }); return; }
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/chats/:phone/anotacao — anotação na timeline ─
router.post('/chats/:phone/anotacao', async (req: Request, res: Response) => {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) { res.status(400).json({ error: 'Escreva a anotação' }); return; }
  const phone = String(req.params.phone).replace(/\D/g, '');
  const tail = phone.slice(-8);
  const [cli] = await db.query(
    `SELECT id FROM clients WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ? LIMIT 1`,
    [`%${tail}`]) as any;
  if (!cli.length) { res.status(400).json({ error: 'Este contato ainda não é um cliente cadastrado' }); return; }
  const { logTimeline } = await import('../services/TimelineService');
  await logTimeline({
    clientId: cli[0].id, eventType: 'whatsapp',
    description: `Anotação do atendimento (WhatsApp): ${texto}`,
    userId: req.user!.id,
  });
  res.status(201).json({ success: true });
});

// ── Etapas do quadro Kanban de contatos — totalmente editáveis pela usuária ──
router.get('/stages', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT id, name, color, position FROM whatsapp_stages ORDER BY position ASC, id ASC') as any;
  res.json(rows);
});

router.post('/stages', async (req: Request, res: Response) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) { res.status(400).json({ error: 'Nome da etapa é obrigatório' }); return; }
  const color = String(req.body?.color || '#6366f1').slice(0, 20);
  const [[mx]] = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM whatsapp_stages') as any;
  const [r] = await db.query('INSERT INTO whatsapp_stages (name, color, position) VALUES (?, ?, ?)', [name, color, mx.pos]) as any;
  res.status(201).json({ id: r.insertId, name, color, position: mx.pos });
});

router.put('/stages/:id', async (req: Request, res: Response) => {
  const fields: string[] = []; const params: any[] = [];
  if (req.body?.name !== undefined) { fields.push('name = ?'); params.push(String(req.body.name).trim().slice(0, 60)); }
  if (req.body?.color !== undefined) { fields.push('color = ?'); params.push(String(req.body.color).slice(0, 20)); }
  if (req.body?.position !== undefined) { fields.push('position = ?'); params.push(Number(req.body.position) || 0); }
  if (!fields.length) { res.status(400).json({ error: 'Nada para atualizar' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE whatsapp_stages SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/stages/:id', async (req: Request, res: Response) => {
  // ON DELETE SET NULL em whatsapp_chat_meta.stage_id — contatos dessa etapa
  // voltam a cair na 1ª coluna do quadro, não somem.
  await db.query('DELETE FROM whatsapp_stages WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── GET /api/whatsapp-instance/board — contatos agrupados por etapa ─────────
router.get('/board', async (_req: Request, res: Response) => {
  const [stages] = await db.query('SELECT id, name, color, position FROM whatsapp_stages ORDER BY position ASC, id ASC') as any;
  const [rows] = await db.query(`
    SELECT w.phone, MAX(w.client_id) AS client_id, MAX(cl.name) AS client_name,
           MAX(m.stage_id) AS stage_id, MAX(w.msg_time) AS last_time, MAX(m.push_name) AS push_name,
           MAX(m.unread) AS unread,
           SUBSTRING_INDEX(GROUP_CONCAT(w.body ORDER BY w.msg_time DESC, w.id DESC SEPARATOR '\\n§§'), '\\n§§', 1) AS last_body,
           SUBSTRING_INDEX(GROUP_CONCAT(w.from_me ORDER BY w.msg_time DESC, w.id DESC), ',', 1) AS last_from_me
      FROM whatsapp_messages w
      LEFT JOIN clients cl ON cl.id = w.client_id
      LEFT JOIN whatsapp_chat_meta m ON m.phone = w.phone
     GROUP BY w.phone
     ORDER BY last_time DESC`) as any;
  const primeiraEtapa = stages[0]?.id ?? null;
  const board: Record<string, any[]> = {};
  for (const s of stages) board[s.id] = [];
  for (const r of rows) {
    const sid = r.stage_id ?? primeiraEtapa;
    if (sid == null || !board[sid]) continue;
    board[sid].push({
      phone: r.phone, name: r.client_name || r.push_name || ('+' + r.phone), client_id: r.client_id,
      last_time: r.last_time, last_body: r.last_body, last_from_me: r.last_from_me, unread: r.unread,
    });
  }
  res.json({ stages, board });
});

// ── POST /api/whatsapp-instance/chats/:phone/stage — move no quadro ─────────
// Ao mover pra uma etapa, a etiqueta com o mesmo nome é aplicada ao contato
// automaticamente (pedido explícito — etapa e etiqueta ficam em sincronia).
router.post('/chats/:phone/stage', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const stageId = req.body?.stage_id ? Number(req.body.stage_id) : null;
  let nomeEtapa: string | null = null;
  if (stageId) {
    const [[st]] = await db.query('SELECT name FROM whatsapp_stages WHERE id = ?', [stageId]) as any;
    nomeEtapa = st?.name || null;
  }
  const [[atual]] = await db.query('SELECT labels FROM whatsapp_chat_meta WHERE phone = ?', [phone]) as any;
  let labels: string[] = [];
  try { labels = JSON.parse(atual?.labels || '[]'); } catch { /* mantém vazio */ }
  if (nomeEtapa && !labels.includes(nomeEtapa)) labels.push(nomeEtapa);
  await db.query(
    `INSERT INTO whatsapp_chat_meta (phone, stage_id, labels) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE stage_id = VALUES(stage_id), labels = VALUES(labels)`,
    [phone, stageId, JSON.stringify(labels)]);
  res.json({ success: true, labels });
});

// ── Helpers de IA (leem a conversa) ─────────────────────────────────────────
async function conversaTexto(phone: string, limite = 250): Promise<string> {
  const [msgs] = await db.query(
    `SELECT from_me, body, msg_time FROM whatsapp_messages
      WHERE phone = ? ORDER BY msg_time DESC, id DESC LIMIT ?`, [phone, limite]) as any;
  return msgs.reverse().map((m: any) =>
    `[${new Date(m.msg_time).toLocaleString('pt-BR')}] ${m.from_me ? 'ESCRITÓRIO' : 'CLIENTE'}: ${m.body}`).join('\n');
}

// ── POST /api/whatsapp-instance/chats/:phone/resumo — resumo da conversa (IA)
router.post('/chats/:phone/resumo', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const { garantirMidiaTranscrita } = await import('../services/whatsappTranscricao');
  await garantirMidiaTranscrita(phone);
  const texto = await conversaTexto(phone);
  if (!texto) { res.status(400).json({ error: 'Conversa vazia' }); return; }
  const { aiComplete } = await import('../services/aiAssistant');
  const r = await aiComplete(`Você é assistente de um escritório de advocacia (trabalhista, previdenciário, família e consumidor).
Leia a conversa de WhatsApp abaixo e produza um RESUMO CRONOLÓGICO DOS FATOS relatados pelo cliente, em português claro:
- fatos com datas (demissão, gravidez, descontos, negativas etc.);
- o que o cliente pede/espera;
- documentos que ele JÁ enviou ou mencionou;
- o que ainda FALTA (documentos ou informações);
- próximos passos sugeridos.
Seja fiel à conversa — NÃO invente nada. Formato: texto corrido com marcadores simples, sem markdown pesado.

CONVERSA:
${texto}`, 'groq');
  if (!r.ok) { res.status(400).json({ error: r.message || 'IA não configurada (defina GEMINI_API_KEY ou GROQ_API_KEY)' }); return; }
  res.json({ resumo: r.text });
});

// ── POST /api/whatsapp-instance/chats/:phone/extrair — dados p/ ficha (IA) ──
router.post('/chats/:phone/extrair', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const texto = await conversaTexto(phone);
  if (!texto) { res.status(400).json({ error: 'Conversa vazia' }); return; }
  const { aiComplete } = await import('../services/aiAssistant');
  const r = await aiComplete(`Leia a conversa de WhatsApp abaixo (escritório de advocacia) e devolva APENAS um JSON válido, sem comentários, no formato:
{"nome": "nome completo do cliente ou vazio", "area": "trabalhista|previdenciario|consumidor|familia|gestante|civel|outro", "cidade": "cidade/UF ou vazio", "resumo": "resumo dos fatos em até 400 caracteres", "faltantes": ["documento ou informação que falta", "..."]}
Não invente dados — use vazio quando não houver.

CONVERSA:
${texto}`, 'groq');
  if (!r.ok) { res.status(400).json({ error: r.message || 'IA não configurada' }); return; }
  try {
    const clean = String(r.text || '').replace(/```json|```/g, '').trim();
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    res.json({ nome: j.nome || '', area: j.area || '', cidade: j.cidade || '', resumo: j.resumo || '', faltantes: Array.isArray(j.faltantes) ? j.faltantes : [] });
  } catch { res.status(400).json({ error: 'A IA não devolveu um formato válido — tente de novo' }); }
});

// ── Respostas rápidas (templates de atalho, ex: digitar "/saudacao") ────────
// Guardadas na própria Uazapi (POST /quickreply/edit) — não duplicamos numa
// tabela local, ela já é a fonte da verdade e sincroniza com o app oficial
// do WhatsApp Business quando marcado onWhatsApp.
router.get('/quickreplies', async (_req: Request, res: Response) => {
  res.json(await listarRespostasRapidas());
});
router.post('/quickreplies', async (req: Request, res: Response) => {
  const shortCut = String(req.body?.shortCut || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!shortCut || !text) { res.status(400).json({ error: 'Informe o atalho e o texto' }); return; }
  const r = await salvarRespostaRapida({ shortCut, type: 'text', text });
  if (!r.ok) { res.status(400).json({ error: r.error || 'Não deu pra salvar' }); return; }
  res.status(201).json({ success: true });
});
router.put('/quickreplies/:id', async (req: Request, res: Response) => {
  const shortCut = String(req.body?.shortCut || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!shortCut || !text) { res.status(400).json({ error: 'Informe o atalho e o texto' }); return; }
  const r = await salvarRespostaRapida({ id: req.params.id, shortCut, type: 'text', text });
  if (!r.ok) { res.status(400).json({ error: r.error || 'Não deu pra salvar' }); return; }
  res.json({ success: true });
});
router.delete('/quickreplies/:id', async (req: Request, res: Response) => {
  const ok = await excluirRespostaRapida(req.params.id);
  if (!ok) { res.status(400).json({ error: 'Não deu pra excluir' }); return; }
  res.json({ success: true });
});

export default router;
