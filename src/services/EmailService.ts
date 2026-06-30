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

interface MailInput { to: string; subject: string; html: string; text?: string; }

const FROM = process.env.EMAIL_FROM || 'Advocacia Letícia Barros <no-reply@advogadaleticiabarros.com.br>';
const BRAND = '#2a3f5f';

let cached: Transporter | null = null;
function transporter(): Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return cached;
}

/** Envolve o conteúdo num layout simples com a marca do escritório. */
function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2a3a">
    <div style="background:${BRAND};color:#fff;padding:22px 28px;border-radius:12px 12px 0 0">
      <div style="font-size:20px;font-weight:bold;letter-spacing:.5px">Advocacia Letícia Barros</div>
      <div style="font-size:12px;color:#ceae72;letter-spacing:1px;text-transform:uppercase">Advocacia &amp; Consultoria</div>
    </div>
    <div style="border:1px solid #e7ecf3;border-top:none;padding:26px 28px;border-radius:0 0 12px 12px;background:#fff">
      <h2 style="margin:0 0 14px;font-size:18px;color:${BRAND}">${title}</h2>
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#93a0b5;font-size:11px;margin-top:14px">
      Mensagem automática do CRM — crm.advogadaleticiabarros.com.br</p>
  </div>`;
}

export function isEmailConfigured(): boolean {
  return transporter() !== null;
}

export async function sendEmail(input: MailInput): Promise<SendResult> {
  const tx = transporter();
  if (!tx) return { ok: false, skipped: true };
  if (!input.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.to)) return { ok: false, error: 'E-mail inválido' };
  try {
    const info = await tx.sendMail({
      from: FROM, to: input.to, subject: input.subject, html: input.html,
      text: input.text || input.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ── Modelos prontos ─────────────────────────────────────────────────────────

const BTN = (url: string, label: string) =>
  `<a href="${url}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${label}</a>`;

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
