import nodemailer, { Transporter } from 'nodemailer';

/**
 * Envio de e-mail via SMTP (Gmail, Hostinger, Resend SMTP, etc.).
 * Configurável por env. Se não estiver configurado, send() não falha —
 * apenas retorna { ok:false, skipped:true } e o fluxo segue normalmente.
 *
 * Env:
 *   SMTP_HOST, SMTP_PORT (587/465), SMTP_SECURE (true p/ 465),
 *   SMTP_USER, SMTP_PASS, EMAIL_FROM ("Advocacia Letícia Barros <...>")
 */
export interface SendResult { ok: boolean; skipped?: boolean; error?: string; messageId?: string; }

interface Attachment { filename: string; content: Buffer; contentType?: string; }
interface MailInput { to: string; subject: string; html: string; text?: string; attachments?: Attachment[]; }

const FROM = process.env.EMAIL_FROM || 'Advocacia Letícia Barros <no-reply@advogadaleticiabarros.com.br>';
// Mesma identidade do papel timbrado (public/app.js printDocs/docTableHtml) e
// do Relatório Executivo: navy + dourado, serif no nome, logo do escritório.
const NAVY = '#1f3047';
const GOLD = '#c19a4e';
const LOGO_URL = (process.env.APP_URL || 'https://crm.advogadaleticiabarros.com.br') + '/logo.png';

let cached: Transporter | null = null;
function transporter(): Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: (process.env.SMTP_PASS || '').replace(/\s+/g, '') },
      // Falha rápido se a porta SMTP estiver bloqueada (não trava a requisição).
      connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 12000,
    });
  }
  return cached;
}

/**
 * Envolve o conteúdo no mesmo design system do papel timbrado — navy +
 * dourado, logo do escritório, serif no nome. Usada por TODOS os e-mails
 * automáticos (senha, recibo, proposta, resumo matinal, relatório executivo)
 * pra manter a identidade visual consistente em qualquer canal.
 */
export function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Georgia,'Times New Roman',serif;background:#faf8f4;padding:24px 12px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2ddd1">
    <div style="padding:26px 30px 20px;border-bottom:3px solid ${GOLD}">
      <table role="presentation" width="100%"><tr>
        <td style="vertical-align:middle;width:44px"><img src="${LOGO_URL}" width="40" height="40" alt="" style="display:block;border-radius:6px"></td>
        <td style="vertical-align:middle;padding-left:12px">
          <div style="font-size:19px;color:${NAVY};font-weight:700;line-height:1.1">Letícia Barros</div>
          <div style="font-size:10px;color:${GOLD};letter-spacing:1.5px;font-family:Arial,sans-serif;font-weight:700;margin-top:2px">ADVOCACIA &amp; CONSULTORIA</div>
        </td>
      </tr></table>
    </div>
    <div style="padding:26px 30px 30px;font-family:Arial,Helvetica,sans-serif;color:#232323">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:${NAVY};margin:0 0 16px">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 30px;border-top:1px solid #eee;font-family:Arial,sans-serif;font-size:11px;color:#9a9284;text-align:center">
      Mensagem automática do CRM — crm.advogadaleticiabarros.com.br
    </div>
  </div>
