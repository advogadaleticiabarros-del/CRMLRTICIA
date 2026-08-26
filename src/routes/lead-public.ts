import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../config/database';
import { normalizeChannel } from '../services/leadChannel';
import { notifyNewLead } from '../services/leadAlert';
import { sendEmail, layout } from '../services/EmailService';
import { sendText } from '../services/uazapiInstance';
import { qualificarLead } from '../services/aiAssistant';

const router = Router();

// Mesma lista de 7 valores que a migration 100 grava no ENUM de leads.legal_area
// (migrations/100_padroniza_legal_area.sql). Constante local — não compartilhada
// com src/routes/leads.ts — seguindo o mesmo padrão já usado no projeto.
const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

// ── Campanhas de isca (e-book) — dispara e-mail com anexo + aviso no
// WhatsApp assim que o lead entra. Cada campanha é identificada pelo
// utm_campaign que a própria LP manda fixo no envio do formulário.
const CAMPANHAS_EBOOK: Record<string, { arquivo: string; titulo: string }> = {
  'guia-gestante-trabalhadora': {
    arquivo: 'guia-direitos-gestante-trabalhadora.pdf',
    titulo: 'Guia de Direitos da Gestante Trabalhadora',
  },
};

async function enviarEbook(campanha: string, nome: string, email: string | null, phone: string | null): Promise<void> {
  const info = CAMPANHAS_EBOOK[campanha];
  if (!info) return;
  const primeiroNome = (nome || '').trim().split(' ')[0] || '';

  if (email) {
    try {
      const caminho = path.join(__dirname, '..', '..', 'assets', 'ebooks', info.arquivo);
      const pdf = fs.readFileSync(caminho);
      await sendEmail({
        to: email,
        subject: `Seu material: ${info.titulo}`,
        html: layout(info.titulo, `
          <p>Olá${primeiroNome ? ', ' + primeiroNome : ''}!</p>
          <p>Obrigada por se cadastrar. Segue em anexo o <strong>${info.titulo}</strong>, com uma explicação clara sobre esse direito.</p>
          <p>Qualquer dúvida sobre o seu caso específico, é só responder este e-mail ou chamar no WhatsApp — vamos te ajudar com prazer.</p>
          <p style="margin-top:22px">Um abraço,<br><strong>Dra. Letícia Barros</strong><br><span style="font-size:12px;color:#8a8172">OAB/ES 39.948</span></p>
        `),
        attachments: [{ filename: info.arquivo, content: pdf, contentType: 'application/pdf' }],
      });
    } catch { /* best-effort — a mensagem de WhatsApp abaixo já avisa como pedir reenvio */ }
  }

  if (phone) {
    let digits = phone.replace(/\D/g, '');
    if (digits.length <= 11) digits = '55' + digits;
    const texto = [
      `Olá${primeiroNome ? ', ' + primeiroNome : ''}! Recebemos seu cadastro e já enviamos o *${info.titulo}* para o seu e-mail${email ? ' (' + email + ')' : ''}.`,
      `Se não encontrar, dá uma olhada na caixa de spam/promoções. E se mesmo assim não chegar, é só pedir aqui que a gente reenvia na hora.`,
      `*Salve nosso contato* e conte com a gente sempre que precisar:\n• (44) 99101-1402\n• (27) 99515-1402\n• advogadaleticia.barros@gmail.com`,
    ].join('\n\n');
    await sendText(digits, texto, 'Automático — envio de e-book').catch(() => {});
  }
}

// Anti-spam simples: máx. 5 envios por IP a cada 15 min + campo honeypot.
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map<string, { count: number; first: number }>();
function tooMany(ip: string): boolean {
  const h = hits.get(ip);
  if (!h || Date.now() - h.first > WINDOW_MS) { hits.set(ip, { count: 1, first: Date.now() }); return false; }
  h.count++;
  if (hits.size > 5000) hits.clear();
  return h.count > 5;
}

