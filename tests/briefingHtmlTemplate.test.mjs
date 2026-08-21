// tests/briefingHtmlTemplate.test.mjs
// Não testa pixel-a-pixel — valida que os blocos obrigatórios aparecem no
// HTML gerado e que a severidade decide em qual bloco cada item cai.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/morningBriefingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { buildHtml } = await import('../dist/services/morningBriefingService.js');

const agendaExemplo = [
  { titulo: 'Audiência Usiminas', tipo: 'audiencia', data: '2026-08-21', hora: '16:20', local: 'Vara do Trabalho', videoLink: null, severity: 'critica' },
];
const financeiroExemplo = { aReceberHoje: 480, rpvSemana: 2150, recebido7d: 6300, alvarasAguardando: 0 };
const comercialExemplo = { leadsNovos: [{ nome: 'Camila R.', area: 'trabalhista', origem: 'site', criadoEm: new Date('2026-08-21') }], aniversariantes: [{ nome: 'Sérgio M.' }] };
const esteiraExemplo = { pecasAProduzir: [{ caso: 'Roberta L.', fase: 'criacao_inicial', diasParado: 6, severity: 'pode_esperar' }], documentosPendentes: [] };
const movimentacoesExemplo = [
  { processo: '0031224-88.2025.5.17.0007', clienteVsParte: 'Maria Aparecida × Rodotex', resumo: 'Decisão publicada.', acao: 'preparar liquidação', prazoInterno: '25/08', severity: 'critica' },
];

test('buildHtml inclui o nome do escritório e a saudação', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo, []);
  assert.match(html, /Bom dia, Dra\. Letícia/);
});

test('item crítico (audiência hoje) aparece no bloco de Atenção imediata', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo, []);
  const idxAtencao = html.indexOf('Atenção imediata');
  const idxAudiencia = html.indexOf('Audiência Usiminas');
  assert.ok(idxAtencao > -1 && idxAudiencia > idxAtencao, 'audiência deve vir depois do cabeçalho de Atenção imediata');
});

test('movimentação interpretada mostra resumo, ação e prazo interno', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo, []);
  assert.match(html, /Maria Aparecida × Rodotex/);
  assert.match(html, /preparar liquidação/);
  assert.match(html, /25\/08/);
});

test('financeiro granular mostra os 4 valores', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo, []);
  assert.match(html, /480,00/);
  assert.match(html, /2\.150,00/);
  assert.match(html, /6\.300,00/);
});

test('sem nenhum item crítico, o bloco "3 prioridades" não aparece', () => {
  const financeiroSemPendencia = { aReceberHoje: 0, rpvSemana: 2150, recebido7d: 6300, alvarasAguardando: 0 };
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, [], financeiroSemPendencia, { leadsNovos: [], aniversariantes: [] }, { pecasAProduzir: [], documentosPendentes: [] }, [], []);
  assert.doesNotMatch(html, /3 coisas hoje/);
});

test('prazo crítico sozinho (sem movimentação nem agenda crítica) preenche o bloco "3 prioridades do dia"', () => {
  const financeiroSemPendencia = { aReceberHoje: 0, rpvSemana: 0, recebido7d: 0, alvarasAguardando: 0 };
  const prazosPorFaixaExemplo = [
    { description: 'Contestação — Proc. trabalhista', case_number: '0012345-11.2026.5.17.0001', diasParaVencer: 0 },
  ];
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, [], financeiroSemPendencia, { leadsNovos: [], aniversariantes: [] }, { pecasAProduzir: [], documentosPendentes: [] }, [], prazosPorFaixaExemplo);
  assert.match(html, /3 coisas hoje/, 'com prazo crítico isolado, o bloco "3 prioridades" deve aparecer (Achado 2)');
  assert.match(html, /Prazo: Contestação/);
});

test('prazo de AMANHÃ (diasParaVencer: 1) também é classificado como crítico, não só os de hoje', () => {
  const financeiroSemPendencia = { aReceberHoje: 0, rpvSemana: 0, recebido7d: 0, alvarasAguardando: 0 };
  const prazosPorFaixaExemplo = [
    { description: 'Recurso — Proc. família', case_number: '0099999-22.2026.5.17.0002', diasParaVencer: 1 },
  ];
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, [], financeiroSemPendencia, { leadsNovos: [], aniversariantes: [] }, { pecasAProduzir: [], documentosPendentes: [] }, [], prazosPorFaixaExemplo);
  const idxAtencao = html.indexOf('Atenção imediata');
  const idxPrazo = html.indexOf('Prazo: Recurso');
  assert.ok(idxAtencao > -1 && idxPrazo > idxAtencao, 'prazo de amanhã deve cair no bloco crítico "Atenção imediata"');
  assert.match(html, /3 coisas hoje/, 'prazo de amanhã (crítico) também deve preencher "3 coisas hoje"');
});

test('documentos pendentes (Achado 4): mostra caso e itens faltando quando não vazio', () => {
  const esteiraComDocumentos = {
    pecasAProduzir: [],
    documentosPendentes: [{ caso: 'Roberta L.', itensFaltando: ['RG', 'Comprovante de residência'] }],
  };
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, [], financeiroExemplo, { leadsNovos: [], aniversariantes: [] }, esteiraComDocumentos, [], []);
  assert.match(html, /Documentos pendentes/);
  assert.match(html, /Roberta L\./);
  assert.match(html, /RG/);
  assert.match(html, /Comprovante de residência/);
});

test('com previsão do tempo e meta do mês, o HTML mostra a previsão e a Meta do mês (regressão Task 7)', () => {
  const weatherExemplo = { tmin: 18, tmax: 27, desc: 'parcialmente nublado', city: 'Vitória' };
  const metaExemplo = { current: 8500, target: 15000, percent: 57, faltam: 6500, contratos_fechados_mes: 5 };
  const html = buildHtml('Letícia', weatherExemplo, { eventos: [], prazos: [], tarefas: [] }, {}, metaExemplo, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo, []);
  assert.match(html, /Vitória/);
  assert.match(html, /18°C a 27°C/);
  assert.match(html, /parcialmente nublado/);
  assert.match(html, /Meta do mês/);
  assert.match(html, /8\.500,00/);
});
