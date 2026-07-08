import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';

/**
 * Resumo SEMANAL do parceiro (toda segunda, 08h Brasília):
 * casos novos, protocolos e movimentações dos últimos 7 dias +
 * audiências dos próximos 14 dias + repasses a receber.
 */

const money = (v: any) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const fmtDT = (d: any) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export async function sendPartnerWeeklyDigests(): Promise<number> {
  const [partners] = await db.query(`
    SELECT DISTINCT p.id, p.name FROM partners p
      JOIN users u ON u.partner_id = p.id AND u.role = 'parceiro_portal' AND u.active = 1`) as any;

  let sent = 0;
  for (const p of partners) {
    const [[stats]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM cases WHERE partner_id = ? AND created_at >= NOW() - INTERVAL 7 DAY) AS novos,
        (SELECT COUNT(DISTINCT ct.case_id) FROM client_timeline ct JOIN cases c ON c.id = ct.case_id
          WHERE c.partner_id = ? AND ct.event_type = 'etapa_protocolado' AND ct.created_at >= NOW() - INTERVAL 7 DAY) AS protocolados,
        (SELECT COUNT(*) FROM case_movements cm JOIN cases c ON c.id = cm.case_id
          WHERE c.partner_id = ? AND cm.created_at >= NOW() - INTERVAL 7 DAY) AS movimentacoes,
        (SELECT COALESCE(SUM(r.valor),0) FROM repasses r JOIN cases c ON c.id = r.case_id
          WHERE c.partner_id = ? AND r.status IN ('pendente','processando')) AS repasse_a_receber
    `, [p.id, p.id, p.id, p.id]) as any;

    const [audiencias] = await db.query(`
      SELECT ce.start_datetime, ce.video_link, cl.name AS client_name, c.case_number
        FROM calendar_events ce
        LEFT JOIN cases c ON c.id = ce.case_id
        LEFT JOIN clients cl ON cl.id = COALESCE(ce.client_id, c.client_id)
       WHERE ce.event_type = 'audiencia'
         AND ce.start_datetime BETWEEN NOW() AND NOW() + INTERVAL 14 DAY
         AND ((c.id IS NOT NULL AND c.partner_id = ?)
           OR (ce.case_id IS NULL AND ce.client_id IN (SELECT DISTINCT client_id FROM cases WHERE partner_id = ? AND client_id IS NOT NULL)))
       ORDER BY ce.start_datetime ASC LIMIT 10`, [p.id, p.id]) as any;

    // Sem nenhuma novidade e sem audiência: não envia (evita spam)
    if (!Number(stats.novos) && !Number(stats.protocolados) && !Number(stats.movimentacoes) && !audiencias.length) continue;

    const audHtml = audiencias.length ? `
      <p style="margin-top:14px"><strong>Audiências nos próximos 14 dias:</strong></p>
      <ul style="margin:6px 0 0 18px;padding:0;line-height:1.7">
        ${audiencias.map((a: any) => `<li>${fmtDT(a.start_datetime)} — ${a.client_name || 'cliente'}${a.case_number ? ` (Proc. ${a.case_number})` : ''}${a.video_link ? ' · ONLINE' : ''}</li>`).join('')}
      </ul>` : '';

    const html = layout('Resumo semanal da parceria', `
      <p>Olá, ${p.name}. Este é o resumo da última semana nos casos indicados por você:</p>
      <div style="background:#f4f6fa;border-radius:8px;padding:14px 16px;margin:14px 0;line-height:1.9">
        <div><strong>Casos novos:</strong> ${stats.novos}</div>
        <div><strong>Processos protocolados:</strong> ${stats.protocolados}</div>
        <div><strong>Movimentações registradas:</strong> ${stats.movimentacoes}</div>
        <div><strong>Repasses a receber:</strong> ${money(stats.repasse_a_receber)}</div>
      </div>
      ${audHtml}
      <p style="margin-top:14px">Os detalhes estão no seu portal:
        <a href="https://crm.advogadaleticiabarros.com.br">crm.advogadaleticiabarros.com.br</a></p>`);

    const [users] = await db.query(
      "SELECT name, email FROM users WHERE role = 'parceiro_portal' AND partner_id = ? AND active = 1", [p.id]) as any;
    for (const u of users) {
      if (!u.email || !u.email.includes('@')) continue;
      const r = await sendEmail({ to: u.email, subject: `📋 Resumo semanal — parceria ${p.name}`, html }).catch(() => ({ ok: false }));
      if ((r as any).ok) sent++;
    }
  }
  if (sent) console.log(`📋 Resumo semanal do parceiro: ${sent} e-mail(s) enviados.`);
  return sent;
}
