import PDFDocument from 'pdfkit';
import { brl, mesBr, r2, type CalculoPeca } from './pecaCalculos';
import { chaveContrato, nomeDoTipo } from './contratosDoCaso';
import type { CabecalhoPlanilha } from './planilhaCalculos';
import type { ContratoFicha } from './pecaDossie';

/**
 * Demonstrativo de descontos (pedido da Jessica, 30/10/2026): documento à parte, por
 * peça, que separa do extrato do INSS só o que é desta ação — cada contrato do réu
 * (nº, RMC/RCC/empréstimo, banco, inclusão), o que já foi descontado mês a mês, com a
 * fonte de cada linha, e a composição do valor da causa. O extrato original continua
 * indo inteiro no protocolo; o demonstrativo é a demonstração individual e a base do
 * cálculo (o detalhe com correção e juros fica na Planilha de cálculos).
 *
 * Entra o mesmo cálculo da peça (CalculoPeca) e os contratos que entraram nela
 * (separarParaPeca), então demonstrativo, planilha e petição sempre batem.
 * Saídas: demonstrativoMarkdown (tela) e demonstrativoPdf (anexo do kit).
 * Testes em tests/demonstrativoDescontos.test.mjs.
 */

export interface LinhaDemonstrativo { competencia: string; valor: number; fonte: string | null }
export interface ContratoDemonstrativo {
  numero: string | null; tipo: string | null; nomeTipo: string; banco: string | null;
  inclusao: string | null; situacao: string | null;
  meses: number; periodo: string | null; descontado: number; linhas: LinhaDemonstrativo[];
}
export interface Demonstrativo {
  cliente: string; reus: string[]; casos: Array<{ id: number; titulo: string | null }>; geradoEm: Date;
  contratos: ContratoDemonstrativo[];
  totalDescontado: number; totalMeses: number;
  valorDaCausa: {
    restituirNominal: number; restituicao: number; atualizadoAte: string | null;
    jurosPagosAMais: number; danoMoral: number | null; total: number;
  };
  fora: Array<{ numero: string | null; nomeTipo: string; banco: string | null; motivo: string }>;
  avisos: string[];
}

const NOTA_ORIGINAL = 'Os valores foram extraídos do extrato original do INSS (histórico de créditos e extrato de empréstimos consignados), juntado na íntegra a esta petição. A coluna "Fonte" indica o documento de onde saiu cada desconto.';

export function montarDemonstrativo(e: {
  calculo: CalculoPeca; contratos: ContratoFicha[];
  fora?: Array<{ contrato: ContratoFicha; motivo: string }>; cab: CabecalhoPlanilha;
}): Demonstrativo {
  const avisos: string[] = [];
  const grupos = new Map<string, ContratoDemonstrativo>();
  const novo = (c: ContratoFicha | null): ContratoDemonstrativo => ({
    numero: c?.numero ?? null, tipo: c?.tipo ?? null, nomeTipo: c ? nomeDoTipo(c.tipo) : 'Contrato não identificado',
    banco: c?.banco ?? null, inclusao: c?.data ?? null, situacao: c?.situacao ?? null,
    meses: 0, periodo: null, descontado: 0, linhas: [],
  });
  for (const c of e.contratos) {
    const k = chaveContrato(c);
    if (!grupos.has(k)) grupos.set(k, novo(c));
  }
  const SEM = 's:sem-contrato';
  let semNumero = 0;
  for (const d of e.calculo.descontos) {
    // O cálculo marca "sem número" (ou o tipo) quando o extrato não traz o nº: só vale nº com algarismo.
    const numero = /\d/.test(String(d.contrato || '')) ? String(d.contrato) : null;
    const nomeado = numero ? chaveContrato({ numero, tipo: null, banco: null, data: null }) : '';
    let k = nomeado && grupos.has(nomeado) ? nomeado : '';
    // Só um contrato na peça: o desconto sem número é dele.
    if (!k && !numero && e.contratos.length === 1) k = chaveContrato(e.contratos[0]);
    if (!k && nomeado) {
      grupos.set(nomeado, { ...novo(null), numero });
      k = nomeado;
    }
    if (!k) { k = SEM; semNumero++; if (!grupos.has(SEM)) grupos.set(SEM, novo(null)); }
    grupos.get(k)!.linhas.push({ competencia: d.competencia, valor: d.valor, fonte: d.fonte ?? null });
  }
  if (semNumero) avisos.push(`${semNumero} desconto(s) sem o número do contrato no extrato: conferir a qual contrato pertencem.`);

  const contratos = [...grupos.entries()]
    .sort(([a], [b]) => Number(a === SEM) - Number(b === SEM))
    .map(([, g]) => {
      const linhas = [...g.linhas].sort((x, y) => x.competencia.localeCompare(y.competencia));
      const descontado = r2(linhas.reduce((s, l) => s + l.valor, 0));
      const periodo = linhas.length ? `${mesBr(linhas[0].competencia)} a ${mesBr(linhas[linhas.length - 1].competencia)}` : null;
      if (!linhas.length) avisos.push(`Contrato ${g.numero || 's/nº'} (${g.nomeTipo}): nenhum desconto lido nos extratos. Conferir o histórico de créditos.`);
      return { ...g, linhas, meses: linhas.length, descontado, periodo };
    });

  const v = e.calculo.valorDaCausa;
  const a = e.calculo.atualizacao;
  const restituirNominal = e.calculo.indebito.total.restituir;
  return {
    cliente: e.cab.cliente, reus: e.cab.reus || [], casos: e.cab.casos || [], geradoEm: e.cab.geradaEm || new Date(),
    contratos,
    totalDescontado: r2(contratos.reduce((s, c) => s + c.descontado, 0)),
    totalMeses: contratos.reduce((s, c) => s + c.meses, 0),
    valorDaCausa: {
      restituirNominal, restituicao: a ? a.total.total : restituirNominal, atualizadoAte: a?.dataBase ?? null,
      jurosPagosAMais: v.jurosPagosAMais, danoMoral: v.danoMoral, total: v.total,
    },
    fora: (e.fora || []).map((f) => ({ numero: f.contrato.numero, nomeTipo: nomeDoTipo(f.contrato.tipo), banco: f.contrato.banco, motivo: f.motivo })),
    avisos,
  };
}

