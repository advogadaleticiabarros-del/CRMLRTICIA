/**
 * Relatório diário de intimações (pedido da Dra., 13/11/2026: "por que as
 * atualizações dos processos não chegam dessa forma para mim? De fácil
 * entendimento, com prazo correto e me dando a data final?").
 *
 * Monta, a partir das publicações do DJEN já analisadas (`prazoIntimacao.ts`):
 * - e-mail (HTML) com resumo, quadro e a análise de cada publicação;
 * - texto curto para o WhatsApp da equipe;
 * - planilha CSV (uma linha por publicação);
 * - PDF do relatório e PDF do recorte (inteiro teor, sem análise).
 *
 * Só montagem: sem banco e sem envio (ver `relatorioIntimacoesJob.ts`).
 */
import PDFDocument from 'pdfkit';
import { layout } from './EmailService';
import type { AnalisePrazo } from './prazoIntimacao';

export interface ItemRelatorio {
  movementId: number;
  numero: string;
  tribunal: string | null;
  orgao: string | null;
  classe: string | null;
  tipo: string | null;
  poloAtivo: string[];
  poloPassivo: string[];
  /** Cliente do CRM ligado ao processo, quando houver. */
  cliente: string | null;
  link: string | null;
  texto: string;
  /** "Do que se trata": resumo da IA, quando houver. */
  resumo: string | null;
  analise: AnalisePrazo;
}

export interface RelatorioIntimacoes {
  assunto: string;
  dataReferencia: string;
  oab: string;
  itens: ItemRelatorio[];
  totais: { publicacoes: number; processos: number; prazos: number; revisao: number; semPrazo: number };
  html: string;
  texto: string;
  csv: string;
}

const NAVY = '#1f3047';
const GOLD = '#c19a4e';
const br = (iso: string | null | undefined) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const umaLinha = (t: string, max = 400) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

const ROTULO: Record<AnalisePrazo['categoria'], string> = { prazo: 'PRAZO', revisao: 'REVISAR', sem_prazo: 'SEM PRAZO' };
const COR: Record<AnalisePrazo['categoria'], string> = { prazo: '#b42318', revisao: '#b54708', sem_prazo: '#475467' };
const ORDEM: Record<AnalisePrazo['categoria'], number> = { prazo: 0, revisao: 1, sem_prazo: 2 };

/** Destinatários do DJEN → polo ativo / passivo ("A"/"P"; sem polo vai para o ativo). */
export function polosDasPartes(partes: Array<{ nome?: string | null; polo?: string | null }> | null | undefined): { ativo: string[]; passivo: string[] } {
  const ativo: string[] = [], passivo: string[] = [];
  for (const p of partes || []) {
    const nome = String(p?.nome || '').trim();
    if (!nome) continue;
    (/^P/i.test(String(p?.polo || '')) ? passivo : ativo).push(nome);
  }
  return { ativo: [...new Set(ativo)], passivo: [...new Set(passivo)] };
}

function ordenar(itens: ItemRelatorio[]): ItemRelatorio[] {
  return [...itens].sort((a, b) =>
    ORDEM[a.analise.categoria] - ORDEM[b.analise.categoria]
    || String(a.analise.termoFinal || '9').localeCompare(String(b.analise.termoFinal || '9'))
    || a.movementId - b.movementId);
}

const quem = (i: ItemRelatorio) => i.cliente || i.poloAtivo[0] || i.poloPassivo[0] || '(partes não informadas)';
const prazoTexto = (a: AnalisePrazo) => a.categoria === 'prazo'
  ? `${a.dias} dias ${a.diasUteis ? 'úteis' : 'corridos'}`
  : a.categoria === 'revisao' ? 'Não identificável' : 'Sem prazo';

