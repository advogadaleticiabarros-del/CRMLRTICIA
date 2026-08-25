import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { uazapi } from '../services/uazapiClient';
import { classificarTipoDocumento } from '../services/whatsappTranscricao';

// Roteador PÚBLICO (sem autenticação) — a Uazapi entrega os eventos aqui.
// Substitui o listener 'messages.upsert' do Baileys (waInstance.ts): como a
// sessão agora mora no servidor da Uazapi, mensagens recebidas só chegam por
// webhook, não por um socket em processo.
const router = Router();

const MEDIA_MAX = 15 * 1024 * 1024; // 15 MB
const ROTULOS: Record<string, { rotulo: string; mime: string; ext: string }> = {
  image: { rotulo: 'Foto', mime: 'image/jpeg', ext: 'jpg' },
  document: { rotulo: 'Documento', mime: 'application/pdf', ext: 'pdf' },
  audio: { rotulo: 'Áudio', mime: 'audio/ogg', ext: 'ogg' },
  ptt: { rotulo: 'Áudio', mime: 'audio/ogg', ext: 'ogg' },
  video: { rotulo: 'Vídeo', mime: 'video/mp4', ext: 'mp4' },
  sticker: { rotulo: 'Figurinha', mime: 'image/webp', ext: 'webp' },
};

async function findClientByPhone(phone: string): Promise<number | null> {
  const tail = phone.replace(/\D/g, '').slice(-8);
  if (tail.length < 8) return null;
  try {
    const [rows] = await db.query(
      "SELECT id FROM clients WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ? LIMIT 1",
      [`%${tail}`]) as any;
    return rows[0]?.id ?? null;
  } catch { return null; }
}

