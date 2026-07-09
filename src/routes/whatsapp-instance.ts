import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { env } from '../config/env';
import { startInstance, disconnectInstance, sendText, getStatus, setAutoSend } from '../services/waInstance';

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
router.get('/status', (_req: Request, res: Response) => {
  res.json(getStatus());
});

// ── POST /api/whatsapp-instance/connect — inicia (gera QR se sem sessão) ────
router.post('/connect', async (_req: Request, res: Response) => {
  await startInstance();
  res.json(getStatus());
});

// ── POST /api/whatsapp-instance/disconnect — encerra e apaga a sessão ───────
router.post('/disconnect', async (_req: Request, res: Response) => {
  await disconnectInstance();
  res.json(getStatus());
});

// ── POST /api/whatsapp-instance/auto — liga/desliga o envio automático ──────
router.post('/auto', (req: Request, res: Response) => {
  setAutoSend(!!req.body?.on);
  res.json(getStatus());
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
router.delete('/templates/:id', async (req: Request, res: Response) => {
  await db.query('DELETE FROM whatsapp_templates WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/media/:id/transcricao — áudio → texto (Whisper)
// Usa o Whisper do Groq (grátis com a GROQ_API_KEY já usada na IA). A transcrição
// fica gravada na própria mensagem — vira prova legível e entra na busca.
router.post('/media/:id/transcricao', async (req: Request, res: Response) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) { res.status(400).json({ error: 'Transcrição requer GROQ_API_KEY configurada' }); return; }
  const [[m]] = await db.query('SELECT id, file_name, mime, data FROM whatsapp_media WHERE id = ?', [req.params.id]) as any;
  if (!m) { res.status(404).json({ error: 'Áudio não encontrado' }); return; }
  if (!String(m.mime).startsWith('audio/') && !String(m.mime).startsWith('video/')) {
    res.status(400).json({ error: 'Este arquivo não é um áudio' }); return;
  }
  try {
    const fd = new FormData();
    fd.append('file', new Blob([m.data], { type: m.mime }), m.file_name || 'audio.ogg');
    fd.append('model', 'whisper-large-v3');
    fd.append('language', 'pt');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd as any,
    });
    const d: any = await r.json();
    if (!r.ok) { res.status(400).json({ error: d?.error?.message || 'Falha na transcrição' }); return; }
    const texto = String(d.text || '').trim();
    if (!texto) { res.status(400).json({ error: 'Não foi possível entender o áudio' }); return; }
    // Grava na mensagem (vira registro permanente e pesquisável)
    await db.query(
      "UPDATE whatsapp_messages SET body = CONCAT(body, '\n📝 Transcrição: ', ?) WHERE media_id = ? AND body NOT LIKE '%📝 Transcrição:%'",
      [texto.slice(0, 3000), m.id]).catch(() => {});
    res.json({ texto });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Falha na transcrição' });
  }
});

// ── GET /api/whatsapp-instance/chats — conversas (última msg + etiquetas + não lidas)
// ?q= busca também DENTRO das mensagens (nome, telefone ou conteúdo/assunto)
router.get('/chats', async (req: Request, res: Response) => {
  const q = String((req.query as any).q || '').trim();
  const like = `%${q}%`;
  const whereQ = q
    ? `WHERE (w.phone LIKE ?
          OR w.client_id IN (SELECT id FROM clients WHERE name LIKE ?)
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
           MAX(m.labels) AS labels
      FROM whatsapp_messages w
      LEFT JOIN clients cl ON cl.id = w.client_id
      LEFT JOIN whatsapp_chat_meta m ON m.phone = w.phone
     ${whereQ}
     GROUP BY w.phone
     ORDER BY last_time DESC LIMIT 100`, q ? [like, like, like] : []) as any;
  res.json(rows);
});

// ── POST /api/whatsapp-instance/chats/:phone/read — zera as não lidas ───────
router.post('/chats/:phone/read', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, unread) VALUES (?, 0) ON DUPLICATE KEY UPDATE unread = 0', [phone]);
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

// ── GET /api/whatsapp-instance/chats/:phone — mensagens da conversa ─────────
router.get('/chats/:phone', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const [rows] = await db.query(
    `SELECT w.id, w.from_me, w.body, w.msg_time, w.media_id, wm.mime AS media_mime
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

  res.json({ client, lead, cases, audiencia, financeiro, ultima_resposta: ultima?.t || null });
});

// ── POST /api/whatsapp-instance/chats/:phone/send — responder pela instância ─
router.post('/chats/:phone/send', async (req: Request, res: Response) => {
  const text = String(req.body?.text || '').trim();
  if (!text) { res.status(400).json({ error: 'Escreva a mensagem' }); return; }
  const ok = await sendText(req.params.phone, text);
  if (!ok) { res.status(400).json({ error: 'Instância desconectada — conecte na aba Conexão' }); return; }
  res.json({ success: true });
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

export default router;
