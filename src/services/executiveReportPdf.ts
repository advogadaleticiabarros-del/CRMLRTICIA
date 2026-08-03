import PDFDocument from 'pdfkit';
import { ExecutiveReportData } from './executiveReport';

const NAVY = '#0d1b2e';
const GOLD = '#a5822f';
const GREEN = '#1c7a3d';
const RED = '#c0392b';
const MUTED = '#6b7280';

const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const AREA_PT: Record<string, string> = {
  trabalhista: 'Trabalhista', gestante: 'Gestante/Maternidade', familia: 'Família',
  civel: 'Cível', previdenciario: 'Previdenciário', consumidor: 'Consumidor', outro: 'Outro',
};
const AGENDA_PT: Record<string, string> = {
  reuniao: 'Reuniões', audiencia: 'Audiências', prazo: 'Prazos', tarefa: 'Tarefas', compromisso: 'Outros compromissos',
};
const mesLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(m) - 1] + '/' + y;
};

/** Gera o PDF do Relatório Executivo mensal — mesma fonte de dados da tela e do e-mail. */
export function buildExecutiveReportPdf(d: ExecutiveReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Cabeçalho ────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 74).fill(NAVY);
    doc.fillColor('#fff').fontSize(17).font('Helvetica-Bold').text('Advocacia Letícia Barros', 48, 22);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica').text('ADVOCACIA & CONSULTORIA', 48, 44, { characterSpacing: 1 });
    doc.fillColor('#fff').fontSize(11).text(`Relatório Executivo — ${mesLabel(d.month)}`, 48, 74 - 20, { width: doc.page.width - 96, align: 'right' });
    doc.y = 96;

    const h2 = (t: string) => { doc.moveDown(0.6); doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold').text(t); doc.moveDown(0.2); };
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.fontSize(10).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? NAVY : '#1f2a3a');
      doc.text(label, 48, y, { continued: false, width: 340 });
      doc.text(value, 48, y, { width: doc.page.width - 96, align: 'right' });
      doc.moveDown(0.35);
    };
    const divider = () => { doc.moveDown(0.15); doc.strokeColor('#e5e7eb').moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke(); doc.moveDown(0.3); };

    // ── Receita ──────────────────────────────────────────────────────────────
    h2('Receita recebida por frente');
    row('Clientes & contratos', money(d.receitas.clientes));
    row('Parcerias (entrada/êxito/sucumbência)', money(d.receitas.parcerias));
    row('Dativo (Estado)', money(d.receitas.dativo));
    row('Correspondente jurídico', money(d.receitas.correspondente));
    row('Êxitos (RPV/precatório/alvará)', money(d.receitas.exitos));
    divider();
    row('RECEITA TOTAL', money(d.receita_total), true);

    // ── Saídas ───────────────────────────────────────────────────────────────
    h2('Saídas pagas');
    row('Despesas', money(d.saidas.despesas));
    row('Repasses a parceiros', money(d.saidas.repasses));
    divider();
    row('TOTAL DE SAÍDAS', money(d.saidas.total), true);

    // ── Resultado ────────────────────────────────────────────────────────────
    doc.moveDown(0.3);
    const ry = doc.y;
    doc.roundedRect(48, ry, doc.page.width - 96, 34, 6).lineWidth(1.4).strokeColor(NAVY).stroke();
    doc.fontSize(12).font('Helvetica-Bold').fillColor(NAVY).text('RESULTADO DO MÊS', 60, ry + 10, { continued: false });
    doc.fillColor(d.resultado >= 0 ? GREEN : RED).text(money(d.resultado), 48, ry + 10, { width: doc.page.width - 108, align: 'right' });
    doc.y = ry + 44;

    // ── Volume de trabalho: processos protocolados ──────────────────────────
    h2(`Processos protocolados no mês (${d.processos.total_protocolados})`);
    doc.fontSize(10).font('Helvetica').fillColor(MUTED)
      .text(`${d.processos.proprios} próprio(s) · ${d.processos.parcerias} de parceria`);
    doc.moveDown(0.3);
    if (d.processos.protocolados.length) {
      const colX = [48, 190, 340, 430, 500];
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY);
      const hy = doc.y;
      doc.text('Nº do processo', colX[0], hy, { width: 140 });
      doc.text('Cliente', colX[1], hy, { width: 145 });
      doc.text('Área', colX[2], hy, { width: 85 });
      doc.text('Tipo', colX[3], hy, { width: 65 });
      doc.text('Data', colX[4], hy, { width: 47 });
      doc.moveDown(0.5);
      divider();
      doc.font('Helvetica').fontSize(9).fillColor('#1f2a3a');
      for (const p of d.processos.protocolados) {
        if (doc.y > doc.page.height - 90) { doc.addPage(); doc.y = 48; }
        const y0 = doc.y;
        doc.text(p.case_number || '—', colX[0], y0, { width: 140 });
        doc.text(p.client_name, colX[1], y0, { width: 145 });
        doc.text(AREA_PT[p.legal_area] || p.legal_area, colX[2], y0, { width: 85 });
        doc.text(p.tipo === 'parceria' ? 'Parceria' : 'Próprio', colX[3], y0, { width: 65 });
        doc.text(p.data, colX[4], y0, { width: 47 });
        doc.moveDown(0.35);
      }
    } else {
      doc.fontSize(10).font('Helvetica').fillColor(MUTED).text('Nenhum processo protocolado neste mês.');
    }

    // ── Movimentação processual ─────────────────────────────────────────────
    h2('Movimentação processual (DJEN)');
    row('Movimentações recebidas no mês', String(d.processos.movimentacoes_total));
    row('Processos com movimentação', String(d.processos.processos_com_movimentacao));

    // ── Agenda ───────────────────────────────────────────────────────────────
    h2(`Agenda do mês (${d.agenda.compromissos_total} compromisso${d.agenda.compromissos_total === 1 ? '' : 's'})`);
    if (d.agenda.por_tipo.length) {
      for (const t of d.agenda.por_tipo) row(AGENDA_PT[t.tipo] || t.tipo, String(t.total));
    } else {
      doc.fontSize(10).font('Helvetica').fillColor(MUTED).text('Nenhum compromisso registrado neste mês.');
    }

    // ── Funil comercial ──────────────────────────────────────────────────────
    h2('Funil comercial');
    row('Leads novos', String(d.funil.leads_novos));
    row('Contratos fechados', String(d.funil.leads_fechados));
    row('Conversão', `${d.funil.conversao_pct}%`);
    row('Propostas criadas · aceitas', `${d.funil.propostas_criadas} · ${d.funil.propostas_aceitas}`);

    // ── Produção ─────────────────────────────────────────────────────────────
    h2('Produção');
    row('Processos protocolados no mês', String(d.producao.protocolados));
    row('Casos que entraram na esteira', String(d.producao.entraram_esteira));
    row('Casos recusados após análise', String(d.producao.recusados));

    // ── Situação atual ───────────────────────────────────────────────────────
    h2('Situação hoje');
    row('Inadimplência acumulada', money(d.situacao_atual.inadimplencia));
    row('Casos na esteira agora', String(d.situacao_atual.casos_na_esteira));

    doc.moveDown(1);
    doc.fontSize(8).font('Helvetica').fillColor(MUTED)
      .text('Gerado automaticamente pelo CRM — crm.advogadaleticiabarros.com.br', 48, doc.y, { width: doc.page.width - 96, align: 'center' });

    doc.end();
  });
}
