import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { ExecutiveReportData } from './executiveReport';
import { Narrative, delta, Delta } from './executiveReportNarrative';

// ── Identidade visual — mesma paleta do papel timbrado usado nos documentos
// (printBranded/docTableHtml em public/app.js): navy + dourado, serif pro
// título, sans pro corpo. Mantém o relatório consistente com o resto do CRM.
const NAVY = '#1f3047';
const GOLD = '#c19a4e';
const GOLD_SOFT = '#f2ead3';
const INK = '#232323';
const MUTED = '#6b6252';
const LINE = '#e2ddd1';
const GREEN = '#1c7a3d';
const RED = '#c0392b';
const NAVY_SOFT = '#eef1f6';

const LOGO_PATH = path.join(__dirname, '..', '..', 'public', 'logo.png');

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
const hojeExtenso = () => {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const d = new Date();
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
};

const PAGE_MARGIN = 48;

/** Gera o PDF elegante do Relatório Executivo mensal — papel timbrado da marca. */
export function buildExecutiveReportPdf(d: ExecutiveReportData, prev: ExecutiveReportData | null, narrative: Narrative): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 108, bottom: 60, left: PAGE_MARGIN, right: PAGE_MARGIN }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const contentW = pageW - PAGE_MARGIN * 2;
    const hasLogo = fs.existsSync(LOGO_PATH);

    // ── Cabeçalho (papel timbrado) — repetido em toda página nova ────────────
    const drawHeader = () => {
      const top = 40;
      if (hasLogo) { try { doc.image(LOGO_PATH, PAGE_MARGIN, top, { width: 34, height: 34 }); } catch { /* segue sem logo */ } }
      const tx = hasLogo ? PAGE_MARGIN + 44 : PAGE_MARGIN;
      doc.font('Times-Bold').fontSize(16).fillColor(NAVY).text('Letícia Barros', tx, top - 2, { lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor(GOLD).text('ADVOCACIA & CONSULTORIA', tx, top + 17, { characterSpacing: 1.4, lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Relatório Executivo — ${mesLabel(d.month)}`, PAGE_MARGIN, top + 3, { width: contentW, align: 'right', lineBreak: false });
      doc.moveTo(PAGE_MARGIN, top + 40).lineTo(pageW - PAGE_MARGIN, top + 40).lineWidth(1.4).strokeColor(GOLD).stroke();
      doc.y = top + 54;
    };
    doc.on('pageAdded', drawHeader);
    drawHeader();

    // ── Helpers de layout ─────────────────────────────────────────────────
    const ensureSpace = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };
    const sectionTitle = (t: string) => {
      ensureSpace(30);
      doc.moveDown(0.9);
      const y = doc.y;
      doc.rect(PAGE_MARGIN, y + 2, 3, 12).fill(GOLD);
      doc.font('Times-Bold').fontSize(12.5).fillColor(NAVY).text(t, PAGE_MARGIN + 10, y);
      doc.moveDown(0.35);
    };
    const row = (label: string, value: string, bold = false) => {
      ensureSpace(16);
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? NAVY : INK);
      doc.text(label, PAGE_MARGIN, y, { width: contentW - 160 });
      doc.text(value, PAGE_MARGIN, y, { width: contentW, align: 'right' });
      doc.moveDown(0.32);
    };
    const divider = (color = LINE) => { doc.moveDown(0.1); doc.moveTo(PAGE_MARGIN, doc.y).lineTo(pageW - PAGE_MARGIN, doc.y).lineWidth(0.7).strokeColor(color).stroke(); doc.moveDown(0.25); };
    const deltaTag = (dl: Delta | null): { text: string; color: string } => {
      if (!dl || dl.pct === null) return { text: '', color: MUTED };
      return { text: `${dl.alta ? '▲' : '▼'} ${Math.abs(dl.pct)}%`, color: dl.alta ? GREEN : RED };
    };

    // ── Resumo do mês ─────────────────────────────────────────────────────
    ensureSpace(70);
    const boxY = doc.y;
    const innerW = contentW - 32;
    const resumoH = doc.font('Helvetica').fontSize(9.8).heightOfString(narrative.resumo, { width: innerW, lineGap: 2.5 });
    const destH = narrative.destaques.reduce((s, t) => s + doc.font('Helvetica').fontSize(9).heightOfString(t, { width: innerW - 14, lineGap: 1 }) + 6, 0);
    const boxH = 26 + resumoH + 14 + destH + 10;
    doc.roundedRect(PAGE_MARGIN, boxY, contentW, boxH, 6).fill(NAVY_SOFT);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text('RESUMO DO MÊS', PAGE_MARGIN + 16, boxY + 12, { characterSpacing: 1 });
    doc.font('Helvetica').fontSize(9.8).fillColor(NAVY)
      .text(narrative.resumo, PAGE_MARGIN + 16, boxY + 26, { width: innerW, lineGap: 2.5 });
    doc.moveTo(PAGE_MARGIN + 16, doc.y + 6).lineTo(PAGE_MARGIN + contentW - 16, doc.y + 6).lineWidth(0.6).strokeColor('#d7dde6').stroke();
    let desY = doc.y + 16;
    for (const t of narrative.destaques) {
      doc.circle(PAGE_MARGIN + 21, desY + 4, 1.6).fill(GOLD);
      doc.font('Helvetica').fontSize(9).fillColor(NAVY).text(t, PAGE_MARGIN + 30, desY, { width: innerW - 14, lineGap: 1 });
      desY = doc.y + 6;
    }
    doc.y = boxY + boxH + 14;

    // ── KPIs em destaque (com variação vs. mês anterior) ─────────────────────
    const kpis: { label: string; value: string; dl: Delta | null }[] = [
      { label: 'Receita total', value: money(d.receita_total), dl: prev ? delta(d.receita_total, prev.receita_total) : null },
      { label: 'Resultado do mês', value: money(d.resultado), dl: prev ? delta(d.resultado, prev.resultado) : null },
      { label: 'Processos protocolados', value: String(d.processos.total_protocolados), dl: prev ? delta(d.processos.total_protocolados, prev.processos.total_protocolados) : null },
      { label: 'Leads novos', value: String(d.funil.leads_novos), dl: prev ? delta(d.funil.leads_novos, prev.funil.leads_novos) : null },
    ];
    ensureSpace(64);
    const kpiY = doc.y;
    const kpiW = (contentW - 3 * 10) / 4;
    kpis.forEach((k, i) => {
      const x = PAGE_MARGIN + i * (kpiW + 10);
      doc.roundedRect(x, kpiY, kpiW, 56, 5).lineWidth(1).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(k.label.toUpperCase(), x + 10, kpiY + 9, { width: kpiW - 20, characterSpacing: 0.3 });
      doc.font('Times-Bold').fontSize(14).fillColor(NAVY).text(k.value, x + 10, kpiY + 22, { width: kpiW - 20 });
      const tag = deltaTag(k.dl);
      if (tag.text) doc.font('Helvetica-Bold').fontSize(8).fillColor(tag.color).text(tag.text, x + 10, kpiY + 41, { width: kpiW - 20 });
    });
    doc.y = kpiY + 56 + 8;
    if (prev) { doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED).text(`Variação em relação a ${mesLabel(prev.month)}`, PAGE_MARGIN, doc.y); doc.moveDown(0.3); }

    // ── Receita por frente (gráfico de barras) ───────────────────────────────
    sectionTitle('Receita recebida por frente');
    const fontes = [
      { label: 'Clientes & contratos', v: d.receitas.clientes },
      { label: 'Parcerias', v: d.receitas.parcerias },
      { label: 'Dativo (Estado)', v: d.receitas.dativo },
      { label: 'Correspondente', v: d.receitas.correspondente },
      { label: 'Êxitos (RPV/alvará)', v: d.receitas.exitos },
    ].sort((a, b) => b.v - a.v);
    const maxV = Math.max(1, ...fontes.map((f) => f.v));
    const barLabelW = 155, barValW = 90, barTrackW = contentW - barLabelW - barValW - 10;
    for (const f of fontes) {
      ensureSpace(18);
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(f.label, PAGE_MARGIN, y + 2, { width: barLabelW });
      doc.roundedRect(PAGE_MARGIN + barLabelW, y, barTrackW, 9, 3).fill('#f0ece0');
      const w = Math.max(3, Math.round((f.v / maxV) * barTrackW));
      if (f.v > 0) doc.roundedRect(PAGE_MARGIN + barLabelW, y, w, 9, 3).fill(GOLD);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(money(f.v), PAGE_MARGIN + barLabelW + barTrackW + 8, y + 1, { width: barValW, align: 'right' });
      doc.y = y + 17;
    }
    divider();
    row('RECEITA TOTAL', money(d.receita_total), true);

    // ── Saídas ────────────────────────────────────────────────────────────
    sectionTitle('Saídas pagas');
    row('Despesas', money(d.saidas.despesas));
    row('Repasses a parceiros', money(d.saidas.repasses));
    divider();
    row('TOTAL DE SAÍDAS', money(d.saidas.total), true);

    // ── Resultado em destaque ─────────────────────────────────────────────
    ensureSpace(46);
    doc.moveDown(0.4);
    const ry = doc.y;
    doc.roundedRect(PAGE_MARGIN, ry, contentW, 34, 6).lineWidth(1.4).strokeColor(NAVY).stroke();
    doc.font('Times-Bold').fontSize(12).fillColor(NAVY).text('RESULTADO DO MÊS', PAGE_MARGIN + 14, ry + 10);
    doc.fillColor(d.resultado >= 0 ? GREEN : RED).text(money(d.resultado), PAGE_MARGIN, ry + 10, { width: contentW - 14, align: 'right' });
    doc.y = ry + 44;

    // ── Volume de trabalho: processos protocolados ───────────────────────
    sectionTitle(`Processos protocolados no mês (${d.processos.total_protocolados})`);
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
      .text(`${d.processos.proprios} próprio(s) · ${d.processos.parcerias} de parceria`);
    doc.moveDown(0.35);
    if (d.processos.protocolados.length) {
      const colX = [PAGE_MARGIN, PAGE_MARGIN + 140, PAGE_MARGIN + 292, PAGE_MARGIN + 382, PAGE_MARGIN + 452];
      ensureSpace(20);
      const hy = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY);
      doc.text('Nº DO PROCESSO', colX[0], hy, { width: 138 });
      doc.text('CLIENTE', colX[1], hy, { width: 148 });
      doc.text('ÁREA', colX[2], hy, { width: 86 });
      doc.text('TIPO', colX[3], hy, { width: 66 });
      doc.text('DATA', colX[4], hy, { width: 47 });
      doc.moveDown(0.4);
      divider(GOLD);
      doc.font('Helvetica').fontSize(9).fillColor(INK);
      for (const p of d.processos.protocolados) {
        ensureSpace(16);
        const y0 = doc.y;
        doc.text(p.case_number || '—', colX[0], y0, { width: 138 });
        doc.text(p.client_name, colX[1], y0, { width: 148 });
        doc.text(AREA_PT[p.legal_area] || p.legal_area, colX[2], y0, { width: 86 });
        doc.fillColor(p.tipo === 'parceria' ? GOLD : GREEN).font('Helvetica-Bold').fontSize(8.5)
          .text(p.tipo === 'parceria' ? 'PARCERIA' : 'PRÓPRIO', colX[3], y0, { width: 66 });
        doc.fillColor(INK).font('Helvetica').fontSize(9).text(p.data, colX[4], y0, { width: 47 });
        doc.y = y0 + 15;
      }
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Nenhum processo protocolado neste mês.');
    }

    // ── Movimentação processual ───────────────────────────────────────────
    sectionTitle('Movimentação processual (DJEN)');
    row('Movimentações recebidas no mês', String(d.processos.movimentacoes_total));
    row('Processos com movimentação', String(d.processos.processos_com_movimentacao));

    // ── Agenda + Funil comercial + Produção (lado a lado) ────────────────
    sectionTitle('Agenda, funil comercial e produção');
    ensureSpace(120);
    const colW = (contentW - 24) / 3;
    const cols = [PAGE_MARGIN, PAGE_MARGIN + colW + 12, PAGE_MARGIN + (colW + 12) * 2];
    const topY = doc.y;
    const miniCol = (x: number, title: string, lines: [string, string][]) => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD).text(title.toUpperCase(), x, topY, { width: colW, characterSpacing: 0.4 });
      let y = topY + 14;
      for (const [l, v] of lines) {
        doc.font('Helvetica').fontSize(8.7).fillColor(MUTED).text(l, x, y, { width: colW });
        doc.font('Helvetica-Bold').fontSize(9.3).fillColor(NAVY).text(v, x, y + 11, { width: colW });
        y += 30;
      }
      return y;
    };
    const yA = miniCol(cols[0], `Agenda (${d.agenda.compromissos_total})`,
      d.agenda.por_tipo.length ? d.agenda.por_tipo.map((t) => [AGENDA_PT[t.tipo] || t.tipo, String(t.total)] as [string, string]) : [['Sem compromissos', '—']]);
    const yB = miniCol(cols[1], 'Funil comercial', [
      ['Leads novos', String(d.funil.leads_novos)],
      ['Contratos fechados', String(d.funil.leads_fechados)],
      ['Conversão', `${d.funil.conversao_pct}%`],
      ['Propostas criadas · aceitas', `${d.funil.propostas_criadas} · ${d.funil.propostas_aceitas}`],
    ]);
    const yC = miniCol(cols[2], 'Produção', [
      ['Protocolados no mês', String(d.producao.protocolados)],
      ['Entraram na esteira', String(d.producao.entraram_esteira)],
      ['Recusados após análise', String(d.producao.recusados)],
    ]);
    doc.y = Math.max(yA, yB, yC) + 4;

    // ── Situação atual ─────────────────────────────────────────────────────
    sectionTitle(`Situação em ${hojeExtenso()}`);
    row('Inadimplência acumulada', money(d.situacao_atual.inadimplencia));
    row('Casos na esteira agora', String(d.situacao_atual.casos_na_esteira));

    // ── Dicas & recomendações ────────────────────────────────────────────
    sectionTitle('Dicas & recomendações');
    ensureSpace(20 + narrative.dicas.length * 26);
    const dY = doc.y;
    let dH = 12;
    doc.font('Helvetica').fontSize(9.3).fillColor(NAVY);
    for (const t of narrative.dicas) {
      const lh = doc.heightOfString(t, { width: contentW - 34 });
      dH += lh + 10;
    }
    doc.save().roundedRect(PAGE_MARGIN, dY, contentW, dH, 6).fill(GOLD_SOFT).restore();
    let ty = dY + 10;
    for (const t of narrative.dicas) {
      doc.circle(PAGE_MARGIN + 14, ty + 5, 2).fill(GOLD);
      doc.font('Helvetica').fontSize(9.3).fillColor('#4a3d1d').text(t, PAGE_MARGIN + 24, ty, { width: contentW - 34, lineGap: 1.5 });
      ty = doc.y + 8;
    }
    doc.y = dY + dH + 10;

    // ── Rodapé (todas as páginas) ─────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - 42;
      doc.moveTo(PAGE_MARGIN, fy).lineTo(pageW - PAGE_MARGIN, fy).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(7.6).fillColor(MUTED)
        .text(`Documento gerado em ${hojeExtenso()}`, PAGE_MARGIN, fy + 8, { width: contentW / 2, lineBreak: false });
      doc.text('Advocacia Letícia Barros', PAGE_MARGIN, fy + 8, { width: contentW, align: 'right', lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, PAGE_MARGIN, fy + 8, { width: contentW, align: 'center', lineBreak: false });
    }

    doc.end();
  });
}
