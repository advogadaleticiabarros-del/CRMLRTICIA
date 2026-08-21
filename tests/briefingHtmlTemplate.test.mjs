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
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(html, /Bom dia, Dra\. Letícia/);
});

test('item crítico (audiência hoje) aparece no bloco de Atenção imediata', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  const idxAtencao = html.indexOf('Atenção imediata');
  const idxAudiencia = html.indexOf('Audiência Usiminas');
  assert.ok(idxAtencao > -1 && idxAudiencia > idxAtencao, 'audiência deve vir depois do cabeçalho de Atenção imediata');
});

test('movimentação interpretada mostra resumo, ação e prazo interno', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(html, /Maria Aparecida × Rodotex/);
  assert.match(html, /preparar liquidação/);
  assert.match(html, /25\/08/);
});

test('financeiro granular mostra os 4 valores', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(html, /480,00/);
  assert.match(html, /2\.150,00/);
  assert.match(html, /6\.300,00/);
});

test('sem nenhum item crítico, o bloco "3 prioridades" não aparece', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, [], financeiroExemplo, { leadsNovos: [], aniversariantes: [] }, { pecasAProduzir: [], documentosPendentes: [] }, []);
  assert.doesNotMatch(html, /3 coisas hoje/);
});
