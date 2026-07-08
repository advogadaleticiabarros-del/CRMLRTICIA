import { db } from '../config/database';

/**
 * Fila de WhatsApp — o sistema PREPARA as mensagens (cobrança, audiência,
 * protocolo); o envio é manual em 1 clique (wa.me) pela tela "WhatsApp".
 * Zero custo e zero risco de banimento: usa o WhatsApp normal do escritório.
 */

const fmtValor = (v: any) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const fmtData = (d: any) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fmtDataHora = (d: any) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Normaliza para o formato do wa.me: só dígitos, com DDI 55. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;   // DDD + número
  if (!d.startsWith('55') && (d.length === 12 || d.length === 13)) return d; // outro DDI
  return d.length >= 12 ? d : null;
}

/** Enfileira (idempotente por ref_key — não duplica a mesma mensagem). */
export async function enqueueWhatsapp(item: {
  clientId?: number | null; name: string; phone: string; message: string;
  context?: string; refKey?: string | null;
}): Promise<boolean> {
  const phone = normalizePhone(item.phone);
  if (!phone) return false;
  try {
    const [r] = await db.query(
      `INSERT IGNORE INTO whatsapp_queue (client_id, recipient_name, phone, message, context, ref_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [item.clientId ?? null, item.name, phone, item.message, item.context || 'avulsa', item.refKey || null]
    ) as any;
    return r.affectedRows > 0;
  } catch { return false; }
}

/** Geração diária: cobranças (D-3, vencimento, D+3) e audiências (D-7, D-3). */
export async function generateWhatsappQueue(): Promise<number> {
  let created = 0;

  // ── Cobranças: parcelas pendentes a 3 dias, no dia, e 3 dias vencidas ─────
  const [parcelas] = await db.query(`
    SELECT i.id, i.valor, i.due_date, DATEDIFF(i.due_date, CURDATE()) AS dias,
           cl.id AS client_id, cl.name, cl.phone
      FROM installments i
      JOIN clients cl ON cl.id = i.client_id
     WHERE i.status = 'pendente' AND cl.phone IS NOT NULL AND cl.phone <> ''
       AND DATEDIFF(i.due_date, CURDATE()) IN (3, 0, -3)`) as any;

  for (const p of parcelas) {
    const primeiroNome = String(p.name || '').split(' ')[0];
    const marco = Number(p.dias) === 3 ? 'd3' : Number(p.dias) === 0 ? 'venc' : 'd3pos';
    const texto = Number(p.dias) === 3
      ? `Olá, ${primeiroNome}! Tudo bem? Passando para lembrar que sua parcela de ${fmtValor(p.valor)} vence em ${fmtData(p.due_date)}. Você pode pagar com Pix pelo portal: https://crm.advogadaleticiabarros.com.br — qualquer dúvida, estou à disposição. 🙏`
      : Number(p.dias) === 0
        ? `Olá, ${primeiroNome}! Sua parcela de ${fmtValor(p.valor)} vence hoje (${fmtData(p.due_date)}). Para facilitar, o pagamento por Pix está no portal: https://crm.advogadaleticiabarros.com.br — obrigada!`
        : `Olá, ${primeiroNome}! Notamos que a parcela de ${fmtValor(p.valor)} venceu em ${fmtData(p.due_date)} e segue em aberto. Se já pagou, desconsidere e nos avise. Se preferir, o Pix está no portal: https://crm.advogadaleticiabarros.com.br — podemos conversar sobre qualquer dificuldade. 🙏`;
    if (await enqueueWhatsapp({
      clientId: p.client_id, name: p.name, phone: p.phone, message: texto,
      context: 'cobranca', refKey: `cobr_${p.id}_${marco}`,
    })) created++;
  }

  // ── Audiências: 7 e 3 dias antes (cliente com telefone) ───────────────────
  const [audiencias] = await db.query(`
    SELECT ce.id, ce.start_datetime, ce.location, ce.video_link,
           DATEDIFF(DATE(ce.start_datetime), CURDATE()) AS dias,
           cl.id AS client_id, cl.name, cl.phone
      FROM calendar_events ce
      LEFT JOIN cases c ON c.id = ce.case_id
      JOIN clients cl ON cl.id = COALESCE(ce.client_id, c.client_id)
     WHERE ce.event_type = 'audiencia' AND cl.phone IS NOT NULL AND cl.phone <> ''
       AND DATE(ce.start_datetime) IN (DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_ADD(CURDATE(), INTERVAL 3 DAY))`) as any;

  for (const a of audiencias) {
    const primeiroNome = String(a.name || '').split(' ')[0];
    const online = !!(a.video_link && String(a.video_link).trim());
    const orient = online
      ? `A audiência é ONLINE — entre pelo link ${a.video_link} uns 15 minutos antes, teste câmera e microfone, e tenha RG ou CNH em mãos.`
      : `A audiência é PRESENCIAL${a.location ? ` — local: ${a.location}` : ''}. Chegue 30 minutos antes com documento com foto (RG ou CNH).`;
    const texto = `Olá, ${primeiroNome}! Lembrete importante: sua audiência será em ${fmtDataHora(a.start_datetime)} (faltam ${a.dias} dias). ${orient} Qualquer dúvida, me chame por aqui. — Advocacia Letícia Barros`;
    if (await enqueueWhatsapp({
      clientId: a.client_id, name: a.name, phone: a.phone, message: texto,
      context: 'audiencia', refKey: `aud_${a.id}_${a.dias}d`,
    })) created++;
  }

  if (created) console.log(`💬 Fila de WhatsApp: ${created} mensagem(ns) preparadas.`);
  return created;
}

/**
 * Alerta "cliente sem resposta": a ÚLTIMA mensagem da conversa é nossa e o
 * contato está em silêncio há 7+ dias → sino para os admins (1x por mensagem).
 */
export async function alertSilentChats(): Promise<number> {
  const [chats] = await db.query(`
    SELECT w.phone, w.id AS last_id, w.msg_time, cl.name AS client_name
      FROM whatsapp_messages w
      JOIN (SELECT phone, MAX(CONCAT(msg_time, LPAD(id, 12, '0'))) AS mx FROM whatsapp_messages GROUP BY phone) u
        ON u.phone = w.phone AND CONCAT(w.msg_time, LPAD(w.id, 12, '0')) = u.mx
      LEFT JOIN clients cl ON cl.id = w.client_id
     WHERE w.from_me = 1 AND w.msg_time < NOW() - INTERVAL 7 DAY`) as any;

  let alerts = 0;
  for (const c of chats) {
    const [dup] = await db.query(
      'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
      [`wa_noresp_${c.phone}_${c.last_id}`, 'sino']) as any;
    if (!dup.affectedRows) continue;
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'wa_sem_resposta', 'sistema', NOW(), 'pendente')`,
        [a.id, 'Cliente sem resposta há 7 dias',
         `${c.client_name || '+' + c.phone} não responde no WhatsApp desde ${new Date(c.msg_time).toLocaleDateString('pt-BR')}. Vale um novo contato?`]).catch(() => {});
      alerts++;
    }
  }
  if (alerts) console.log(`🔕 Conversas sem resposta: ${alerts} alerta(s).`);
  return alerts;
}
