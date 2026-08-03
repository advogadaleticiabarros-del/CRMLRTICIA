import { db } from '../config/database';
import { getExecutiveReportData, ExecutiveReportData } from './executiveReport';
import { buildExecutiveReportPdf } from './executiveReportPdf';
import { buildNarrative, prevMonthOf, delta, Delta } from './executiveReportNarrative';
import { sendEmail, SendResult } from './EmailService';

// ── Identidade visual — mesma paleta do papel timbrado (ver executiveReportPdf.ts) ──
const NAVY = '#1f3047';
const GOLD = '#c19a4e';
const GOLD_SOFT = '#f2ead3';
const NAVY_SOFT = '#eef1f6';
const INK = '#232323';
const MUTED = '#6b6252';
const GREEN = '#1c7a3d';
const RED = '#c0392b';
const LOGO_URL = (process.env.APP_URL || 'https://crm.advogadaleticiabarros.com.br') + '/logo.png';

const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const mesLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(m) - 1] + ' de ' + y;
};
const deltaHtml = (dl: Delta | null): string => {
  if (!dl || dl.pct === null) return '';
  const color = dl.alta ? GREEN : RED;
  return ` <span style="color:${color};font-size:12px;font-weight:700">${dl.alta ? '▲' : '▼'} ${Math.abs(dl.pct)}%</span>`;
};

/** Envelope visual do e-mail — mesma identidade do papel timbrado (navy + dourado, serif no título). */
function brandedLayout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Georgia,'Times New Roman',serif;background:#faf8f4;padding:24px 12px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2ddd1">
    <div style="padding:26px 30px 20px;border-bottom:3px solid ${GOLD}">
      <table role="presentation" width="100%"><tr>
        <td style="vertical-align:middle"><img src="${LOGO_URL}" width="40" height="40" alt="" style="display:block;border-radius:6px"></td>
        <td style="vertical-align:middle;padding-left:12px">
          <div style="font-size:19px;color:${NAVY};font-weight:700;line-height:1.1">Letícia Barros</div>
          <div style="font-size:10px;color:${GOLD};letter-spacing:1.5px;font-family:Arial,sans-serif;font-weight:700;margin-top:2px">ADVOCACIA &amp; CONSULTORIA</div>
        </td>
      </tr></table>
    </div>
    <div style="padding:26px 30px 30px;font-family:Arial,Helvetica,sans-serif;color:${INK}">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:21px;color:${NAVY};margin:0 0 18px">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 30px;border-top:1px solid #eee;font-family:Arial,sans-serif;font-size:11px;color:#9a9284;text-align:center">
      Mensagem automática do CRM — crm.advogadaleticiabarros.com.br
    </div>
  </div>
