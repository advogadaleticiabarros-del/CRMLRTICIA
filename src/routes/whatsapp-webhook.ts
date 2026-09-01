import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { uazapi } from '../services/uazapiClient';
import { classificarTipoDocumento, garantirMidiaTranscrita } from '../services/whatsappTranscricao';
import { compararSeguro } from '../utils/crypto';
import { emitWaUpdate } from '../services/waSocket';
import { sendText } from '../services/uazapiInstance';
import {
  msgNewsletterConfirmado, msgNewsletterRecusado, msgPropostaMaisTempoConfirmado,
  msgPropostaMaisTempoJaUsada, concederExtensaoPrazo, dispararRecusaProposta,
} from '../services/propostaFollowupService';
import { logActivity } from '../services/JourneyService';
import {
  findOpenPendingReply, interpretarResposta, resolvePendingReply, PendingReply,
} from '../services/pendingWhatsappReplyService';

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

// O campo do payload já mudou de nome uma vez sem aviso (era "mediaType",
// a Uazapi manda "messageType" — ver uazapi-openapi-spec.yaml, schema
// Message). Pra não quebrar de novo do mesmo jeito silencioso, normaliza
// o valor (minúsculo, sem sufixo "message") antes de bater com ROTULOS —
// assim "image", "Image", "imageMessage" etc. resolvem igual.
export function normalizeMediaType(raw: string | undefined | null): string | null {
  const s = String(raw || '').trim().toLowerCase().replace(/message$/, '');
  return s || null;
}

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
async function storeMedia(messageId: string, phone: string, clientId: number | null, mediaTypeRaw: string): Promise<{ mediaId: number; label: string } | null> {
  const mediaType = normalizeMediaType(mediaTypeRaw);
  const info = mediaType ? ROTULOS[mediaType] : null;
  if (!info) {
    console.error(`[whatsapp-webhook] tipo de mídia não reconhecido (messageId=${messageId}, messageType="${mediaTypeRaw}", normalizado="${mediaType}")`);
    return null;
  }
  try {
    const dl = await uazapi.downloadMessage(messageId);
    if (!dl?.base64Data) {
      console.error(`[whatsapp-webhook] download sem base64Data (messageId=${messageId}, tipo=${mediaType}) — resposta:`, JSON.stringify(dl).slice(0, 500));
      return null;
    }
    const buffer = Buffer.from(dl.base64Data, 'base64');
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

// Alerta os admins quando o download de mídia falha (mesmo padrão de
// `avisarFalhaMigration`, em src/config/migrations.ts) — antes só ficava no
// console.error, e mudanças no contrato da Uazapi já quebraram isso
// silenciosamente por meses (ver comentário de diagnóstico acima). Throttled
// via sent_reminders pra não spammar o sino a cada mensagem se a Uazapi
// ficar instável — no máximo 1 aviso a cada 30 minutos.
async function avisarFalhaMidia(tipo: string): Promise<void> {
  const janela = Math.floor(Date.now() / (30 * 60 * 1000)); // muda a cada 30min
  const [dup] = await db.query(
    'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
    [`wa_midia_falhou_${janela}`, 'sino']) as any;
  if (!dup.affectedRows) return;
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await db.query(
      `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, 'whatsapp_midia_falhou', 'sistema', NOW(), 'pendente')`,
      [a.id, '⚠️ Mídia do WhatsApp não baixou',
       `Uma mídia (tipo: ${tipo}) chegou pelo WhatsApp mas falhou ao baixar — a conversa registrou um aviso no lugar do arquivo. ` +
       'Se continuar acontecendo, pode ser mudança na integração com a Uazapi; veja os logs do servidor.']
    ).catch(() => {});
  }
}

// Resolve a resposta ao "newsletter_opt_in" disparado na recusa de proposta
// (ver src/routes/propostas.ts, PATCH /:id/status): move o lead para
// status='newsletter', ou — quando a proposta só tem client_id (cliente já
// convertido, sem registro de lead) — marca newsletter_opt_in em clients,
// já que leads.status='newsletter' é conceito de LEAD, não de cliente.
async function processarRespostaNewsletter(pending: PendingReply, resposta: 'sim' | 'nao'): Promise<void> {
  if (resposta === 'sim') {
    if (pending.lead_id) {
      await db.query("UPDATE leads SET status = 'newsletter' WHERE id = ?", [pending.lead_id]).catch(() => {});
    } else if (pending.client_id) {
      await db.query(
        'UPDATE clients SET newsletter_opt_in = 1, newsletter_opt_in_at = NOW() WHERE id = ?',
        [pending.client_id]
      ).catch(() => {});
    }
    await logActivity({
      leadId: pending.lead_id, clientId: pending.client_id, caseId: null,
      actorId: null, actorName: 'Sistema (WhatsApp)',
      eventType: 'newsletter_optin', title: 'Cliente aceitou receber os informativos',
      description: `Confirmado por WhatsApp após recusa da proposta #${pending.proposta_id ?? '-'}`,
    });
    await sendText(pending.phone, msgNewsletterConfirmado(''), 'Automático — confirmação newsletter').catch(() => {});
  } else {
    // Não cadastra nada — só audita, pra saber que a pessoa não teve
    // interesse e não repetir a pergunta (ver findOpenPendingReply/janela de 7 dias).
    await logActivity({
      leadId: pending.lead_id, clientId: pending.client_id, caseId: null,
      actorId: null, actorName: 'Sistema (WhatsApp)',
      eventType: 'newsletter_recusado', title: 'Cliente não quis receber os informativos',
      description: `Respondido por WhatsApp após recusa da proposta #${pending.proposta_id ?? '-'}`,
    });
    await sendText(pending.phone, msgNewsletterRecusado(), 'Automático — recusa newsletter').catch(() => {});
  }
}

// Resolve a resposta ao "proposta_expirada" disparado pelo cron de 7 dias
// (ver runPropostaFollowups/dispararPropostaExpirada em
// propostaFollowupService.ts). Dois caminhos:
//  - "sim" (botão "Preciso de mais tempo"): concede a extensão única via
//    concederExtensaoPrazo (UPDATE atômico, guarda contra conceder 2x).
//    Se já tinha sido usada antes (defensivo — não deveria acontecer no
//    fluxo normal), NÃO estende de novo nem trata como recusa (a pessoa
//    não disse não): só confirma educadamente.
//  - "nao" (botão "Recusar"): mesmo caminho da recusa manual —
//    status='recusada' + dispararRecusaProposta (mensagem calorosa +
//    pergunta de newsletter), reaproveitando a função compartilhada.
async function processarRespostaPropostaExpirada(pending: PendingReply, resposta: 'sim' | 'nao'): Promise<void> {
  if (!pending.proposta_id) return; // defensivo — pendência sem proposta associada não deveria existir
  const [[prop]] = await db.query(
    'SELECT id, contact_name FROM propostas WHERE id = ?', [pending.proposta_id]
  ) as any;
  if (!prop) return;

  if (resposta === 'sim') {
    const concedeu = await concederExtensaoPrazo(pending.proposta_id);
    await logActivity({
      leadId: pending.lead_id, clientId: pending.client_id, caseId: null,
      actorId: null, actorName: 'Sistema (WhatsApp)',
      eventType: concedeu ? 'proposta_prazo_estendido' : 'proposta_extensao_negada',
      title: concedeu ? 'Prazo da proposta estendido (única vez)' : 'Pedido de mais tempo negado (extensão já usada)',
      description: `Proposta #${pending.proposta_id} pediu mais tempo pelo WhatsApp`,
    });
    const msg = concedeu
      ? msgPropostaMaisTempoConfirmado(prop.contact_name || '')
      : msgPropostaMaisTempoJaUsada(prop.contact_name || '');
    await sendText(pending.phone, msg, 'Automático — resposta pedido de mais tempo').catch(() => {});
  } else {
    await db.query("UPDATE propostas SET status = 'recusada' WHERE id = ?", [pending.proposta_id]);
    await logActivity({
      leadId: pending.lead_id, clientId: pending.client_id, caseId: null,
      actorId: null, actorName: 'Sistema (WhatsApp)',
      eventType: 'proposal_status', title: 'Status da proposta atualizado',
      oldValue: 'Expirada', newValue: 'Recusada',
      description: `Proposta #${pending.proposta_id} recusada pelo WhatsApp (botão da proposta expirada)`,
    });
    await dispararRecusaProposta({
      propostaId: pending.proposta_id, leadId: pending.lead_id, clientId: pending.client_id,
      phone: pending.phone, contactName: prop.contact_name || '',
    });
  }
}

// Confere se há uma pergunta de botão em aberto (ex.: newsletter na recusa
// de proposta) esperando resposta daquele telefone. Retorna true quando
// EXISTE uma pendência (mesmo que o texto não tenha sido reconhecido como
// sim/não) — nesse caso o chamador deve tratar a mensagem como resposta a
// essa pergunta, não como um contato novo qualquer.
async function tratarPendenciaWhatsapp(phone: string, texto: string): Promise<boolean> {
  try {
    const pending = await findOpenPendingReply(phone);
    if (!pending) return false;
    const resposta = interpretarResposta(texto, pending);
    if (!resposta) return true; // não reconhecido — mantém pendente pra próxima mensagem
    await resolvePendingReply(pending.id, resposta);
    if (pending.tipo === 'newsletter_opt_in') await processarRespostaNewsletter(pending, resposta);
    else if (pending.tipo === 'proposta_expirada') await processarRespostaPropostaExpirada(pending, resposta);
    return true;
  } catch (e: any) {
    console.error('[whatsapp-webhook] falha ao tratar pendência de confirmação:', e?.message || e);
    return false;
  }
}

// Evento de presença (digitando…) — best-effort: a Uazapi pode nunca mandar
// esse evento (não confirmado na documentação pública), mas se mandar, o
// front mostra "digitando…" na conversa aberta. Não bloqueia nada se nunca
// chegar.
function handlePresence(payload: any): void {
  const phone = String(payload?.chat?.phone || payload?.phone || '').replace(/\D/g, '');
  if (!phone) return;
  const estado = String(payload?.presence || payload?.state || '').toLowerCase();
  emitWaUpdate(phone, { presence: estado.includes('compos') || estado.includes('typing') ? 'digitando' : 'parou' });
}

// ── POST /api/public/uazapi-webhook — eventos da Uazapi (mensagens) ─────────
router.post('/uazapi-webhook', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true }); // confirma recebimento logo — o resto é best-effort
  try {
    const payload = req.body || {};
    // Confere que o evento é da NOSSA instância (o token vem no corpo do webhook).
    // Comparação em tempo constante — este endpoint é público, sem isso um
    // `!==` normal vaza por timing quantos caracteres do token bateram.
    if (!compararSeguro(String(payload.token || ''), process.env.UAZAPI_TOKEN || '')) return;
    if (payload.EventType === 'presence') { handlePresence(payload); return; }
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
    // O campo certo é "messageType" (não "mediaType" — ver normalizeMediaType
    // acima). Ele vem preenchido em TODA mensagem, inclusive texto puro
    // ("conversation") — por isso só entra no fluxo de mídia quando o valor
    // normalizado bate com um tipo conhecido em ROTULOS, não só "existe".
    const mediaTypeNorm = normalizeMediaType(msg.messageType);
    const isMedia = !msg.fromMe && !!mediaTypeNorm && !!ROTULOS[mediaTypeNorm];
    if (!msg.fromMe && !isMedia && !msg.text && !msg.content) {
      console.error(`[whatsapp-webhook] mensagem sem texto e sem tipo de mídia reconhecido (messageType="${msg.messageType}") — payload de msg:`, JSON.stringify(msg).slice(0, 1500));
    }
    if (isMedia) {
      const media = await storeMedia(msg.messageid || msg.id, phone, clientId, msg.messageType);
      if (media) { mediaId = media.mediaId; body = body || `📎 ${media.label}`; }
      else {
        // Antes descartava a mensagem inteira quando não havia legenda —
        // a conversa perdia o registro de que algo chegou. Agora mantém um
        // corpo de aviso, pra pelo menos aparecer na conversa, e alerta os
        // admins (throttled) em vez de só logar no console.
        console.error(`[whatsapp-webhook] mídia tipo "${msg.messageType}" não foi salva (storeMedia devolveu null).`);
        body = body || `⚠️ Mídia recebida, mas falhou ao baixar (tipo: ${msg.messageType})`;
        await avisarFalhaMidia(msg.messageType).catch(() => {});
      }
    }
    if (!body) {
      // Evento de só-status (confirmação de entrega/leitura) de uma mensagem
      // que já existe — sem conteúdo novo pra inserir, só atualiza o ✓✓.
      if (statusBruto && msgId) {
        await db.query('UPDATE whatsapp_messages SET status = ? WHERE message_id = ?', [statusBruto, msgId]).catch(() => {});
        emitWaUpdate(phone);
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
    if (r.affectedRows > 0) emitWaUpdate(phone);

    // Transcreve áudio / descreve imagem já na chegada, sem esperar alguém
    // pedir o "resumo" da conversa — reaproveita garantirMidiaTranscrita
    // (mesma função usada lá) para não duplicar a lógica. Webhook já
    // respondeu 200 no topo, então isso roda em segundo plano; emite um
    // 2º update pro chat quando terminar, pra transcrição aparecer sem
    // precisar recarregar a tela.
    if (r.affectedRows === 1 && mediaId) {
      garantirMidiaTranscrita(phone).then(() => emitWaUpdate(phone)).catch((e) =>
        console.error('[whatsapp-webhook] falha ao transcrever mídia recebida:', e?.message || e));
    }

    // affectedRows: 1 = inserção nova; 2 = atualizou uma existente (ON DUPLICATE);
    // 0 = update sem mudança nenhuma. Só trata como mensagem NOVA no caso 1.
    if (r.affectedRows === 1 && !msg.fromMe) {
      // Resposta a uma pergunta de botão em aberto (ex.: newsletter na recusa
      // de proposta) tem prioridade: se houver pendência para este telefone,
      // essa mensagem É a resposta — não é um contato novo qualquer, então
      // não deve cair no fluxo de "possível lead" abaixo.
      const respondeuPendencia = await tratarPendenciaWhatsapp(phone, String(body)).catch(() => false);

      const pushName = (msg.senderName || chat.wa_name || null) as string | null;
      await db.query(
        `INSERT INTO whatsapp_chat_meta (phone, unread, push_name) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE unread = unread + 1, push_name = COALESCE(VALUES(push_name), push_name)`,
        [phone, pushName ? pushName.trim().slice(0, 255) : null]).catch(() => {});

      if (!clientId && !respondeuPendencia) {
        await notifyNewWhatsappContact(phone, pushName, String(body).slice(0, 500)).catch(() => {});
      }
    }
  } catch (e: any) {
    // Best-effort: nunca derruba o webhook — mas logar é essencial, senão um
    // erro aqui desaparece sem deixar rastro (foi assim que a mídia ficou
    // quebrada sem ninguém perceber por semanas — ver normalizeMediaType).
    console.error('[whatsapp-webhook] erro não tratado processando evento:', e?.message || e);
  }
});

export default router;
