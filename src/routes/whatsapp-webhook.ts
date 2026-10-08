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
import { normalizeExtraVal } from './leads';

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
// Erro persistente reportado (25/09/2026): rajada de mídias falhou ao baixar e
// o download tinha UMA tentativa só, sem guardar o motivo. Agora: várias
// tentativas com espera (falha da Uazapi costuma ser passageira), fallback
// por fileURL quando não vem base64, e o motivo real volta pro chamador.
const TENTATIVAS_DOWNLOAD = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = [0, 2000, 6000];
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function baixarMidia(messageId: string): Promise<{ buffer?: Buffer; erro?: string }> {
  let erro = 'desconhecido';
  for (let tentativa = 1; tentativa <= TENTATIVAS_DOWNLOAD; tentativa++) {
    if (ESPERA_ENTRE_TENTATIVAS_MS[tentativa - 1]) await dormir(ESPERA_ENTRE_TENTATIVAS_MS[tentativa - 1]);
    try {
      const dl = await uazapi.downloadMessage(messageId);
      let buffer: Buffer | null = null;
      if (dl?.base64Data) buffer = Buffer.from(dl.base64Data, 'base64');
      else if (dl?.fileURL) {
        const r = await fetch(dl.fileURL);
        if (!r.ok) throw new Error(`fileURL respondeu HTTP ${r.status}`);
        buffer = Buffer.from(await r.arrayBuffer());
      } else {
        throw new Error(`resposta sem base64Data nem fileURL: ${JSON.stringify(dl).slice(0, 200)}`);
      }
      if (!buffer.length) throw new Error('arquivo vazio');
      if (buffer.length > MEDIA_MAX) return { erro: `arquivo maior que ${MEDIA_MAX / 1048576} MB` };
      return { buffer };
    } catch (e: any) {
      erro = `${e?.status ? 'HTTP ' + e.status + ' — ' : ''}${e?.message || e}`;
      console.error(`[whatsapp-webhook] download falhou (tentativa ${tentativa}/${TENTATIVAS_DOWNLOAD}, messageId=${messageId}): ${erro}`);
    }
  }
  return { erro };
}

