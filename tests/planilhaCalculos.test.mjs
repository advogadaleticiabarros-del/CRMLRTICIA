// tests/planilhaCalculos.test.mjs — Calculista: índices do Bacen, planilha de
// cálculos atualizada (correção + juros desde cada desconto) e o arquivo .xlsx.
import { test } from 'node:test';
import assert from 'node:assert';
import JSZip from 'jszip';
import { lerSerieBacen, carregarIndices } from '../dist/services/indicesEconomicos.js';
import {
  atualizarIndebito, atualizarCalculo, planilhaMarkdown, planilhaXlsx,
} from '../dist/services/planilhaCalculos.js';
import { calcularPeca } from '../dist/services/pecaCalculos.js';
import { blocoCalculos, conferirValores } from '../dist/services/pecaDossie.js';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

test('SQL dos índices não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(['src/services/indicesEconomicosMysql.ts']);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

// ── índices do Bacen ────────────────────────────────────────────────────────

test('lerSerieBacen: "01/06/2024" → "2024-06", valor numérico; ignora lixo', () => {
  const r = lerSerieBacen([{ data: '01/06/2024', valor: '0.21' }, { data: '01/07/2024', valor: '-0.02' }, { data: 'x', valor: '1' }, { data: '01/08/2024', valor: '' }]);
  assert.deepStrictEqual(r, [{ competencia: '2024-06', valor: 0.21 }, { competencia: '2024-07', valor: -0.02 }]);
  assert.deepStrictEqual(lerSerieBacen({ erro: 'fora do ar' }), []);
});

function depsIndices({ cache = [], bacen, hoje = new Date(2026, 9, 28) } = {}) {
  const guardados = []; const chamadas = [];
  return {
    guardados, chamadas,
    deps: {
      cache: async () => cache,
      guardar: async (l) => { guardados.push(...l); },
      bacen: async (codigo, de, ate) => { chamadas.push({ codigo, de, ate }); return bacen ? bacen(codigo, de, ate) : []; },
      hoje: () => hoje,
    },
  };
}

test('carregarIndices: cache em dia não chama o Bacen', async () => {
  const cache = ['inpc', 'ipca', 'selic', 'legal'].map((serie) => ({ serie, competencia: '2026-09', valor: 0.5 }));
  const t = depsIndices({ cache });
  const r = await carregarIndices(t.deps);
  assert.strictEqual(t.chamadas.length, 0);
  assert.strictEqual(r.indices.ipca['2026-09'], 0.5);
  assert.deepStrictEqual(r.avisos, []);
});

test('carregarIndices: busca só o que falta, guarda e nunca guarda o mês corrente (Selic parcial)', async () => {
  const cache = [{ serie: 'selic', competencia: '2026-08', valor: 1.09 }];
  const t = depsIndices({
    cache,
    bacen: (codigo) => codigo === 4390
      ? [{ data: '01/09/2026', valor: '1.08' }, { data: '01/10/2026', valor: '0.92' }]
      : [{ data: '01/09/2026', valor: '0.82' }],
  });
  const r = await carregarIndices(t.deps, '2026-01');
  const selic = t.chamadas.find((c) => c.codigo === 4390);
  assert.strictEqual(selic.de, '01/09/2026', 'a Selic começa depois do último mês guardado');
  assert.ok(t.chamadas.some((c) => c.codigo === 433 && c.de === '01/01/2026'), 'sem cache, o IPCA começa no "desde"');
  assert.strictEqual(r.indices.selic['2026-10'], undefined, 'outubro/2026 ainda não fechou');
  assert.strictEqual(r.indices.selic['2026-09'], 1.08);
  assert.strictEqual(r.indices.selic['2026-08'], 1.09);
  assert.ok(!t.guardados.some((g) => g.competencia === '2026-10'));
  assert.ok(t.guardados.some((g) => g.serie === 'ipca' && g.competencia === '2026-09'));
});

test('carregarIndices: busca em janelas de até 10 anos', async () => {
  const t = depsIndices({ bacen: () => [] });
  await carregarIndices(t.deps, '2005-01');
  const ipca = t.chamadas.filter((c) => c.codigo === 433);
  assert.ok(ipca.length >= 3, `janelas: ${ipca.length}`);
  for (const c of ipca) {
    const ano = (s) => Number(s.slice(6));
    assert.ok(ano(c.ate) - ano(c.de) < 10, `${c.de} a ${c.ate}`);
  }
});

test('carregarIndices: Bacen fora do ar vira aviso e segue com o cache', async () => {
  const cache = [{ serie: 'ipca', competencia: '2026-05', valor: 0.3 }];
  const t = depsIndices({ cache, bacen: () => { throw new Error('timeout'); } });
  const r = await carregarIndices(t.deps);
  assert.strictEqual(r.indices.ipca['2026-05'], 0.3);
  assert.ok(r.avisos.some((a) => /Bacen/i.test(a)));
});

// ── atualização (correção + juros) ──────────────────────────────────────────

/** Índices fictícios: INPC e IPCA 1% a.m., Selic 1,5% a.m. em todo mês de 2020-01 a 2026-09. */
function indicesFixos({ inpc = 1, ipca = 1, selic = 1.5, ate = '2026-09' } = {}) {
  const r = { inpc: {}, ipca: {}, selic: {} };
  for (let a = 2020; a <= 2026; a++) for (let m = 1; m <= 12; m++) {
    const c = `${a}-${String(m).padStart(2, '0')}`;
    if (c > ate) break;
    r.inpc[c] = inpc; r.ipca[c] = ipca; r.selic[c] = selic;
  }
  return r;
}
const HOJE = new Date(2026, 9, 28); // 28/10/2026 → data-base 09/2026

test('atualizarIndebito: data-base é o último mês fechado; desconto do próprio mês não corrige nem rende juros', () => {
  const p = atualizarIndebito([{ competencia: '2026-09', valor: 100, contrato: 'A' }], indicesFixos(), HOJE);
  assert.strictEqual(p.dataBase, '2026-09');
  const l = p.linhas[0];
  assert.strictEqual(l.regra, 'dobro');
  assert.strictEqual(l.restituir, 200);
  assert.strictEqual(l.fator, 1);
  assert.strictEqual(l.jurosPct, 0);
  assert.strictEqual(l.total, 200);
});

test('atualizarIndebito: correção composta a partir do mês seguinte; juros simples 1% a.m. até 08/2024', () => {
  // desconto 2021-02 (em dobro, Tema 929): meses de 2021-03 a 2021-05 → 3 meses (data-base forçada pelos índices).
  const p = atualizarIndebito([{ competencia: '2021-02', valor: 100, contrato: 'A' }], indicesFixos({ ate: '2021-05' }), HOJE);
  assert.strictEqual(p.dataBase, '2021-05');
  const l = p.linhas[0];
  assert.strictEqual(l.regra, 'dobro', 'Tema 929 do STJ: sem o marco de 30/03/2021');
  assert.strictEqual(l.restituir, 200);
  assert.strictEqual(l.fator, 1.030301);
  assert.strictEqual(l.corrigido, 206.06);
  assert.strictEqual(l.jurosPct, 3);
  assert.strictEqual(l.juros, 6.18);
  assert.strictEqual(l.total, 212.24);
});

test('atualizarIndebito: a partir de 09/2024 os juros são a Taxa Legal publicada pelo Bacen (SGS 29543), não Selic − IPCA', () => {
  const ind = indicesFixos({ inpc: 5, ipca: 0.4, selic: 1.0, ate: '2024-10' });
  ind.legal = { '2024-08': 0.605306, '2024-09': 0.676227, '2024-10': 0.704241 };
  const p = atualizarIndebito([{ competencia: '2024-08', valor: 50, contrato: 'A' }], ind, HOJE);
  assert.strictEqual(p.linhas[0].jurosPct, 1.380468, 'set/2024 0,676227% + out/2024 0,704241%, somados (juros simples)');
  assert.ok(p.meses.every((m) => m.legalOficial));
  assert.ok(!p.avisos.some((a) => /Taxa Legal/.test(a)));
});

test('atualizarIndebito: sem a Taxa Legal publicada, usa Selic − IPCA e avisa', () => {
  const ind = indicesFixos({ ipca: 0.4, selic: 1.0, ate: '2024-10' });
  ind.legal = { '2024-09': 0.676227 };
  const p = atualizarIndebito([{ competencia: '2024-08', valor: 50, contrato: 'A' }], ind, HOJE);
  assert.strictEqual(p.linhas[0].jurosPct, 1.276227);
  assert.ok(p.avisos.some((a) => /Taxa Legal do Bacen não disponível em 10\/2024/.test(a)));
});

test('carregarIndices: a Taxa Legal (29543) só é buscada a partir de 08/2024', async () => {
  const t = depsIndices({ bacen: () => [] });
  await carregarIndices(t.deps, '2005-01');
  const legal = t.chamadas.filter((c) => c.codigo === 29543);
  assert.ok(legal.length >= 1);
  assert.strictEqual(legal[0].de, '01/08/2024');
});

test('atualizarIndebito: a partir de 09/2024 corrige pelo IPCA e os juros são a taxa legal (Selic − IPCA)', () => {
  const ind = indicesFixos({ inpc: 5, ipca: 0.4, selic: 1.0, ate: '2024-10' });
  const p = atualizarIndebito([{ competencia: '2024-08', valor: 50, contrato: 'A' }], ind, HOJE);
  const l = p.linhas[0];
  assert.strictEqual(p.dataBase, '2024-10');
  assert.strictEqual(l.fator, 1.008016, 'IPCA 0,4% em 09 e 10/2024 (o INPC de 5% não entra)');
  assert.strictEqual(l.jurosPct, 1.2, 'taxa legal 0,6% + 0,6%');
  const meses = p.meses.map((m) => [m.competencia, m.indice, m.regraJuros]);
  assert.deepStrictEqual(meses, [['2024-09', 'IPCA', 'taxa legal'], ['2024-10', 'IPCA', 'taxa legal']]);
});

test('atualizarIndebito: taxa legal negativa vira zero', () => {
  const ind = indicesFixos({ ipca: 0.5, selic: 0.2, ate: '2024-11' });
  const l = atualizarIndebito([{ competencia: '2024-09', valor: 100, contrato: 'A' }], ind, HOJE).linhas[0];
  assert.strictEqual(l.jurosPct, 0, 'Selic 0,2 − IPCA 0,5 < 0');
  assert.strictEqual(l.fator, 1.010025);
});

test('atualizarIndebito: deflação nunca reduz o valor original', () => {
  const ind = indicesFixos({ ipca: -0.5, selic: 0.2, ate: '2024-11' });
  const l = atualizarIndebito([{ competencia: '2024-09', valor: 100, contrato: 'A' }], ind, HOJE).linhas[0];
  assert.strictEqual(l.fator, 1);
  assert.strictEqual(l.corrigido, 200);
  assert.strictEqual(l.jurosPct, 1.4, 'Selic 0,2 − IPCA (−0,5) = 0,7 por mês');
});

test('atualizarIndebito: índice ausente no período vira aviso e conta como zero', () => {
  const ind = indicesFixos({ ate: '2021-06' });
  delete ind.inpc['2021-04'];
  const p = atualizarIndebito([{ competencia: '2021-02', valor: 100, contrato: 'A' }], ind, HOJE);
  assert.strictEqual(p.linhas[0].fator, Number((1.01 ** 3).toFixed(6)));
  assert.ok(p.avisos.some((a) => /04\/2021/.test(a)));
});

test('atualizarIndebito sem índices: planilha nominal com aviso', () => {
  const p = atualizarIndebito([{ competencia: '2022-01', valor: 80, contrato: 'A' }], null, HOJE);
  assert.strictEqual(p.dataBase, null);
  assert.strictEqual(p.linhas[0].total, 160);
  assert.ok(p.avisos.some((a) => /sem correção/i.test(a)));
});

test('atualizarIndebito: totais por contrato e geral, linhas em ordem de contrato e mês', () => {
  const p = atualizarIndebito([
    { competencia: '2026-08', valor: 10, contrato: 'B' }, { competencia: '2026-09', valor: 10, contrato: 'A' }, { competencia: '2026-07', valor: 10, contrato: 'B' },
  ], indicesFixos(), HOJE);
  assert.deepStrictEqual(p.linhas.map((l) => `${l.contrato} ${l.competencia}`), ['A 2026-09', 'B 2026-07', 'B 2026-08']);
  assert.deepStrictEqual(p.porContrato.map((c) => c.contrato), ['A', 'B']);
  const soma = p.linhas.reduce((s, l) => s + l.total, 0);
  assert.strictEqual(p.total.total, Math.round(soma * 100) / 100);
  assert.strictEqual(p.total.descontado, 30);
});

// ── integração com o cálculo da peça ────────────────────────────────────────

const DESCONTOS = [
  { competencia: '2021-02', valor: 100, contrato: '123' },
  { competencia: '2021-02', valor: 100, contrato: '123' }, // repetido em outro documento
  { competencia: '2021-04', valor: 100, contrato: '123' },
];

test('atualizarCalculo: usa os descontos sem repetição e o valor da causa passa a ser o atualizado', () => {
  const nominal = calcularPeca({ contratos: [], descontos: DESCONTOS, danoMoral: 5000, hoje: HOJE });
  assert.strictEqual(nominal.valorDaCausa.restituicao, 400, 'dois descontos únicos, em dobro');
  const c = atualizarCalculo(nominal, indicesFixos(), HOJE);
  assert.strictEqual(c.atualizacao.linhas.length, 2);
  assert.strictEqual(c.valorDaCausa.restituicao, c.atualizacao.total.total);
  assert.ok(c.valorDaCausa.restituicao > 400);
  assert.strictEqual(c.valorDaCausa.total, Math.round((c.atualizacao.total.total + 5000) * 100) / 100);
  assert.strictEqual(c.indebito.total.restituir, 400, 'o nominal continua no cálculo');
});

test('atualizarCalculo sem descontos não cria planilha', () => {
  const c = atualizarCalculo(calcularPeca({ contratos: [], descontos: [], hoje: HOJE }), indicesFixos(), HOJE);
  assert.strictEqual(c.atualizacao, null);
});

test('blocoCalculos e conferência citam o total atualizado e a planilha anexa', () => {
  const c = atualizarCalculo(calcularPeca({ contratos: [], descontos: DESCONTOS, hoje: HOJE }), indicesFixos(), HOJE);
  const b = blocoCalculos(c);
  assert.match(b, /planilha de cálculos anexa/i);
  assert.match(b, /09\/2026/);
  assert.ok(conferirValores('nada', c).some((x) => /atualizado/i.test(x.rotulo)));
});

// ── saídas: tabela no CRM e .xlsx ───────────────────────────────────────────

const CAB = { cliente: 'Cliente Teste', reus: ['Banco Fictício S.A.'], casos: [{ id: 1, titulo: 'RMC' }] };

test('planilhaMarkdown: tabela mês a mês, critérios e resumo do valor da causa', () => {
  const c = atualizarCalculo(calcularPeca({ contratos: [], descontos: DESCONTOS, hoje: HOJE }), indicesFixos(), HOJE);
  const md = planilhaMarkdown(c, CAB);
  assert.match(md, /^# Planilha de cálculos — Cliente Teste/);
  assert.match(md, /\| Competência \| Contrato \|/);
  assert.match(md, /\| 02\/2021 \| 123 \| R\$ 100,00 \| em dobro/);
  assert.match(md, /Tema 929/);
  assert.match(md, /Taxa Legal/);
  assert.match(md, /Súmula 43/);
  assert.match(md, /Súmula 54/);
  assert.match(md, /Valor da causa/i);
  assert.match(md, /Banco Fictício/);
});

test('planilhaXlsx: arquivo .xlsx válido com fórmulas, totais e aba de índices', async () => {
  const c = atualizarCalculo(calcularPeca({ contratos: [], descontos: DESCONTOS, hoje: HOJE }), indicesFixos(), HOJE);
  const buf = await planilhaXlsx(c, CAB);
  assert.ok(Buffer.isBuffer(buf));
  const zip = await JSZip.loadAsync(buf);
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(zip.file(f), `falta ${f}`);
  }
  const wb = await zip.file('xl/workbook.xml').async('string');
  assert.match(wb, /name="Cálculo"/);
  assert.match(wb, /name="Índices"/);
  const s1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(s1, /<f>ROUND\(E\d+\*F\d+,2\)<\/f>/);
  assert.match(s1, /<f>SUM\(J\d+:J\d+\)<\/f>/);
  assert.match(s1, /Cliente Teste/);
  const s2 = await zip.file('xl/worksheets/sheet2.xml').async('string');
  assert.match(s2, /INPC/);
});

test('planilhaXlsx escapa texto (sem XML quebrado)', async () => {
  const c = atualizarCalculo(calcularPeca({ contratos: [], descontos: [{ competencia: '2026-09', valor: 1, contrato: 'A&B <x>' }], hoje: HOJE }), indicesFixos(), HOJE);
  const zip = await JSZip.loadAsync(await planilhaXlsx(c, { ...CAB, cliente: 'Maria & "Filhos"' }));
  const s1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.ok(s1.includes('A&amp;B &lt;x&gt;'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(s1));
});
