import { db } from '../config/database';
import { getExecutiveReportData } from './executiveReport';
import { buildExecutiveReportPdf } from './executiveReportPdf';
import { sendEmail, layout, SendResult } from './EmailService';

const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const mesLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(m) - 1] + ' de ' + y;
};

/** Mês anterior (AAAA-MM) — usado no envio automático do dia 1, quando o mês corrente acabou de fechar. */
function mesAnterior(): string {
  const d = new Date(); d.setDate(0); // vai para o último dia do mês anterior
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Envia o Relatório Executivo do mês (resumo em HTML + PDF completo em anexo). */
export async function sendMonthlyExecutiveReportEmail(month?: string): Promise<SendResult & { month: string }> {
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : mesAnterior();
  const to = process.env.RELATORIO_EXECUTIVO_EMAIL || 'admin@advogadaleticiabarros.com.br';

  const data = await getExecutiveReportData(ym);
  const pdf = await buildExecutiveReportPdf(data);

  const linha = (label: string, valor: string) =>
    `<tr><td style="padding:6px 0;color:#4b5563">${label}</td><td style="padding:6px 0;text-align:right;font-weight:600">${valor}</td></tr>`;

  const html = layout(`Relatório Executivo — ${mesLabel(ym)}`, `
    <p>Balanço geral do mês, pra você entender o volume de trabalho e o financeiro do escritório de um olhar só. O relatório completo (com o número de cada processo protocolado) está em PDF, anexado a este e-mail.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${linha('Receita total', money(data.receita_total))}
      ${linha('Saídas (despesas + repasses)', money(data.saidas.total))}
      ${linha('Resultado do mês', money(data.resultado))}
    </table>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:1px solid #e7ecf3;padding-top:8px">
      ${linha('Processos protocolados', String(data.processos.total_protocolados) + ` (${data.processos.proprios} próprio · ${data.processos.parcerias} parceria)`)}
      ${linha('Movimentações processuais recebidas', String(data.processos.movimentacoes_total))}
      ${linha('Compromissos na agenda', String(data.agenda.compromissos_total))}
      ${linha('Leads novos · propostas aceitas', `${data.funil.leads_novos} · ${data.funil.propostas_aceitas}`)}
      ${linha('Inadimplência acumulada (hoje)', money(data.situacao_atual.inadimplencia))}
    </table>
    <p style="color:#93a0b5;font-size:13px">Relatório gerado automaticamente todo início de mês. O PDF em anexo traz a lista completa dos processos protocolados, com número, cliente e área.</p>`);

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
