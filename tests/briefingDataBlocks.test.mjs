// Valida que as 4 novas funções de dado do briefing (getFinanceiroGranular,
// getComercialDoDia, getAgenda3Dias, getEsteiraEDocumentos) referenciam
// colunas/tabelas que de fato existem no schema.
//
// Antes este teste fazia 3 greps de regex escolhidos a dedo, que não
// cobriam as colunas quebradas (parcelas.updated_at, case_awards.alvara_recebido,
// leads.area) encontradas em revisão manual. Agora reaproveita o MESMO
// mecanismo genérico de tests/dashboards.test.mjs (schema real das
// migrations + cruzamento alias.coluna), extraído para
// tests/helpers/schemaAudit.mjs, aplicado a src/services/morningBriefingService.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { lerSchema, tabelasComEscrita, auditarArquivos } from './helpers/schemaAudit.mjs';

if (!existsSync(new URL('../dist/services/morningBriefingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const mod = await import('../dist/services/morningBriefingService.js');

test('getAgenda3Dias, getFinanceiroGranular, getComercialDoDia e getEsteiraEDocumentos são exportadas', () => {
  assert.equal(typeof mod.getAgenda3Dias, 'function');
  assert.equal(typeof mod.getFinanceiroGranular, 'function');
  assert.equal(typeof mod.getComercialDoDia, 'function');
  assert.equal(typeof mod.getEsteiraEDocumentos, 'function');
});

// getMovimentacoesDoDia (Task 9) não é exportada — é interna, usada só por
// sendMorningBriefings/sendMorningBriefingWhatsapp. A cobertura dela vem da
// auditoria de schema abaixo (mesmo arquivo) mais os testes de
// briefingHtmlTemplate/briefingWhatsappTemplate, que já exercitam o shape
// MovimentacaoBriefing consumido por buildHtml/buildWhatsappText.

const raiz = path.resolve('.');
const BRIEFING_FILE = path.join(raiz, 'src/services/morningBriefingService.ts');

const SCHEMA = lerSchema();
const ESCRITAS = tabelasComEscrita();

test('a auditoria conseguiu ler o schema real', () => {
  assert.ok(SCHEMA.size > 30, `esperava dezenas de tabelas, achei ${SCHEMA.size}`);
});

test('morningBriefingService só consulta tabelas que EXISTEM no banco', () => {
  const { tabelasInexistentes } = auditarArquivos([BRIEFING_FILE], { schema: SCHEMA, escritas: ESCRITAS });
  assert.deepEqual(tabelasInexistentes, [], '\n  ' + tabelasInexistentes.join('\n  '));
});

test('morningBriefingService não mede tabela MORTA (onde o código nunca escreve)', () => {
  const { tabelasMortas } = auditarArquivos([BRIEFING_FILE], { schema: SCHEMA, escritas: ESCRITAS });
  assert.deepEqual(tabelasMortas, [], '\n  ' + tabelasMortas.join('\n  '));
});

test('morningBriefingService não filtra/lê por uma coluna que NÃO existe na tabela', () => {
  // Pegou exatamente os 3 bugs da revisão: parcelas.updated_at (correto:
  // atualizado_em), case_awards.alvara_recebido (não existe — o filtro certo
  // é kind='alvara' AND status='aguardando') e leads.area (correto: legal_area).
  const { colunasInexistentes } = auditarArquivos([BRIEFING_FILE], { schema: SCHEMA, escritas: ESCRITAS });
  assert.deepEqual(colunasInexistentes, [], '\n  ' + colunasInexistentes.join('\n  '));
});

// Sanidade adicional: colunas específicas que as 4 novas funções dependem
// devem existir nas migrations, sob os nomes corretos.
test('parcelas.atualizado_em existe (migration 013) — não "updated_at"', () => {
  assert.ok(SCHEMA.get('parcelas')?.has('atualizado_em'), 'parcelas.atualizado_em deveria existir no schema real');
});
test('case_awards.kind e case_awards.status existem (migration 073) — não "alvara_recebido"', () => {
  assert.ok(SCHEMA.get('case_awards')?.has('kind'), 'case_awards.kind deveria existir no schema real');
  assert.ok(SCHEMA.get('case_awards')?.has('status'), 'case_awards.status deveria existir no schema real');
});
test('leads.legal_area existe (migration 001) — não "area"', () => {
  assert.ok(SCHEMA.get('leads')?.has('legal_area'), 'leads.legal_area deveria existir no schema real');
});
test('clients.birth_date existe (migration 095)', () => {
  assert.ok(SCHEMA.get('clients')?.has('birth_date'), 'clients.birth_date deveria existir no schema real');
});
test('cases.production_stage e production_started_at existem (migrations 010/044)', () => {
  assert.ok(SCHEMA.get('cases')?.has('production_stage'), 'cases.production_stage deveria existir no schema real');
  assert.ok(SCHEMA.get('cases')?.has('production_started_at'), 'cases.production_started_at deveria existir no schema real');
});

// Sanidade específica da Task 9 (getMovimentacoesDoDia): process_movements.ai_summary
// só existe a partir da migration 096 (JSON) — a coluna TEXT da 038 foi
// substituída, e legal_processes.process_number/client_id vêm da migration 011.
test('process_movements.ai_summary existe (migration 096, tipo JSON)', () => {
  assert.ok(SCHEMA.get('process_movements')?.has('ai_summary'), 'process_movements.ai_summary deveria existir no schema real');
});
test('legal_processes.process_number e legal_processes.client_id existem (migration 011)', () => {
  assert.ok(SCHEMA.get('legal_processes')?.has('process_number'), 'legal_processes.process_number deveria existir no schema real');
  assert.ok(SCHEMA.get('legal_processes')?.has('client_id'), 'legal_processes.client_id deveria existir no schema real');
});