/** Baixa a mídia via /message/download (a Uazapi já decripta), guarda no banco e registra em Documentos. */
async function storeMedia(messageId: string, phone: string, clientId: number | null, mediaType: string): Promise<{ mediaId: number; label: string } | null> {
  const info = ROTULOS[mediaType];
  if (!info) return null;
  try {
    const dl = await uazapi.downloadMessage(messageId);
    if (!dl?.base64) {
      console.error(`[whatsapp-webhook] download sem base64 (messageId=${messageId}, tipo=${mediaType}) — resposta:`, JSON.stringify(dl).slice(0, 500));
      return null;
    }
    const buffer = Buffer.from(dl.base64, 'base64');
    if (!buffer.length || buffer.length > MEDIA_MAX) {
      console.error(`[whatsapp-webhook] buffer inválido (messageId=${messageId}, tipo=${mediaType}) — tamanho: ${buffer.length}`);
      return null;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `WhatsApp_${info.rotulo}_${stamp}.${info.ext}`;

    const [r] = await db.query(
      'INSERT INTO whatsapp_media (phone, client_id, file_name, mime, data) VALUES (?, ?, ?, ?, ?)',
      [phone, clientId, fileName.slice(0, 255), info.mime, buffer]) as any;
    const mediaId = r.insertId;

    // Vira Documento do cliente automaticamente (Central de Documentos).
    // Tenta classificar o tipo via IA (best-effort) — falha mantém 'recebido',
    // igual ao comportamento anterior a esta mudança.
    if (clientId) {
      const [[adm]] = await db.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
      const tipoClassificado = await classificarTipoDocumento({ id: mediaId, file_name: fileName, mime: info.mime, data: buffer }).catch(() => null);
      await db.query(
        `INSERT INTO documents (client_id, name, type, folder, file_url, status, created_by)
         VALUES (?, ?, ?, 'outros', ?, 'ativo', ?)`,
        [clientId, `WhatsApp — ${fileName}`.slice(0, 255), tipoClassificado || 'recebido', `/api/whatsapp-instance/media/${mediaId}`, adm?.id ?? 1]).catch(() => {});
    }
    return { mediaId, label: `${info.rotulo}: ${fileName}` };
  } catch (e: any) {
    console.error(`[whatsapp-webhook] falha ao baixar mídia (messageId=${messageId}, tipo=${mediaType}):`, e?.message || e);
    return null;
  }
}

// Lê a 1ª mensagem com IA (Groq, mesmo motor do "extrair" da ficha do
// contato) pra distinguir relato de caso de contato pessoal/engano/spam.
// Best-effort: se a IA falhar ou não reconhecer nada, segue sem resumo —
// nunca bloqueia o aviso no sino.
async function classificarPrimeiraMsg(texto: string): Promise<{ eLead: boolean; nome: string; area: string; resumo: string } | null> {
  try {
    const { aiComplete } = await import('../services/aiAssistant');
    const r = await aiComplete(`Uma pessoa mandou esta mensagem pela 1ª vez no WhatsApp de um escritório de advocacia. Devolva APENAS um JSON válido, sem comentários:
{"e_lead": true/false, "nome": "nome completo se a pessoa se identificou, senão vazio", "area": "trabalhista|previdenciario|consumidor|familia|gestante|civel|outro|vazio", "resumo": "resumo do caso relatado em até 300 caracteres, ou vazio"}
"e_lead" é true SÓ se a mensagem parecer um relato de caso jurídico real (alguém pedindo ajuda com um problema). É false se for contato pessoal, colega, engano de número, spam, cumprimento sem contexto, ou mensagem vaga demais pra saber.

MENSAGEM:
${texto}`, 'groq');
    if (!r.ok) return null;
    const clean = String(r.text || '').replace(/```json|```/g, '').trim();
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    return { eLead: !!j.e_lead, nome: j.nome || '', area: j.area || '', resumo: j.resumo || '' };
  } catch { return null; }
}

// Avisa no sino na 1ª mensagem de um número desconhecido — NÃO cria lead
// automaticamente (contato pessoal, colega, engano etc. viravam lead e
// enchiam o funil). Virar lead é uma ação manual: "Ficha do contato →
// + Cadastrar como lead" na tela de WhatsApp. Quando a IA reconhece a
// mensagem como um relato de caso, o resumo fica salvo em
// whatsapp_chat_meta pra já vir pronto quando ela converter.
// Idempotente via sent_reminders (mesmo padrão do alertSilentChats): sem
// isso, toda mensagem seguinte do mesmo número dispararia um aviso novo.
async function notifyNewWhatsappContact(phone: string, pushName: string | null, primeiraMsg: string): Promise<void> {
  const digits = phone.replace(/\D/g, '');
  const [dup] = await db.query(
    'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
    [`wa_novo_contato_${digits}`, 'sino']
  ) as any;
  if (!dup.affectedRows) return;

  const nome = (pushName && pushName.trim()) || `+${digits}`;
  const classificacao = await classificarPrimeiraMsg(primeiraMsg);
  const pareceLead = classificacao?.eLead && classificacao.resumo;

  if (pareceLead) {
    await db.query(
      `INSERT INTO whatsapp_chat_meta (phone, unread, lead_summary, lead_area, lead_nome) VALUES (?, 0, ?, ?, ?)
       ON DUPLICATE KEY UPDATE lead_summary = VALUES(lead_summary), lead_area = VALUES(lead_area), lead_nome = VALUES(lead_nome)`,
      [phone, classificacao!.resumo, classificacao!.area || null, classificacao!.nome || null]
    ).catch(() => {});
  }

  const corpo = pareceLead
    ? `${classificacao!.nome || nome} relatou um caso pelo WhatsApp: "${classificacao!.resumo}". Abra a conversa e clique em "Cadastrar como lead" se quiser seguir.`
    : `${nome} mandou mensagem pela 1ª vez: "${primeiraMsg.slice(0, 160)}". Abra a conversa e clique em "Cadastrar como lead" se for um caso.`;

  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await db.query(
      `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, 'contato_whatsapp_novo', 'sistema', NOW(), 'pendente')`,
      [a.id, pareceLead ? 'Possível lead novo no WhatsApp' : 'Novo contato no WhatsApp', corpo]
    ).catch(() => {});
  }
}