function csvCampo(v: unknown): string {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function montarRelatorio(entrada: ItemRelatorio[], opts: { oab: string; dataReferencia: string }): RelatorioIntimacoes {
  const itens = ordenar(entrada);
  const totais = {
    publicacoes: itens.length,
    processos: new Set(itens.map((i) => i.numero)).size,
    prazos: itens.filter((i) => i.analise.categoria === 'prazo').length,
    revisao: itens.filter((i) => i.analise.categoria === 'revisao').length,
    semPrazo: itens.filter((i) => i.analise.categoria === 'sem_prazo').length,
  };
  const dia = br(opts.dataReferencia);
  const assunto = `Intimações de ${dia} (OAB ${opts.oab}): ${totais.publicacoes} publicaç${totais.publicacoes === 1 ? 'ão' : 'ões'}, ${totais.prazos} prazo${totais.prazos === 1 ? '' : 's'}`;

  // ── WhatsApp ────────────────────────────────────────────────────────────
  const bloco = (cat: AnalisePrazo['categoria']) => itens.filter((i) => i.analise.categoria === cat);
  const linhasWpp: string[] = [`📋 *Intimações de ${dia}* (OAB ${opts.oab})`];
  if (!itens.length) {
    linhasWpp.push('', 'Nenhuma publicação nova no DJEN.');
  } else {
    linhasWpp.push(`${totais.publicacoes} publicações · ${totais.processos} processos · ${totais.prazos} prazo(s) · ${totais.revisao} para revisar`);
    if (bloco('prazo').length) {
      linhasWpp.push('', '⏰ *PRAZOS*');
      for (const i of bloco('prazo')) {
        linhasWpp.push(`• *${i.analise.ato}* — ${quem(i)}`,
          `  Proc. ${i.numero} (${[i.tribunal, i.orgao].filter(Boolean).join(' · ')})`,
          `  Data limite *${br(i.analise.termoFinal)}* · protocolar até *${br(i.analise.protocolarAte)}*`);
        for (const a of i.analise.alertas) linhasWpp.push(`  ⚠️ ${a}`);
      }
    }
    if (bloco('revisao').length) {
      linhasWpp.push('', '🔎 *PARA REVISAR* (prazo não identificável no recorte)');
      for (const i of bloco('revisao')) linhasWpp.push(`• ${quem(i)} — proc. ${i.numero}`, `  ${i.analise.providencia}`);
    }
    if (bloco('sem_prazo').length) {
      linhasWpp.push('', 'ℹ️ *SEM PRAZO* (acompanhar)');
      for (const i of bloco('sem_prazo')) linhasWpp.push(`• ${quem(i)} — proc. ${i.numero}: ${i.analise.ato}`);
    }
    linhasWpp.push('', 'Relatório completo (PDF, planilha e recorte) no e-mail. Prazos contados pelo DJEN: confira sempre o inteiro teor.');
  }
  const texto = linhasWpp.join('\n');

  // ── CSV ─────────────────────────────────────────────────────────────────
  const cab = ['Nº', 'Prioridade', 'Processo', 'Tribunal', 'Órgão', 'Classe / tipo', 'Polo ativo', 'Polo passivo', 'Cliente no CRM',
    'Disponibilização', 'Publicação', 'Do que se trata', 'Categoria', 'Providência', 'Prazo', 'Início da contagem', 'Data limite', 'Protocolar até',
    'Fundamento', 'Alertas', 'Como contamos', 'Link'];
  const linhasCsv = [cab.join(';')];
  itens.forEach((i, k) => {
    const a = i.analise;
    linhasCsv.push([k + 1, a.prioridade.toUpperCase(), i.numero, i.tribunal, i.orgao, [i.classe, i.tipo].filter(Boolean).join(' | '),
      i.poloAtivo.join('; '), i.poloPassivo.join('; '), i.cliente, br(a.disponibilizacao), br(a.publicacao), umaLinha(i.resumo || i.texto, 300),
      ROTULO[a.categoria], a.providencia, prazoTexto(a), br(a.inicioContagem), br(a.termoFinal), br(a.protocolarAte), a.fundamento,
      a.alertas.join(' '), a.explicacao, i.link].map(csvCampo).join(';'));
  });
  const csv = '﻿' + linhasCsv.join('\r\n') + '\r\n';

  // ── E-mail ──────────────────────────────────────────────────────────────
  const tile = (n: number, rot: string) => `<td style="border:1px solid #e2ddd1;padding:10px;width:25%;vertical-align:top"><div style="font-size:22px;font-weight:700;color:${NAVY}">${n}</div><div style="font-size:10px;color:#667085;letter-spacing:.5px">${rot}</div></td>`;
  const badge = (a: AnalisePrazo) => `<span style="display:inline-block;background:${COR[a.categoria]};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px">${ROTULO[a.categoria]}</span>`;
  const campo = (rot: string, val: string) => val ? `<div style="margin-top:8px"><div style="font-size:10px;color:#667085;font-weight:700;letter-spacing:.5px">${rot}</div><div style="font-size:13px;line-height:1.45">${val}</div></div>` : '';
  const quadro = itens.length ? `
    <table role="presentation" width="100%" style="border-collapse:collapse;font-size:12px;margin:8px 0 18px">
      <tr style="background:#f4f1ea;text-align:left"><th style="padding:6px">Situação</th><th style="padding:6px">Processo</th><th style="padding:6px">O que fazer</th><th style="padding:6px">Data limite</th></tr>
      ${itens.map((i) => `<tr style="border-top:1px solid #eee"><td style="padding:6px">${badge(i.analise)}</td><td style="padding:6px;font-family:monospace;font-size:11px">${esc(i.numero)}<br><span style="font-family:Arial;color:#667085">${esc(i.tribunal || '')}</span></td><td style="padding:6px">${esc(i.analise.ato)}<br><span style="color:#667085">${esc(quem(i))}</span></td><td style="padding:6px;font-weight:700">${i.analise.termoFinal ? `${br(i.analise.termoFinal)}<br><span style="font-weight:400;color:#667085">protocolar até ${br(i.analise.protocolarAte)}</span>` : '—'}</td></tr>`).join('')}
    </table>` : '<p>Nenhuma publicação nova no DJEN.</p>';
  const cards = itens.map((i, k) => {
    const a = i.analise;
    return `<div style="border:1px solid #e2ddd1;border-left:4px solid ${COR[a.categoria]};border-radius:6px;padding:14px;margin:0 0 14px">
      <div style="font-size:11px;color:#667085">${String(k + 1).padStart(2, '0')} ${badge(a)}</div>
      <div style="font-family:monospace;font-size:14px;font-weight:700;color:${NAVY};margin-top:4px">${esc(i.numero)}</div>
      <div style="font-size:11px;color:#667085">${esc([i.tribunal, i.orgao].filter(Boolean).join(' · '))}<br>${esc([i.classe, i.tipo].filter(Boolean).join(' | '))}</div>
      ${campo('POLO ATIVO', esc(i.poloAtivo.join('; ') || '(não informado no recorte)'))}
      ${campo('POLO PASSIVO', esc(i.poloPassivo.join('; ') || '(não informado no recorte)'))}
      ${i.cliente ? campo('CLIENTE NO CRM', esc(i.cliente)) : campo('CLIENTE NO CRM', '<span style="color:#b54708">processo ainda sem cliente vinculado</span>')}
      ${campo('DO QUE SE TRATA', esc(i.resumo || umaLinha(i.texto, 350)))}
      ${campo('PROVIDÊNCIA', esc(a.providencia))}
      <table role="presentation" style="margin-top:10px;font-size:12px;border-collapse:collapse"><tr>
        <td style="padding-right:18px"><div style="font-size:10px;color:#667085;font-weight:700">PUBLICAÇÃO</div>${br(a.publicacao)}</td>
        <td style="padding-right:18px"><div style="font-size:10px;color:#667085;font-weight:700">PRAZO</div>${esc(prazoTexto(a))}</td>
        <td style="padding-right:18px"><div style="font-size:10px;color:#667085;font-weight:700">DATA LIMITE</div><strong>${a.termoFinal ? br(a.termoFinal) : 'REVISÃO HUMANA'}</strong></td>
        ${a.protocolarAte ? `<td><div style="font-size:10px;color:#667085;font-weight:700">PROTOCOLAR ATÉ</div><strong style="color:${COR.prazo}">${br(a.protocolarAte)}</strong></td>` : ''}
      </tr></table>
      ${a.alertas.map((t) => `<div style="margin-top:8px;font-size:12px;color:#b54708">⚠ ${esc(t)}</div>`).join('')}
      <div style="margin-top:8px;font-size:11px;color:#667085;line-height:1.4">${esc(a.explicacao)}</div>
      ${i.link ? `<div style="margin-top:8px;font-size:12px"><a href="${esc(i.link)}" style="color:${NAVY}">Ver a publicação no tribunal</a></div>` : ''}
    </div>`;
  }).join('');
  const html = layout(`Intimações de ${dia}`, `
    <p style="margin:0 0 12px;color:#667085;font-size:12px">OAB ${esc(opts.oab)} · publicações capturadas no DJEN</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:14px"><tr>
      ${tile(totais.publicacoes, 'PUBLICAÇÕES')}${tile(totais.processos, 'PROCESSOS')}${tile(totais.prazos, 'PRAZOS')}${tile(totais.revisao, 'PARA REVISAR')}
    </tr></table>
    ${quadro}
    ${itens.length ? `<h2 style="font-family:Georgia,serif;font-size:16px;color:${NAVY};margin:6px 0 10px">Análise de cada publicação</h2>${cards}` : ''}
    ${itens.length ? `<p style="font-size:12px;color:#667085">Anexos: relatório em PDF, planilha (CSV) para o Excel e recorte com o inteiro teor.</p>` : ''}
    <p style="font-size:11px;color:#9a9284;border-top:1px solid #eee;padding-top:10px">Data limite pela regra legal: publicação no 1º dia útil após a disponibilização no DJEN e contagem a partir do dia útil seguinte (Lei 11.419/2006, art. 4º; CPC, art. 224). "Protocolar até" é um dia útil antes, por segurança. Feriados municipais e suspensões do tribunal não entram na conta: confira sempre o inteiro teor e o calendário do tribunal.</p>
    <p style="font-size:11px;color:${GOLD}">Os prazos são calculados por regra fixa do CRM, não pela IA.</p>`);

  return { assunto, dataReferencia: opts.dataReferencia, oab: opts.oab, itens, totais, html, texto, csv };
}

// ── PDF ───────────────────────────────────────────────────────────────────
// Helvetica/Times do pdfkit usam WinAnsi: acentos, º, ª e § saem certos;
// símbolos fora disso (setas, emojis) são trocados antes de escrever.
const PDF_EXTRAS = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022]);
const pdfSeguro = (t: unknown) => Array.from(String(t ?? '')).map((ch) => {
  const c = ch.codePointAt(0) || 0;
  if (c === 0x2192 || c === 0x21D2) return '->';
  if (c === 0x2026) return '...';
  if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || PDF_EXTRAS.has(c)) return ch;
  return '';
}).join('');