// ── saídas ──────────────────────────────────────────────────────────────────

const ou = (s: string | null | undefined, vazio = '—') => (s && String(s).trim()) || vazio;

function linhasValorDaCausa(d: Demonstrativo): Array<[string, string]> {
  const v = d.valorDaCausa;
  const l: Array<[string, string]> = [
    ['Total descontado até agora (valor nominal)', brl(d.totalDescontado)],
    ['A restituir (simples até 03/2021; em dobro a partir de 04/2021)', brl(v.restituirNominal)],
  ];
  if (v.atualizadoAte) l.push([`Restituição atualizada até ${mesBr(v.atualizadoAte)} (correção e juros — ver Planilha de cálculos)`, brl(v.restituicao)]);
  if (v.jurosPagosAMais) l.push(['Juros pagos a mais (revisão da taxa)', brl(v.jurosPagosAMais)]);
  l.push(['Dano moral', v.danoMoral != null ? brl(v.danoMoral) : '[a definir]']);
  l.push([`Valor da causa${v.danoMoral == null ? ' (somar o dano moral)' : ''}`, brl(v.total)]);
  return l;
}

/** Tabela para ler no CRM (Mesa do caso → Cálculos). */
export function demonstrativoMarkdown(d: Demonstrativo): string {
  const l: string[] = [`# Demonstrativo de descontos — ${d.cliente}`, ''];
  l.push(`Gerado em ${d.geradoEm.toLocaleDateString('pt-BR')}`);
  if (d.reus.length) l.push('', `Réu: ${d.reus.join('; ')}`);
  if (!d.contratos.length) return [...l, '', 'Nenhum desconto lido nos extratos desta peça: não há o que demonstrar.'].join('\n');

  l.push('', '## Contratos desta peça', '', '| Contrato | Tipo | Banco | Inclusão | Situação | Descontos | Período | Total descontado |', '|---|---|---|---|---|---|---|---|');
  for (const c of d.contratos) l.push(`| ${ou(c.numero, 's/nº')} | ${c.nomeTipo} | ${ou(c.banco)} | ${ou(c.inclusao)} | ${ou(c.situacao)} | ${c.meses} | ${ou(c.periodo)} | ${brl(c.descontado)} |`);
  l.push(`| **Total descontado até agora** | | | | | ${d.totalMeses} | | **${brl(d.totalDescontado)}** |`);

  l.push('', '## Descontos mês a mês', '', '| Competência | Contrato | Valor descontado | Fonte |', '|---|---|---|---|');
  for (const c of d.contratos) for (const x of c.linhas) l.push(`| ${mesBr(x.competencia)} | ${ou(c.numero, 's/nº')} | ${brl(x.valor)} | ${ou(x.fonte)} |`);

  l.push('', '## Valor da causa', '', ...linhasValorDaCausa(d).map(([k, v]) => `- ${k}: **${v}**`));
  if (d.fora.length) {
    l.push('', '## Ficaram fora desta peça', '', '| Contrato | Tipo | Banco | Motivo |', '|---|---|---|---|');
    for (const f of d.fora) l.push(`| ${ou(f.numero, 's/nº')} | ${f.nomeTipo} | ${ou(f.banco)} | ${f.motivo} |`);
  }
  if (d.avisos.length) l.push('', '## A conferir', '', ...d.avisos.map((x) => `- ${x}`));
  l.push('', `_${NOTA_ORIGINAL}_`);
  return l.join('\n');
}

const NAVY = '#1f3047', GOLD = '#c19a4e', INK = '#232323', MUTED = '#6b6252', LINE = '#e2ddd1', SOFT = '#f4f1ea';