// ── POST /api/public/uazapi-webhook — eventos da Uazapi (mensagens) ─────────
router.post('/uazapi-webhook', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true }); // confirma recebimento logo — o resto é best-effort
  try {
    const payload = req.body || {};
    // Confere que o evento é da NOSSA instância (o token vem no corpo do webhook).
    if (String(payload.token || '') !== (process.env.UAZAPI_TOKEN || '')) return;
    if (payload.EventType !== 'messages') return;

    const msg = payload.message || {};
    const chat = payload.chat || {};
    if (!msg.messageid && !msg.id) return;
    if (msg.isGroup || chat.wa_isGroup) return; // ignora grupos

    const phone = String(chat.phone || msg.sender || msg.chatid || '').replace(/\D/g, '');
    if (!phone) return;
    const clientId = await findClientByPhone(phone);
    const msgId = msg.messageid || msg.id || null;
    const statusBruto = msg.status ? String(msg.status) : null;

    let mediaId: number | null = null;
    let body = msg.text || (typeof msg.content === 'string' ? msg.content : '') || '';
    // DIAGNÓSTICO (17/08): nenhuma mídia recebida jamais foi salva no CRM —
    // pode ser falha no download OU o nome do campo de tipo de mídia ter
    // mudado do lado da Uazapi (já aconteceu antes com "id"/"messageId").
    // Loga as chaves da mensagem quando não há mediaType, pra comparar.
    if (!msg.fromMe && !msg.mediaType && !msg.text && !msg.content) {
      console.error('[whatsapp-webhook] mensagem sem texto/mediaType — payload de msg:', JSON.stringify(msg).slice(0, 1500));
    }
    if (!msg.fromMe && msg.mediaType) {
      const media = await storeMedia(msg.messageid || msg.id, phone, clientId, msg.mediaType);
      if (media) { mediaId = media.mediaId; body = body || `📎 ${media.label}`; }
      else console.error(`[whatsapp-webhook] mídia tipo "${msg.mediaType}" não foi salva (storeMedia devolveu null) — mensagem descartada se não houver legenda.`);
    }
    if (!body) {
      // Evento de só-status (confirmação de entrega/leitura) de uma mensagem
      // que já existe — sem conteúdo novo pra inserir, só atualiza o ✓✓.
      if (statusBruto && msgId) {
        await db.query('UPDATE whatsapp_messages SET status = ? WHERE message_id = ?', [statusBruto, msgId]).catch(() => {});
      }
      return;
    }

    // A Uazapi manda messageTimestamp em milissegundos — FROM_UNIXTIME espera
    // segundos e devolve NULL se o valor estourar o intervalo válido.
    const tsRaw = Number(msg.messageTimestamp) || Date.now();
    const tsSeconds = Math.floor((tsRaw > 1e12 ? tsRaw : tsRaw * 1000) / 1000);
    // ON DUPLICATE (em vez de IGNORE): se essa mensagem já foi gravada por
    // sendText/sendMedia (envio nosso, message_id já conhecido), o "eco" do
    // webhook não duplica — só atualiza o status (✓ → ✓✓ → ✓✓ azul).
    const [r] = await db.query(
      `INSERT INTO whatsapp_messages (message_id, phone, client_id, from_me, body, msg_time, media_id, status)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [msgId, phone, clientId, msg.fromMe ? 1 : 0, String(body).slice(0, 4000),
       tsSeconds, mediaId, statusBruto]) as any;

    // affectedRows: 1 = inserção nova; 2 = atualizou uma existente (ON DUPLICATE);
    // 0 = update sem mudança nenhuma. Só trata como mensagem NOVA no caso 1.
    if (r.affectedRows === 1 && !msg.fromMe) {
      const pushName = (msg.senderName || chat.wa_name || null) as string | null;
      await db.query(
        `INSERT INTO whatsapp_chat_meta (phone, unread, push_name) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE unread = unread + 1, push_name = COALESCE(VALUES(push_name), push_name)`,
        [phone, pushName ? pushName.trim().slice(0, 255) : null]).catch(() => {});

      if (!clientId) {
        await notifyNewWhatsappContact(phone, pushName, String(body).slice(0, 500)).catch(() => {});
      }
    }
  } catch { /* inbox é best-effort — nunca derruba o webhook */ }
});

export default router;