function novoPdf(titulo: string, desenhar: (doc: PDFKit.PDFDocument, W: number, M: number) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const M = 42;
    const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: M, left: M, right: M }, bufferPages: true, info: { Title: titulo } });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const W = doc.page.width - 2 * M;
    desenhar(doc, W, M);
    const r = doc.bufferedPageRange();
    for (let p = r.start; p < r.start + r.count; p++) {
      doc.switchToPage(p);
      // Escrever abaixo da margem faz o pdfkit abrir página nova (em branco).
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#9a9284')
        .text(`Letícia Barros Advocacia · página ${p + 1} de ${r.count}`, M, doc.page.height - M + 12, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

export function pdfRelatorio(rel: RelatorioIntimacoes): Promise<Buffer> {
  return novoPdf(rel.assunto, (doc, W, M) => {
    const fim = () => doc.page.height - M - 20;
    const garantir = (alt: number) => { if (doc.y + alt > fim()) doc.addPage(); };
    doc.font('Times-Bold').fontSize(16).fillColor(NAVY).text(pdfSeguro(`Relatório de intimações — ${br(rel.dataReferencia)}`), M, M, { width: W });
    doc.font('Helvetica').fontSize(9).fillColor('#667085')
      .text(pdfSeguro(`OAB ${rel.oab} · ${rel.totais.publicacoes} publicações · ${rel.totais.processos} processos · ${rel.totais.prazos} prazo(s) · ${rel.totais.revisao} para revisar · ${rel.totais.semPrazo} sem prazo`), { width: W });
    doc.moveDown(0.6);
    if (!rel.itens.length) { doc.font('Helvetica').fontSize(11).fillColor('#232323').text('Nenhuma publicação nova no DJEN.'); return; }
    rel.itens.forEach((i, k) => {
      const a = i.analise;
      garantir(140);
      const y0 = doc.y;
      doc.rect(M, y0, 3, 12).fill(COR[a.categoria]);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COR[a.categoria]).text(`${String(k + 1).padStart(2, '0')}  ${ROTULO[a.categoria]}`, M + 8, y0 + 1, { width: W - 8 });
      doc.font('Courier-Bold').fontSize(11).fillColor(NAVY).text(i.numero, M, doc.y + 2, { width: W });
      doc.font('Helvetica').fontSize(8).fillColor('#667085').text(pdfSeguro([i.tribunal, i.orgao, i.classe, i.tipo].filter(Boolean).join(' · ')), { width: W });
      const linha = (rot: string, val: string) => {
        if (!val) return;
        garantir(30);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#667085').text(rot, M, doc.y + 4, { width: W });
        doc.font('Helvetica').fontSize(9.5).fillColor('#232323').text(pdfSeguro(val), { width: W });
      };
      linha('POLO ATIVO', i.poloAtivo.join('; ') || '(não informado no recorte)');
      linha('POLO PASSIVO', i.poloPassivo.join('; ') || '(não informado no recorte)');
      linha('CLIENTE NO CRM', i.cliente || 'processo ainda sem cliente vinculado');
      linha('DO QUE SE TRATA', i.resumo || umaLinha(i.texto, 400));
      linha('PROVIDÊNCIA', a.providencia);
      linha('PRAZO', a.categoria === 'prazo'
        ? `${a.ato}: ${prazoTexto(a)} · publicação ${br(a.publicacao)} · DATA LIMITE ${br(a.termoFinal)} · PROTOCOLAR ATÉ ${br(a.protocolarAte)}`
        : `${prazoTexto(a)} · publicação ${br(a.publicacao)}${a.categoria === 'revisao' ? ' · REVISÃO HUMANA' : ''}`);
      for (const t of a.alertas) linha('ALERTA', t);
      garantir(30);
      doc.font('Helvetica').fontSize(7.5).fillColor('#667085').text(pdfSeguro(a.explicacao), M, doc.y + 4, { width: W });
      if (i.link) doc.fillColor(NAVY).text('Ver a publicação no tribunal', { width: W, link: i.link, underline: true });
      doc.moveDown(0.4);
      doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor('#e2ddd1').lineWidth(0.5).stroke();
      doc.moveDown(0.6);
    });
  });
}

/** Recorte: o inteiro teor de cada publicação, sem análise. */
export function pdfRecorte(rel: RelatorioIntimacoes): Promise<Buffer> {
  return novoPdf(`Recorte — ${br(rel.dataReferencia)}`, (doc, W, M) => {
    doc.font('Times-Bold').fontSize(15).fillColor(NAVY).text(pdfSeguro(`Publicações da OAB ${rel.oab}`), M, M, { width: W });
    doc.font('Helvetica').fontSize(9).fillColor('#667085').text(pdfSeguro(`${rel.totais.publicacoes} publicações · gerado pelo CRM em ${br(rel.dataReferencia)} · inteiro teor, sem análise`), { width: W });
    doc.moveDown(0.8);
    rel.itens.forEach((i, k) => {
      if (k > 0) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY)
        .text(pdfSeguro(`${k + 1}. ${i.tribunal || ''} · disponibilizada em ${br(i.analise.disponibilizacao)}`), M, doc.y, { width: W });
      doc.font('Courier-Bold').fontSize(11).text(i.numero, { width: W });
      doc.font('Helvetica').fontSize(8).fillColor('#667085').text(pdfSeguro([i.orgao, i.classe, i.tipo].filter(Boolean).join(' · ')), { width: W });
      if (i.link) doc.fillColor(NAVY).text('Link da publicação', { width: W, link: i.link, underline: true });
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(9).fillColor('#232323').text(pdfSeguro(i.texto || '(sem texto)'), { width: W, align: 'justify' });
    });
  });
}