/** PDF para anexar à petição (vai no kit da ação). Não traz a lista "ficaram fora" nem os avisos: é peça de protocolo. */
export function demonstrativoPdf(d: Demonstrativo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const M = 48;
    const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: M, left: M, right: M }, bufferPages: true, info: { Title: `Demonstrativo de descontos — ${d.cliente}` } });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const W = doc.page.width - M * 2;
    const fimDaPagina = () => doc.page.height - M - 20;

    doc.font('Times-Bold').fontSize(15).fillColor(NAVY).text('DEMONSTRATIVO DE DESCONTOS', M, M, { width: W });
    doc.moveTo(M, doc.y + 4).lineTo(M + W, doc.y + 4).lineWidth(1).strokeColor(GOLD).stroke();
    doc.moveDown(0.8).font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(`Autor(a): ${d.cliente}`, { width: W });
    if (d.reus.length) doc.text(`Réu: ${d.reus.join('; ')}`, { width: W });
    doc.fillColor(MUTED).fontSize(9).text(`Gerado em ${d.geradoEm.toLocaleDateString('pt-BR')}`, { width: W });
    doc.moveDown(0.8);

    // Tabela simples: cabeçalho repetido a cada página.
    const tabela = (titulo: string, cols: Array<{ t: string; w: number; dir?: boolean }>, linhas: string[][], negritoUltima = false) => {
      const larg = cols.map((c) => (c.w / cols.reduce((s, x) => s + x.w, 0)) * W);
      const cab = () => {
        const y = doc.y;
        doc.rect(M, y, W, 16).fill(NAVY);
        let x = M;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
        cols.forEach((c, i) => { doc.text(c.t, x + 4, y + 4, { width: larg[i] - 8, align: c.dir ? 'right' : 'left', lineBreak: false }); x += larg[i]; });
        doc.y = y + 16;
      };
      if (doc.y + 60 > fimDaPagina()) doc.addPage();
      doc.font('Times-Bold').fontSize(12).fillColor(NAVY).text(titulo, M, doc.y, { width: W });
      doc.moveDown(0.3);
      cab();
      linhas.forEach((ln, li) => {
        const negrito = negritoUltima && li === linhas.length - 1;
        doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const alt = Math.max(14, ...ln.map((t, i) => doc.heightOfString(t, { width: larg[i] - 8 }) + 6));
        if (doc.y + alt > fimDaPagina()) { doc.addPage(); cab(); doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8); }
        const y = doc.y;
        if (li % 2 === 1 || negrito) doc.rect(M, y, W, alt).fill(negrito ? SOFT : '#faf8f4');
        doc.moveTo(M, y + alt).lineTo(M + W, y + alt).lineWidth(0.5).strokeColor(LINE).stroke();
        let x = M;
        doc.fillColor(INK);
        ln.forEach((t, i) => { doc.text(t, x + 4, y + 3, { width: larg[i] - 8, align: cols[i].dir ? 'right' : 'left' }); x += larg[i]; });
        doc.y = y + alt;
      });
      doc.x = M;
      doc.moveDown(1);
    };

    if (!d.contratos.length) {
      doc.font('Helvetica').fontSize(10).fillColor(INK).text('Nenhum desconto lido nos extratos desta peça.', { width: W });
    } else {
      tabela('Contratos',
        [{ t: 'Contrato', w: 14 }, { t: 'Tipo', w: 14 }, { t: 'Banco', w: 20 }, { t: 'Inclusão', w: 10 }, { t: 'Meses', w: 8, dir: true }, { t: 'Período', w: 17 }, { t: 'Total descontado', w: 17, dir: true }],
        [...d.contratos.map((c) => [ou(c.numero, 's/nº'), c.nomeTipo, ou(c.banco), ou(c.inclusao), String(c.meses), ou(c.periodo), brl(c.descontado)]),
          ['Total', '', '', '', String(d.totalMeses), '', brl(d.totalDescontado)]], true);

      for (const c of d.contratos.filter((x) => x.linhas.length)) {
        tabela(`Descontos mês a mês — contrato ${ou(c.numero, 's/nº')} (${c.nomeTipo}${c.banco ? `, ${c.banco}` : ''})`,
          [{ t: 'Competência', w: 16 }, { t: 'Valor descontado', w: 20, dir: true }, { t: 'Fonte', w: 64 }],
          [...c.linhas.map((x) => [mesBr(x.competencia), brl(x.valor), ou(x.fonte)]), ['Total', brl(c.descontado), '']], true);
      }

      const vc = linhasValorDaCausa(d);
      tabela('Base do valor da causa', [{ t: 'Item', w: 72 }, { t: 'Valor', w: 28, dir: true }], vc, true);
    }

    if (doc.y + 50 > fimDaPagina()) doc.addPage();
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text(NOTA_ORIGINAL, M, doc.y, { width: W });

    const total = doc.bufferedPageRange().count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // rodapé abaixo da margem sem abrir página nova
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`Demonstrativo de descontos — ${d.cliente} · página ${i + 1} de ${total}`, M, doc.page.height - M + 10, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