</div>`;
}

/** Mês anterior (AAAA-MM) — usado no envio automático do dia 1, quando o mês corrente acabou de fechar. */
function mesAnteriorFechado(): string {
  const d = new Date(); d.setDate(0); // vai para o último dia do mês anterior
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Envia o Relatório Executivo do mês — resumo elegante em HTML + PDF completo em anexo. */
export async function sendMonthlyExecutiveReportEmail(month?: string): Promise<SendResult & { month: string }> {
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : mesAnteriorFechado();
  const to = process.env.RELATORIO_EXECUTIVO_EMAIL || 'admin@advogadaleticiabarros.com.br';

  const data = await getExecutiveReportData(ym);
  const prev: ExecutiveReportData | null = await getExecutiveReportData(prevMonthOf(ym)).catch(() => null);
  const narrative = buildNarrative(data, prev);
  const pdf = await buildExecutiveReportPdf(data, prev, narrative);

  const kpiCell = (label: string, value: string, dl: Delta | null) => `
    <td style="padding:12px 10px;background:${NAVY_SOFT};border-radius:8px" width="25%">
      <div style="font-size:9.5px;color:${MUTED};text-transform:uppercase;letter-spacing:.5px;font-family:Arial,sans-serif">${label}</div>
      <div style="font-family:Georgia,serif;font-size:16px;color:${NAVY};font-weight:700;margin-top:3px">${value}</div>
      <div style="font-family:Arial,sans-serif">${deltaHtml(dl)}</div>
    </td>`;

  const dRec = prev ? delta(data.receita_total, prev.receita_total) : null;
  const dRes = prev ? delta(data.resultado, prev.resultado) : null;
  const dProt = prev ? delta(data.processos.total_protocolados, prev.processos.total_protocolados) : null;
  const dLeads = prev ? delta(data.funil.leads_novos, prev.funil.leads_novos) : null;

  const linha = (label: string, valor: string) =>
    `<tr><td style="padding:7px 0;color:${MUTED};font-size:13px">${label}</td><td style="padding:7px 0;text-align:right;font-weight:700;color:${NAVY};font-size:13px">${valor}</td></tr>`;

  const html = brandedLayout(`Relatório Executivo — ${mesLabel(ym)}`, `
    <div style="background:${NAVY_SOFT};border-radius:8px;padding:16px 18px;margin-bottom:20px">
      <div style="font-size:9px;color:${GOLD};text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;font-weight:700;margin-bottom:6px">Resumo do mês</div>
      <p style="margin:0 0 12px;font-size:13.5px;line-height:1.6;color:${NAVY}">${narrative.resumo}</p>
      <ul style="margin:12px 0 0;padding:12px 0 0 18px;border-top:1px solid #d7dde6;list-style:none">
        ${narrative.destaques.map((t) => `<li style="font-size:12.5px;color:${NAVY};line-height:1.6;margin-bottom:5px;position:relative;padding-left:14px">
          <span style="position:absolute;left:0;color:${GOLD}">●</span>${t}</li>`).join('')}
      </ul>
    </div>

    <table role="presentation" width="100%" cellspacing="6" cellpadding="0"><tr>
      ${kpiCell('Receita total', money(data.receita_total), dRec)}
      ${kpiCell('Resultado', money(data.resultado), dRes)}
    </tr><tr>
      ${kpiCell('Protocolados', String(data.processos.total_protocolados), dProt)}
      ${kpiCell('Leads novos', String(data.funil.leads_novos), dLeads)}
    </tr></table>

    <div style="margin-top:22px">
      <div style="font-size:9px;color:${GOLD};text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;font-weight:700;margin-bottom:4px">Saídas pagas</div>
      <table style="width:100%;border-collapse:collapse" role="presentation">
        ${linha('Empresa — despesas', money(data.saidas.empresa.despesas))}
        ${linha('Empresa — repasses a parceiros', money(data.saidas.empresa.repasses))}
        ${linha('Pessoal — despesas', money(data.saidas.pessoal.despesas))}
        ${linha('TOTAL GERAL', money(data.saidas.total_geral))}
      </table>
      <p style="margin:4px 0 0;font-size:11px;color:#9a9284;font-family:Arial,sans-serif">O resultado acima é receita − saídas da empresa; as despesas pessoais não entram nessa conta, só no total geral.</p>
    </div>

    <table style="width:100%;border-collapse:collapse;margin:18px 0 0" role="presentation">
      ${linha('Propostas criadas · aceitas', `${data.funil.propostas_criadas} · ${data.funil.propostas_aceitas}`)}
      ${linha('Inadimplência acumulada (hoje)', money(data.situacao_atual.inadimplencia))}
      ${linha('Casos na esteira agora', String(data.situacao_atual.casos_na_esteira))}
    </table>

    <div style="background:${GOLD_SOFT};border-radius:8px;padding:16px 18px;margin-top:20px">
      <div style="font-size:9px;color:#8a6d1a;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;font-weight:700;margin-bottom:8px">Dicas &amp; recomendações</div>
      <ul style="margin:0;padding-left:18px;color:#4a3d1d;font-size:13px;line-height:1.7">
        ${narrative.dicas.map((t) => `<li style="margin-bottom:6px">${t}</li>`).join('')}
      </ul>
    </div>

    <p style="color:#9a9284;font-size:12px;margin-top:22px;font-family:Arial,sans-serif">O relatório completo está em PDF, anexado a este e-mail — com a lista de cada processo protocolado (número, cliente e área).</p>`);

  const result = await sendEmail({
    to, subject: `Relatório Executivo — ${mesLabel(ym)}`, html,
    attachments: [{ filename: `relatorio-executivo-${ym}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });

  // Registro de auditoria — mesmo padrão dos outros envios automáticos do sistema.
  try {
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'relatorio_mensal', 'sistema', NOW(), 'pendente')`,
        [a.id,
         result.ok ? `Relatório executivo de ${ym} enviado` : `Falha ao enviar relatório executivo de ${ym}`,
         result.ok ? `Enviado para ${to}, com o PDF completo em anexo.` : `Erro: ${result.error || 'desconhecido'}`]
      );
    }
  } catch { /* auditoria é best-effort */ }

  return { ...result, month: ym };
}