export async function storeMedia(messageId: string, phone: string, clientId: number | null, mediaTypeRaw: string, onErro?: (motivo: string) => void, opts: { registrarDocumento?: boolean } = {}): Promise<{ mediaId: number; label: string } | null> {
  const mediaType = normalizeMediaType(mediaTypeRaw);
  const info = mediaType ? ROTULOS[mediaType] : null;
  if (!info) {
    console.error(`[whatsapp-webhook] tipo de mídia não reconhecido (messageId=${messageId}, messageType="${mediaTypeRaw}", normalizado="${mediaType}")`);
    onErro?.(`tipo de mídia não reconhecido ("${mediaTypeRaw}")`);
    return null;
  }
  try {
    const { buffer, erro } = await baixarMidia(messageId);
    if (!buffer) { onErro?.(erro || 'desconhecido'); return null; }

    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `WhatsApp_${info.rotulo}_${stamp}.${info.ext}`;

    const [r] = await db.query(
      'INSERT INTO whatsapp_media (phone, client_id, file_name, mime, data) VALUES (?, ?, ?, ?, ?)',
      [phone, clientId, fileName.slice(0, 255), info.mime, buffer]) as any;
    const mediaId = r.insertId;

    // Vira Documento do cliente automaticamente (Central de Documentos).
    // Tenta classificar o tipo via IA (best-effort) — falha mantém 'recebido',
    // igual ao comportamento anterior a esta mudança.
    // Mídia enviada POR NÓS (ex.: áudio mandado pelo celular) fica só na conversa —
    // não vira "documento recebido" do cliente.
    if (clientId && opts.registrarDocumento !== false) {
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
    onErro?.(String(e?.message || e));
    return null;
  }
}

/** Refaz o download de UMA mensagem cuja mídia falhou. Devolve ok/erro pra rota e pra varredura. */
export async function reprocessarMensagemMidia(msg: { id: number; message_id: string | null; phone: string; client_id: number | null; body: string; media_id: number | null; from_me?: number }): Promise<{ ok: boolean; erro?: string; mediaId?: number; label?: string }> {
  if (msg.media_id) return { ok: false, erro: 'Esta mensagem já tem a mídia salva' };
  if (!msg.message_id) return { ok: false, erro: 'Mensagem sem identificador da Uazapi — não é possível tentar de novo' };
  const m = String(msg.body || '').match(/\(tipo:\s*([\w]+)\)/i);
  if (!m || !normalizeMediaType(m[1])) return { ok: false, erro: 'Não foi possível identificar o tipo de mídia desta mensagem' };
  let motivo = '';
  const media = await storeMedia(msg.message_id, msg.phone, msg.client_id, m[1], (x) => { motivo = x; }, { registrarDocumento: !msg.from_me });
  if (!media) return { ok: false, erro: motivo || 'falha ao baixar' };
  await db.query('UPDATE whatsapp_messages SET media_id = ?, body = ? WHERE id = ?', [media.mediaId, `📎 ${media.label}`, msg.id]);
  emitWaUpdate(msg.phone);
  return { ok: true, mediaId: media.mediaId, label: media.label };
}

/** Varredura (cron): recupera sozinha as mídias das últimas 48h que falharam. */
export async function reprocessarMidiasFalhadas(): Promise<{ tentadas: number; recuperadas: number }> {
  const [rows] = await db.query(
    `SELECT id, message_id, phone, client_id, body, media_id, from_me FROM whatsapp_messages
      WHERE media_id IS NULL AND message_id IS NOT NULL
        AND body LIKE '%falhou ao baixar%' AND msg_time >= NOW() - INTERVAL 48 HOUR
      ORDER BY msg_time ASC LIMIT 20`) as any;
  let recuperadas = 0;
  for (const r of rows) if ((await reprocessarMensagemMidia(r)).ok) recuperadas++;
  return { tentadas: rows.length, recuperadas };
}

// Lê a 1ª mensagem com IA (Groq, mesmo motor do "extrair" da ficha do
// contato) pra distinguir relato de caso de contato pessoal/engano/spam.
// Best-effort: se a IA falhar ou não reconhecer nada, segue sem resumo —
// nunca bloqueia o aviso no sino.
async function classificarPrimeiraMsg(texto: string): Promise<{ eLead: boolean; soCumprimento: boolean; nome: string; area: string; resumo: string } | null> {
  try {
    const { aiComplete } = await import('../services/aiAssistant');
    const r = await aiComplete(`Uma pessoa mandou esta mensagem pela 1ª vez no WhatsApp de um escritório de advocacia. Devolva APENAS um JSON válido, sem comentários:
{"e_lead": true/false, "so_cumprimento": true/false, "nome": "nome completo se a pessoa se identificou, senão vazio", "area": "trabalhista|previdenciario|consumidor|familia|gestante|civel|outro|vazio", "resumo": "resumo do caso relatado em até 300 caracteres, ou vazio"}
"e_lead" é true SÓ se a mensagem parecer um relato de caso jurídico real (alguém pedindo ajuda com um problema).
"so_cumprimento" é true SÓ se a mensagem for uma saudação sem conteúdo (ex.: "oi", "bom dia", "boa tarde", "olá"), sem relatar caso nem fazer pergunta.
Se não for nem um caso real nem só cumprimento (contato pessoal, colega, engano de número, spam, mensagem vaga demais), os dois campos ficam false.

MENSAGEM:
${texto}`, 'groq');
    if (!r.ok) return null;
    const clean = String(r.text || '').replace(/```json|```/g, '').trim();
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    return { eLead: !!j.e_lead, soCumprimento: !!j.so_cumprimento, nome: j.nome || '', area: j.area || '', resumo: j.resumo || '' };
  } catch { return null; }
}

// Reconhecimento de parceiro/correspondente — determinístico por telefone
// (não usa IA: mais confiável e sem custo de API do que tentar "adivinhar"
// pelo texto). Pedido da Dra. Letícia: diferenciar parceiro de cliente/lead
// sem precisar mover o card no Kanban manualmente pra cada mensagem.
async function findPartnerPhoneMatch(phone: string): Promise<boolean> {
  const tail = phone.replace(/\D/g, '').slice(-8);
  if (tail.length < 8) return false;
  const [rows] = await db.query(
    `SELECT id FROM partners
      WHERE active = 1 AND phone IS NOT NULL
        AND REPLACE(REPLACE(REPLACE(REPLACE(phone,'(',''),')',''),'-',''),' ','') LIKE ?
      LIMIT 1`,
    [`%${tail}`]
  ) as any;
  return rows.length > 0;
}

// Etiqueta "Parceiro" automática — reaproveita o mesmo campo `labels` (JSON)
// que a tela já filtra e exibe (ver POST /chats/:phone/labels em
// whatsapp-instance.ts), em vez de criar uma pasta/mecanismo novo só pra isso.
async function marcarComoParceiro(phone: string): Promise<void> {
  const [[atual]] = await db.query('SELECT labels FROM whatsapp_chat_meta WHERE phone = ?', [phone]) as any;
  let labels: string[] = [];
  try { labels = JSON.parse(atual?.labels || '[]'); } catch { /* mantém vazio */ }
  if (labels.includes('Parceiro')) return;
  labels.push('Parceiro');
  await db.query(
    `INSERT INTO whatsapp_chat_meta (phone, labels) VALUES (?, ?) ON DUPLICATE KEY UPDATE labels = VALUES(labels)`,
    [phone, JSON.stringify(labels.slice(0, 6))]
  );
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
  } else if (classificacao?.soCumprimento) {
    // Só um "bom dia"/"oi" — marca pra sugerir resposta pronta DENTRO da
    // conversa (cartão inline, mesmo padrão do alerta de audiência). Nunca
    // envia sozinho: pedido explícito da Dra. Letícia, ela clica pra mandar.
    await db.query(
      `INSERT INTO whatsapp_chat_meta (phone, unread, greeting_only) VALUES (?, 0, 1)
       ON DUPLICATE KEY UPDATE greeting_only = 1`,
      [phone]
    ).catch(() => {});
    // Caso mais tranquilo de todos — o cartão na própria conversa já resolve,
    // não precisa também gritar no sino (reduz ruído de notificação).
    return;
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

// Detecta quando um lead na etapa "Documentação Pendente" manda os dados
// pedidos pra montar a proposta (a resposta pronta "/documentos" pede nome
// completo, CPF, endereço, e-mail, estado civil e profissão). Só roda pra
// quem está NESSA etapa — não gasta IA em toda mensagem de toda conversa.
// Best-effort: nunca lança, nunca bloqueia o webhook; se a IA não achar pelo
// menos nome E CPF na mensagem, não considera "os dados chegaram" (evita
// disparar em qualquer "oi"/"bom dia" enviado nessa etapa).
async function detectarDadosParaProposta(phone: string, texto: string): Promise<void> {
  try {
    const tail = phone.replace(/\D/g, '').slice(-8);
    if (tail.length < 8) return;
    const [[lead]] = await db.query(
      `SELECT id, name FROM leads
        WHERE status = 'documentacao_pendente'
          AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ?
        ORDER BY id DESC LIMIT 1`,
      [`%${tail}`]
    ) as any;
    if (!lead) return;

    const { aiComplete } = await import('../services/aiAssistant');
    const r = await aiComplete(`Um escritório de advocacia pediu a um cliente, pelo WhatsApp, os dados abaixo para montar uma proposta de honorários: nome completo, CPF, endereço completo, e-mail, estado civil e profissão.

Leia a mensagem abaixo e devolva APENAS um JSON válido, sem comentários, com o que você conseguir identificar (deixe "" quando a mensagem não trouxer aquele dado — não invente nada):
{"nome_completo": "", "cpf": "", "cep": "", "street": "", "number": "", "neighborhood": "", "city": "", "state": "", "email": "", "marital_status": "solteiro|casado|divorciado|viuvo|uniao_estavel|outro ou vazio", "profession": ""}
"state" é a sigla de 2 letras da UF, quando identificável.

MENSAGEM:
${texto}`, 'groq');
    if (!r.ok) return;
    const clean = String(r.text || '').replace(/```json|```/g, '').trim();
    const j = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));

    // Barreira mínima: só considera "os dados chegaram" com nome E CPF —
    // o resto (endereço, e-mail, profissão…) entra se vier, mas sozinho
    // não é sinal confiável o bastante pra avisar a advogada.
    if (!j.nome_completo || !j.cpf) return;

    // Preenche só o que ainda estiver vazio na ficha — nunca sobrescreve
    // algo que a advogada já preencheu manualmente.
    const campos: Record<string, any> = {
      cpf_cnpj: j.cpf, email: j.email, marital_status: j.marital_status, profession: j.profession,
      cep: j.cep, street: j.street, number: j.number, neighborhood: j.neighborhood, city: j.city,
      state: j.state ? normalizeExtraVal('state', j.state) : '',
    };
    const sets: string[] = []; const params: any[] = [];
    for (const [col, val] of Object.entries(campos)) {
      if (!val) continue;
      sets.push(`${col} = COALESCE(NULLIF(${col}, ''), ?)`);
      params.push(val);
    }
    if (sets.length) {
      params.push(lead.id);
      await db.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`, params);
    }

    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'lead_dados_recebidos', 'sistema', NOW(), 'pendente')`,
        [a.id, 'Dados recebidos para a proposta',
         `${j.nome_completo || lead.name} enviou os dados pedidos (CPF, endereço, etc.) — já dá pra montar a proposta.`]
      ).catch(() => {});
    }
  } catch (e: any) {
    console.error('[whatsapp-webhook] falha ao detectar dados de proposta:', e?.message || e);
  }
}