</div>`;
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || transporter() !== null;
}

/** Envio via Resend (HTTP/porta 443) — funciona na Railway, que bloqueia SMTP. */
async function sendViaResend(input: MailInput): Promise<SendResult> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [input.to], subject: input.subject, html: input.html,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename, content: a.content.toString('base64'),
        })),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `Resend HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    const data: any = await res.json();
    return { ok: true, messageId: data?.id };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function sendEmail(input: MailInput): Promise<SendResult> {
  if (!input.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.to)) return { ok: false, error: 'E-mail inválido' };

  // 1) Resend por HTTP (recomendado — funciona na Railway).
  if (process.env.RESEND_API_KEY) return sendViaResend(input);

  // 2) SMTP (nodemailer) — para ambientes que permitem (local, alguns hosts).
  const tx = transporter();
  if (!tx) return { ok: false, skipped: true };
  try {
    const info = await tx.sendMail({
      from: FROM, to: input.to, subject: input.subject, html: input.html,
      text: input.text || input.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      attachments: input.attachments?.map((a) => ({
        filename: a.filename, content: a.content, contentType: a.contentType,
      })),
    });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ── Modelos prontos ─────────────────────────────────────────────────────────

const BTN = (url: string, label: string) =>
  `<a href="${url}" style="display:inline-block;background:${GOLD};color:#231e17;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${label}</a>`;

export function sendNewPassword(to: string, name: string, password: string): Promise<SendResult> {
  return sendEmail({
    to, subject: 'Sua nova senha de acesso — CRM',
    html: layout('Nova senha de acesso', `
      <p>Olá, ${name || 'cliente'}.</p>
      <p>Sua senha de acesso ao sistema foi redefinida. Use os dados abaixo para entrar:</p>
      <div style="background:#f4f6fa;border-radius:8px;padding:14px 16px;margin:14px 0">
        <div><strong>Usuário:</strong> ${to}</div>
        <div><strong>Senha:</strong> <code style="font-size:15px">${password}</code></div>
      </div>
      <p>${BTN('https://crm.advogadaleticiabarros.com.br', 'Acessar o sistema')}</p>
      <p style="color:#93a0b5;font-size:13px">Por segurança, troque a senha após o primeiro acesso.</p>`),
  });
}

export function sendCredentials(to: string, name: string, password: string): Promise<SendResult> {
  return sendEmail({
    to, subject: 'Seu acesso ao sistema — Advocacia Letícia Barros',
    html: layout('Bem-vindo(a) ao acompanhamento do seu processo', `
      <p>Olá, ${name || 'cliente'}.</p>
      <p>Criamos seu acesso para acompanhar seu(s) processo(s), o andamento e os valores. Seus dados:</p>
      <div style="background:#f4f6fa;border-radius:8px;padding:14px 16px;margin:14px 0">
        <div><strong>Usuário:</strong> ${to}</div>
        <div><strong>Senha:</strong> <code style="font-size:15px">${password}</code></div>
      </div>
      <p>${BTN('https://crm.advogadaleticiabarros.com.br', 'Acessar meu portal')}</p>`),
  });
}

/** Recibo de pagamento — enviado automaticamente ao confirmar a baixa. */
export function sendReceipt(to: string, opts: {
  name: string; valor: number; referencia: string; pagoEm: Date; numeroRecibo: string;
}): Promise<SendResult> {
  const valorFmt = `R$ ${Number(opts.valor).toFixed(2).replace('.', ',')}`;
  const dataFmt = opts.pagoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return sendEmail({
    to, subject: `Recibo de pagamento — ${valorFmt} (${dataFmt})`,
    html: layout('Recibo de pagamento', `
      <p>Olá, ${opts.name || 'cliente'}. Confirmamos o recebimento do seu pagamento. Obrigada!</p>
      <div style="background:#f4f6fa;border-radius:8px;padding:16px 18px;margin:14px 0;line-height:2">
        <div style="font-size:12px;color:#93a0b5;text-transform:uppercase;letter-spacing:.5px">Recibo nº ${opts.numeroRecibo}</div>
        <div><strong>Pagador(a):</strong> ${opts.name}</div>
        <div><strong>Referente a:</strong> ${opts.referencia}</div>
        <div><strong>Valor:</strong> <span style="font-size:18px;font-weight:700">${valorFmt}</span></div>
        <div><strong>Data do pagamento:</strong> ${dataFmt}</div>
        <div><strong>Recebedor:</strong> Advocacia Letícia Barros</div>
      </div>
      <p style="color:#93a0b5;font-size:13px">Guarde este e-mail — ele é o seu comprovante. Este recibo também fica registrado no seu portal.</p>`),
  });
}

export function sendProposalLink(to: string, name: string, url: string, title: string): Promise<SendResult> {
  return sendEmail({
    to, subject: 'Sua proposta de honorários',
    html: layout('Proposta de honorários', `
      <p>Olá, ${name || ''}.</p>
      <p>Segue a sua proposta — <strong>${title}</strong>. Você pode visualizá-la e aceitá-la pelo link abaixo:</p>
      <p style="margin:18px 0">${BTN(url, 'Ver a proposta')}</p>
      <p style="color:#93a0b5;font-size:13px">Se tiver qualquer dúvida, é só responder a este e-mail.</p>`),
  });
}
