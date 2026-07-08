import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { startInstance, disconnectInstance, sendText, getStatus, setAutoSend } from '../services/waInstance';

const router = Router();

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

// ── GET /api/whatsapp-instance/chats — conversas (última msg + etiquetas + não lidas)
router.get('/chats', async (_req: Request, res: Response) => {
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
     GROUP BY w.phone
     ORDER BY last_time DESC LIMIT 100`) as any;
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
    `SELECT id, from_me, body, msg_time, media_id FROM whatsapp_messages
      WHERE phone = ? ORDER BY msg_time ASC, id ASC LIMIT 300`, [phone]) as any;
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