// ── POST /api/public/lead — formulário do site/blog cai direto no funil ──────
// Campos: name*, phone, email, area, message, website (honeypot — deve vir vazio).
// CORS aberto: o formulário vive no domínio do blog (Hostinger), não no CRM.
router.options('/lead', (_req: Request, res: Response) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

router.post('/lead', async (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', '*');
  const b = req.body || {};
  if (b.website) { res.json({ success: true }); return; } // honeypot: bot preencheu — finge sucesso
  if (tooMany(req.ip || 'ip')) { res.status(429).json({ error: 'Muitos envios — tente mais tarde' }); return; }

  const name = String(b.name || '').trim();
  if (name.length < 3) { res.status(400).json({ error: 'Informe seu nome' }); return; }
  const phone = String(b.phone || '').replace(/\D/g, '').slice(0, 15) || null;
  const email = String(b.email || '').trim().slice(0, 255) || null;
  // Formulário público (LP externa) pode mandar capitalização diferente
  // ("Trabalhista" vs "trabalhista") — normaliza antes de validar contra a
  // lista, em vez de descartar silenciosamente. Só os 7 valores exatos entram.
  const areaRaw = String(b.area || '').trim().toLowerCase().slice(0, 100);
  const area = AREAS.includes(areaRaw) ? areaRaw : null;
  const message = String(b.message || '').trim().slice(0, 2000);

  // UTM: aceita tanto no body (form que já leu location.search via JS) quanto
  // na própria query string do POST (link do anúncio/bio apontando direto pra cá).
  const q = req.query || {};
  const pick = (k: string) => String(b[k] ?? q[k] ?? '').trim().slice(0, 150) || null;
  const utm_source = pick('utm_source');
  const utm_medium = pick('utm_medium');
  const utm_campaign = pick('utm_campaign');
  const utm_content = pick('utm_content');
  const utm_term = pick('utm_term');
  const landing_page = String(b.landing_page || req.get('referer') || '').trim().slice(0, 500) || null;
  const source = normalizeChannel({ utm_source, utm_medium, fallback: 'site' });

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) { res.status(500).json({ error: 'Indisponível' }); return; }

  // Não duplica: mesmo telefone/e-mail nas últimas 24h só atualiza o resumo.
  const [[dup]] = await db.query(
    `SELECT id FROM leads WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
       AND ((? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND email = ?)) LIMIT 1`,
    [phone, phone, email, email]
  ) as any;
  if (dup) {
    await db.query('UPDATE leads SET case_summary = CONCAT(COALESCE(case_summary,\'\'), \'\n---\n\', ?) WHERE id = ?',
      [`Novo envio pelo site: ${message}`, dup.id]).catch(() => {});
    res.json({ success: true });
    return;
  }

  const [ins] = await db.query(
    `INSERT INTO leads (user_id, name, phone, email, source, legal_area, status, case_summary,
                         utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page)
     VALUES (?, ?, ?, ?, ?, ?, 'triagem', ?, ?, ?, ?, ?, ?, ?)`,
    [admin.id, name, phone, email, source, area, message ? `Mensagem enviada pelo site:\n"${message}"` : null,
     utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page]
  ) as any;

  await notifyNewLead({ leadId: ins.insertId, name, phone, source, area, message });

  if (utm_campaign && CAMPANHAS_EBOOK[utm_campaign]) {
    enviarEbook(utm_campaign, name, email, phone).catch(() => {});
  }

  // Qualificação automática pela IA (fire-and-forget) — só quando há texto
  // real; nunca atrasa nem falha a resposta ao formulário público.
  if (message && message.length >= 15) {
    qualificarLead(ins.insertId, message).catch(() => {});
  }

  res.status(201).json({ success: true });
});

// ── POST /api/public/newsletter — assinatura do "Jornal da Semana" (blog) ───
// Campos: name*, email*, phone (opcional), website (honeypot).
// Cai em `leads` com status='newsletter' — fora de ACTIVE_STATUSES, então
// nunca aparece no Kanban de triagem/conversão, só na lista separada.
// Dispara e-mail de boas-vindas (se configurado) e o alerta de sino/WhatsApp
// de sempre pra Letícia saber que alguém novo assinou.
router.options('/newsletter', (_req: Request, res: Response) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

router.post('/newsletter', async (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', '*');
  const b = req.body || {};
  if (b.website) { res.json({ success: true }); return; } // honeypot: bot preencheu — finge sucesso
  if (tooMany(req.ip || 'ip')) { res.status(429).json({ error: 'Muitos envios — tente mais tarde' }); return; }

  const name = String(b.name || '').trim();
  if (name.length < 3) { res.status(400).json({ error: 'Informe seu nome' }); return; }
  const email = String(b.email || '').trim().toLowerCase().slice(0, 255);
  if (!email || !email.includes('@')) { res.status(400).json({ error: 'Informe um e-mail válido' }); return; }
  const phone = String(b.phone || '').replace(/\D/g, '').slice(0, 15) || null;

  const q = req.query || {};
  const pick = (k: string) => String(b[k] ?? q[k] ?? '').trim().slice(0, 150) || null;
  const utm_source = pick('utm_source');
  const utm_medium = pick('utm_medium');
  const utm_campaign = pick('utm_campaign') || 'jornal-da-semana';
  const utm_content = pick('utm_content');
  const utm_term = pick('utm_term');
  const landing_page = String(b.landing_page || req.get('referer') || '').trim().slice(0, 500) || null;

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) { res.status(500).json({ error: 'Indisponível' }); return; }

  // Não duplica: mesmo e-mail já assinante só atualiza o telefone se informado agora.
  const [[dup]] = await db.query(
    `SELECT id, phone FROM leads WHERE email = ? AND status = 'newsletter' LIMIT 1`,
    [email]
  ) as any;
  if (dup) {
    if (phone && !dup.phone) {
      await db.query('UPDATE leads SET phone = ? WHERE id = ?', [phone, dup.id]).catch(() => {});
    }
    res.json({ success: true });
    return;
  }

  const [ins] = await db.query(
    `INSERT INTO leads (user_id, name, phone, email, source, legal_area, status, case_summary,
                         utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page)
     VALUES (?, ?, ?, ?, ?, NULL, 'newsletter', ?, ?, ?, ?, ?, ?, ?)`,
    [admin.id, name, phone, email, normalizeChannel({ utm_source, utm_medium, fallback: 'blog' }),
     'Assinante do Jornal da Semana (blog)', utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page]
  ) as any;

  await notifyNewLead({
    leadId: ins.insertId, name, phone, source: 'Jornal da Semana (blog)',
    area: null, message: `Nova assinatura do jornal. E-mail: ${email}`,
  });

  res.status(201).json({ success: true });
});

export default router;