// Alerta os admins quando o download de mídia falha (mesmo padrão de
// `avisarFalhaMigration`, em src/config/migrations.ts) — antes só ficava no
// console.error, e mudanças no contrato da Uazapi já quebraram isso
// silenciosamente por meses (ver comentário de diagnóstico acima). Throttled
// via sent_reminders pra não spammar o sino a cada mensagem se a Uazapi
// ficar instável — no máximo 1 aviso a cada 30 minutos.
async function avisarFalhaMidia(tipo: string, motivo = 'desconhecido'): Promise<void> {
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
       `Uma mídia (tipo: ${tipo}) chegou pelo WhatsApp mas falhou ao baixar após ${TENTATIVAS_DOWNLOAD} tentativas — a conversa registrou um aviso no lugar do arquivo. ` +
       `Motivo: ${String(motivo).slice(0, 300)}. O sistema tenta recuperar sozinho a cada 10 minutos; também dá pra usar "Tentar baixar de novo" na conversa.`]
    ).catch(() => {});
  }
}

// Alerta os admins quando o webhook lança um erro não tratado — mesmo padrão
// throttled de avisarFalhaMidia acima. Antes só ficava no console.error, e o
// próprio Painel de Saúde avisava explicitamente que "erros genéricos do
// webhook ainda não ficam registrados aqui" — agora ficam, com throttle de
// 30min pra não spammar se um problema persistir por várias mensagens seguidas.
async function avisarErroWebhook(erro: string): Promise<void> {
  const janela = Math.floor(Date.now() / (30 * 60 * 1000));
  const [dup] = await db.query(
    'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
    [`wa_webhook_erro_${janela}`, 'sino']) as any;
  if (!dup.affectedRows) return;
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await db.query(
      `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, 'whatsapp_webhook_erro', 'sistema', NOW(), 'pendente')`,
      [a.id, '⚠️ Erro ao processar evento do WhatsApp',
       `O webhook do WhatsApp encontrou um erro: ${String(erro).slice(0, 400)}. Uma mensagem pode não ter sido registrada corretamente — veja os logs do servidor.`]
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
    // Mídia mandada por NÓS pelo celular (fora do CRM) também precisa entrar na
    // conversa — antes só entrava a do cliente (28/09/2026). Se a mensagem já
    // foi gravada pelo próprio envio do CRM (mesmo message_id), não baixa de novo.
    let jaGravadaPeloCrm = false;
    if (msg.fromMe && msgId) {
      const [ja] = await db.query('SELECT id FROM whatsapp_messages WHERE message_id = ?', [msgId]) as any;
      jaGravadaPeloCrm = ja.length > 0;
    }
    const isMedia = !!mediaTypeNorm && !!ROTULOS[mediaTypeNorm] && !jaGravadaPeloCrm;
    if (!msg.fromMe && !isMedia && !msg.text && !msg.content) {
      console.error(`[whatsapp-webhook] mensagem sem texto e sem tipo de mídia reconhecido (messageType="${msg.messageType}") — payload de msg:`, JSON.stringify(msg).slice(0, 1500));
    }
    if (isMedia) {
      let motivo = 'desconhecido';
      const media = await storeMedia(msg.messageid || msg.id, phone, clientId, msg.messageType, (x) => { motivo = x; }, { registrarDocumento: !msg.fromMe });
      if (media) { mediaId = media.mediaId; body = body || `📎 ${media.label}`; }
      else {
        // Antes descartava a mensagem inteira quando não havia legenda —
        // a conversa perdia o registro de que algo chegou. Agora mantém um
        // corpo de aviso, pra pelo menos aparecer na conversa, e alerta os
        // admins (throttled) em vez de só logar no console.
        console.error(`[whatsapp-webhook] mídia tipo "${msg.messageType}" não foi salva (storeMedia devolveu null).`);
        body = body || (msg.fromMe
          ? `⚠️ Mídia enviada por você, mas falhou ao baixar (tipo: ${msg.messageType})`
          : `⚠️ Mídia recebida, mas falhou ao baixar (tipo: ${msg.messageType})`);
        await avisarFalhaMidia(msg.messageType, motivo).catch(() => {});
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
      // Assistente pessoal do CRM (08/10/2026): mensagem da Dra. Letícia/Jessica
      // é um pedido ao CRM (lançar conta, consultar processo/agenda…) e não segue
      // o fluxo de cliente/lead. Foto/PDF de cliente → confere se é comprovante.
      const textoPuro = String(msg.text || (typeof msg.content === 'string' ? msg.content : '') || '');
      const { assistenteNoWebhook } = await import('../services/assistenteWhatsappMysql');
      const doAssistente = await assistenteNoWebhook({ phone, texto: textoPuro, mediaId, clientId }).catch((e) => {
        console.error('[whatsapp-webhook] assistente falhou:', e?.message || e); return false;
      });
      if (doAssistente) return;

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

      // Parceiro reconhecido pelo telefone tem prioridade sobre a triagem de
      // lead — não é um contato novo pra converter, é alguém que já manda
      // caso/audiência pro escritório rotineiramente.
      if (clientId && !respondeuPendencia) await avisarIntimacaoMencionada(phone, clientId, String(body)).catch(() => {});

      const ehParceiro = !clientId && await findPartnerPhoneMatch(phone).catch(() => false);
      if (ehParceiro) {
        await marcarComoParceiro(phone).catch(() => {});
      } else if (!clientId && !respondeuPendencia) {
        await notifyNewWhatsappContact(phone, pushName, String(body).slice(0, 500)).catch(() => {});
        // Não roda pra quem já respondeu uma pendência de botão (não é a
        // mensagem de dados) nem pra quem já é cliente (lead convertido não
        // fica mais em "documentacao_pendente"). Roda em segundo plano —
        // não atrasa a resposta do webhook.
        detectarDadosParaProposta(phone, String(body)).catch(() => {});
      }
    }
  } catch (e: any) {
    // Best-effort: nunca derruba o webhook — mas logar é essencial, senão um
    // erro aqui desaparece sem deixar rastro (foi assim que a mídia ficou
    // quebrada sem ninguém perceber por semanas — ver normalizeMediaType).
    console.error('[whatsapp-webhook] erro não tratado processando evento:', e?.message || e);
    await avisarErroWebhook(e?.message || String(e)).catch(() => {});
  }
});

