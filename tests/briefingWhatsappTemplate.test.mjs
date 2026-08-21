// tests/briefingWhatsappTemplate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/morningBriefingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { buildWhatsappText } = await import('../dist/services/morningBriefingService.js');

const agendaExemplo = [
  { titulo: 'Audiência Usiminas', tipo: 'audiencia', data: '2026-08-21', hora: '16:20', local: 'Vara do Trabalho', videoLink: null, severity: 'critica' },
];
const financeiroExemplo = { aReceberHoje: 480, rpvSemana: 2150, recebido7d: 6300, alvarasAguardando: 0 };
const comercialExemplo = { leadsNovos: [], aniversariantes: [] };
const esteiraExemplo = { pecasAProduzir: [], documentosPendentes: [] };
const movimentacoesExemplo = [
  { processo: '0031224-88.2025.5.17.0007', clienteVsParte: 'Maria Aparecida × Rodotex', resumo: 'Decisão publicada.', acao: 'preparar liquidação', prazoInterno: '25/08', severity: 'critica' },
];

test('WhatsApp tem os mesmos blocos de severidade do e-mail (paridade total)', () => {
  const texto = buildWhatsappText('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(texto, /ATENÇÃO IMEDIATA/);
  assert.match(texto, /Maria Aparecida × Rodotex/);
  assert.match(texto, /preparar liquidação/);
  assert.match(texto, /Financeiro/);
  assert.match(texto, /480/);
});

test('não usa HTML — só texto/markdown do WhatsApp (*negrito*, _itálico_)', () => {
  const texto = buildWhatsappText('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.doesNotMatch(texto, /<[a-z]+>/i);
});

test('prazo crítico sozinho (sem movimentação nem agenda crítica) preenche tanto "ATENÇÃO IMEDIATA" quanto "3 coisas hoje"', () => {
  const financeiroSemPendencia = { aReceberHoje: 0, rpvSemana: 0, recebido7d: 0, alvarasAguardando: 0 };
  const agendaComPrazo = {
    eventos: [],
    prazos: [{ description: 'Contestação — Proc. trabalhista', case_number: '0012345-11.2026.5.17.0001' }],
    tarefas: [],
  };
  const texto = buildWhatsappText('Letícia', null, agendaComPrazo, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, [], financeiroSemPendencia, { leadsNovos: [], aniversariantes: [] }, { pecasAProduzir: [], documentosPendentes: [] }, []);
  assert.match(texto, /ATENÇÃO IMEDIATA/, 'prazo crítico isolado deve preencher o bloco de atenção imediata');
  assert.match(texto, /Prazo: Contestação/);
  assert.match(texto, /3 coisas hoje/, 'com prazo crítico isolado, o fecho "3 coisas hoje" deve aparecer');
});
