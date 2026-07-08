import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';

/**
 * Alertas de AUDIÊNCIA para o PARCEIRO (portal do parceiro):
 *  - 7 dias antes e 3 dias antes da audiência de qualquer caso da parceria,
 *    o parceiro recebe um alerta no sino do CRM e um e-mail com o nome do
 *    cliente, nº do processo, caso (parte contrária), data e hora corretas,
 *    e toda a orientação necessária (presencial ou online).
 *  - Dedup por notifications (calendar_event_id + notification_type + user).
 *  Roda 1x/dia via cron (e é seguro rodar de novo: não repete no mesmo dia).
 */

const fmtData = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const fmtHora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function orientacoes(online: boolean, videoLink: string | null): string {
  if (online) {
    return `
      <p><strong>Esta audiência é ONLINE.</strong> Oriente o(a) cliente a:</p>
      <ul style="margin:8px 0 0 18px;padding:0;line-height:1.7">
        <li>Entrar/logar pelo link <strong>15 minutos antes</strong> do horário marcado${videoLink ? `: <a href="${videoLink}">${videoLink}</a>` : ' (o link será informado pelo juízo/escritório)'};</li>
        <li>Testar antes a câmera, o microfone e a conexão de internet;</li>
        <li>Estar em local silencioso e bem iluminado, com o celular carregado;</li>
        <li>Ter em mãos documento oficial com foto (RG ou CNH);</li>
        <li>Não desligar/sair da sala até ser dispensado(a) pelo juízo.</li>
      </ul>`;
  }
  return `
    <p><strong>Esta audiência é PRESENCIAL.</strong> Oriente o(a) cliente a:</p>
    <ul style="margin:8px 0 0 18px;padding:0;line-height:1.7">
      <li>Chegar ao local com <strong>30 minutos de antecedência</strong>;</li>
      <li>Levar documento oficial com foto (RG ou CNH);</li>
      <li>Vestir-se adequadamente e desligar o celular durante o ato;</li>
      <li>Aguardar o pregão no local indicado e não se ausentar.</li>
    </ul>`;
}

export async function sendPartnerHearingAlerts(): Promise<{ alerts: number; emails: number }> {
  // Audiências exatamente a 7 ou 3 dias: atreladas a um CASO de parceria OU
  // apenas ao CLIENTE de um parceiro (lançadas na agenda sem vincular o caso).
  const [events] = await db.query(`
    SELECT ce.id, ce.title, ce.start_datetime, ce.location, ce.video_link, ce.description,
           DATEDIFF(DATE(ce.start_datetime), CURDATE()) AS dias,
           c.id AS case_id, c.case_number, c.title AS case_title,
           COALESCE(c.partner_id, pc.partner_id) AS partner_id,
           cl.name AS client_name
      FROM calendar_events ce
      LEFT JOIN cases c ON c.id = ce.case_id
      LEFT JOIN clients cl ON cl.id = COALESCE(ce.client_id, c.client_id)
      LEFT JOIN (SELECT client_id, MIN(partner_id) AS partner_id FROM cases
                  WHERE partner_id IS NOT NULL AND client_id IS NOT NULL GROUP BY client_id) pc
             ON pc.client_id = ce.client_id AND ce.case_id IS NULL
     WHERE ce.event_type = 'audiencia'
       AND DATE(ce.start_datetime) IN (DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_ADD(CURDATE(), INTERVAL 3 DAY))
    HAVING partner_id IS NOT NULL
  `) as any;

  let alerts = 0, emails = 0;
  for (const ev of events) {
    const tipo = `audiencia_parceria_${ev.dias}d`;

    // Usuários do portal deste parceiro
    const [users] = await db.query(
      "SELECT id, name, email FROM users WHERE role = 'parceiro_portal' AND partner_id = ? AND active = 1",
      [ev.partner_id]
    ) as any;

    const start = new Date(ev.start_datetime);
    const online = !!(ev.video_link && String(ev.video_link).trim());

    for (const u of users) {
      // Dedup: já alertado este evento/este marco para este usuário?
      const [[dup]] = await db.query(
        'SELECT COUNT(*) AS n FROM notifications WHERE calendar_event_id = ? AND user_id = ? AND notification_type = ?',
        [ev.id, u.id, tipo]
      ) as any;
      if (Number(dup?.n)) continue;

      // 1) Alerta no sino do CRM
      await db.query(
        `INSERT INTO notifications (user_id, client_id, case_id, calendar_event_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 'sistema', NOW(), 'pendente')`,
        [u.id, ev.case_id, ev.id,
         `Audiência em ${ev.dias} dias — ${ev.client_name || 'cliente'}`,
         `${ev.client_name || ''} · ${ev.case_title || ev.title}${ev.case_number ? ` · Proc. ${ev.case_number}` : ''} — ${fmtData(start)} às ${fmtHora(start)}${online ? ' (ONLINE)' : ev.location ? ` · ${ev.location}` : ''}`,
         tipo]
      );
      alerts++;

      // 2) E-mail com todos os detalhes e orientações
      if (u.email && u.email.includes('@')) {
        const html = layout(`Audiência em ${ev.dias} dias — não deixe para depois`, `
          <p>Olá, ${u.name || 'parceiro'}.</p>
          <p>Lembrete: há uma <strong>audiência em ${ev.dias} dias</strong> em um processo indicado por você.
             Confira os dados e repasse as orientações ao(à) cliente para que não haja atrasos ou equívocos.</p>
          <div style="background:#f4f6fa;border-radius:8px;padding:14px 16px;margin:14px 0;line-height:1.8">
            <div><strong>Cliente:</strong> ${ev.client_name || '—'}</div>
            <div><strong>Caso:</strong> ${ev.case_title || ev.title || '—'}</div>
            <div><strong>Nº do processo:</strong> ${ev.case_number || 'aguardando protocolo'}</div>
            <div><strong>Data:</strong> ${fmtData(start)}</div>
            <div><strong>Horário:</strong> ${fmtHora(start)} (horário de Brasília)</div>
            <div><strong>Modalidade:</strong> ${online ? 'Online (videoconferência)' : 'Presencial'}</div>
            ${!online && ev.location ? `<div><strong>Local:</strong> ${ev.location}</div>` : ''}
            ${online && ev.video_link ? `<div><strong>Link de acesso:</strong> <a href="${ev.video_link}">${ev.video_link}</a></div>` : ''}
            ${ev.description ? `<div><strong>Observações:</strong> ${String(ev.description).slice(0, 400)}</div>` : ''}
          </div>
          ${orientacoes(online, ev.video_link)}
          <p style="margin-top:14px">Este lembrete é enviado 7 e 3 dias antes da audiência. Em caso de dúvida, fale com o escritório.</p>`);
        const r = await sendEmail({
          to: u.email,
          subject: `⚖️ Audiência em ${ev.dias} dias — ${ev.client_name || 'cliente'}${ev.case_number ? ` (Proc. ${ev.case_number})` : ''}`,
          html,
        }).catch(() => ({ ok: false as const }));
        if ((r as any).ok) emails++;
      }
    }
  }

  if (alerts || emails) console.log(`⚖️ Alertas de audiência (parceria): ${alerts} sino(s), ${emails} e-mail(s).`);
  return { alerts, emails };
}