/**
 * Cliente escreveu que recebeu intimação/citação → tarefa urgente + sino.
 * Uma vez a cada 12h por telefone. Nunca responde sozinho ao cliente.
 */
async function avisarIntimacaoMencionada(phone: string, clientId: number, texto: string): Promise<void> {
  const { mencionaIntimacao, tarefaIntimacao } = await import('../services/whatsappIntimacao');
  if (!mencionaIntimacao(texto)) return;
  const [[recente]] = await db.query(
    'SELECT 1 AS sim FROM whatsapp_chat_meta WHERE phone = ? AND intimacao_alert_at > NOW() - INTERVAL 12 HOUR', [phone]) as any;
  if (recente) return;
  await db.query(
    `INSERT INTO whatsapp_chat_meta (phone, intimacao_alert_at) VALUES (?, NOW())
     ON DUPLICATE KEY UPDATE intimacao_alert_at = NOW()`, [phone]);
  const [[cl]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
  const [[meta]] = await db.query('SELECT case_id FROM whatsapp_chat_meta WHERE phone = ?', [phone]) as any;
  const t = tarefaIntimacao(cl?.name || phone, texto);
  const [admins] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado') AND active = 1 ORDER BY id") as any;
  if (!admins.length) return;
  await db.query(
    `INSERT INTO tasks (user_id, client_id, case_id, title, description, due_date, priority, status)
     VALUES (?, ?, ?, ?, ?, NOW(), 'critica', 'pendente')`,
    [admins[0].id, clientId, meta?.case_id ?? null, t.title, t.description]);
  const { notificationService } = await import('../services/NotificationService');
  for (const a of admins) {
    await notificationService.create({
      userId: a.id, clientId, title: t.title, message: texto.slice(0, 300),
      notificationType: 'whatsapp_intimacao_mencionada', channel: 'som', scheduledAt: new Date(),
    });
  }
}

export default router;
