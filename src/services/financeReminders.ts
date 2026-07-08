import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';

/**
 * FINANCEIRO automático:
 *  - Régua de cobrança por E-MAIL: 3 dias antes, no vencimento, 3 e 7 dias após
 *    (parcelas pendentes de clientes com e-mail). Nunca repete o mesmo marco.
 *  - Alerta de pagamento PARADO: "Já paguei" (Pix) sem confirmação há 48h+
 *    vira alerta no sino dos admins.
 * Dedup via sent_reminders (ref_key único).
 */

const PORTAL_URL = 'https://crm.advogadaleticiabarros.com.br';
const money = (v: any) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const fmtData = (d: any) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** Marca um ref_key como usado. Retorna false se já existia (não repetir). */
async function claim(refKey: string, channel = 'email'): Promise<boolean> {
  try {
    const [r] = await db.query(
      'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)', [refKey, channel]) as any;
    return r.affectedRows > 0;
  } catch { return false; }
}

// ── Régua de cobrança por e-mail (D-3, D0, D+3, D+7) ────────────────────────
export async function sendBillingReminders(): Promise<number> {
  const [parcelas] = await db.query(`
    SELECT i.id, i.numero, i.valor, i.due_date, DATEDIFF(CURDATE(), i.due_date) AS atraso,
           cl.name, cl.email, p.title AS proposta
      FROM installments i
      JOIN clients cl ON cl.id = i.client_id
      LEFT JOIN propostas p ON p.id = i.proposta_id
     WHERE i.status = 'pendente' AND cl.email IS NOT NULL AND cl.email LIKE '%@%'
       AND DATEDIFF(CURDATE(), i.due_date) IN (-3, 0, 3, 7)`) as any;

  let sent = 0;
  for (const p of parcelas) {
    const atraso = Number(p.atraso); // -3 = faltam 3 dias · 0 = vence hoje · 3/7 = dias vencida
    const marco = atraso === -3 ? 'd3antes' : atraso === 0 ? 'venc' : `d${atraso}pos`;
    if (!(await claim(`cobr_email_${p.id}_${marco}`))) continue;

    const nome = String(p.name || '').split(' ')[0];
    const ref = `${p.numero ? p.numero + 'ª parcela' : 'Parcela'}${p.proposta ? ` — ${p.proposta}` : ''}`;
    const assunto = atraso < 0
      ? `Lembrete: parcela de ${money(p.valor)} vence em ${fmtData(p.due_date)}`
      : atraso === 0
        ? `Sua parcela de ${money(p.valor)} vence hoje`
        : `Parcela de ${money(p.valor)} em aberto desde ${fmtData(p.due_date)}`;
    const corpo = atraso < 0
      ? `<p>Olá, ${nome}! Passando para lembrar com carinho: sua parcela vence em <strong>${fmtData(p.due_date)}</strong>.</p>`
      : atraso === 0
        ? `<p>Olá, ${nome}! Sua parcela vence <strong>hoje</strong>. Para facilitar, o pagamento por Pix leva menos de um minuto no portal.</p>`
        : `<p>Olá, ${nome}. Notamos que a parcela abaixo venceu em <strong>${fmtData(p.due_date)}</strong> e segue em aberto. Se você já pagou, desconsidere este aviso e nos comunique. Se estiver passando por alguma dificuldade, fale com a gente — encontramos juntos uma solução.</p>`;

    const r = await sendEmail({
      to: p.email,
      subject: assunto,
      html: layout(assunto, `
        ${corpo}
        <div style="background:#f4f6fa;border-radius:8px;padding:14px 16px;margin:14px 0;line-height:1.8">
          <div><strong>Referência:</strong> ${ref}</div>
          <div><strong>Valor:</strong> ${money(p.valor)}</div>
          <div><strong>Vencimento:</strong> ${fmtData(p.due_date)}</div>
        </div>
        <p><a href="${PORTAL_URL}" style="display:inline-block;background:#0d1b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Pagar com Pix pelo portal</a></p>
        <p style="color:#93a0b5;font-size:13px">Após pagar, clique em "Já paguei" no portal para agilizar a baixa.</p>`),
    }).catch(() => ({ ok: false }));
    if ((r as any).ok) sent++;
  }
  if (sent) console.log(`💰 Régua de cobrança: ${sent} e-mail(s) enviados.`);
  return sent;
}

// ── Pagamentos "Já paguei" parados há 48h+ sem confirmação ──────────────────
export async function alertStuckPayments(): Promise<number> {
  const [parados] = await db.query(`
    SELECT p.id, p.amount, p.created_at, cl.name AS client_name
      FROM payments p JOIN clients cl ON cl.id = p.client_id
     WHERE p.status = 'em_processamento' AND p.created_at < NOW() - INTERVAL 48 HOUR`) as any;

  let alerts = 0;
  for (const p of parados) {
    if (!(await claim(`pay_stuck_${p.id}`, 'sino'))) continue;
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'pagamento_parado', 'sistema', NOW(), 'pendente')`,
        [a.id, 'Pagamento aguardando confirmação há 2+ dias',
         `${p.client_name} declarou o pagamento de ${money(p.amount)} em ${fmtData(p.created_at)} e ainda não foi confirmado. Confira em Financeiro → Pagamentos a confirmar.`]
      ).catch(() => {});
      alerts++;
    }
  }
  if (alerts) console.log(`⏰ Pagamentos parados: ${alerts} alerta(s) criados.`);
  return alerts;
}
