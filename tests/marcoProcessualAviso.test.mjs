// tests/marcoProcessualAviso.test.mjs
// Cobre o texto de "partes identificadas" usado no aviso de WhatsApp de
// sentença/acórdão publicado quando o processo ainda não tem cliente
// vinculado no CRM (hoje a mensagem só mostra o número do processo, sem
// nenhum nome — pedido da usuária: "não existe resumo nome da parte").
// Reaproveita `metadata.parties` que o DJEN já manda por publicação
// (src/services/djen.ts) mesmo quando `client_name` sai null por ambiguidade
// (múltiplas partes, advogada não é a única intimada) — nesses casos o dado
// bruto já existe, só não estava chegando na mensagem.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/monitoringService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { resumoPartesIdentificadas } = await import('../dist/services/monitoringService.js');

test('sem parties (undefined) devolve null', () => {
  assert.equal(resumoPartesIdentificadas(undefined), null);
});
test('array vazio devolve null', () => {
  assert.equal(resumoPartesIdentificadas([]), null);
});
test('parties só com nomes vazios/whitespace devolve null', () => {
  assert.equal(resumoPartesIdentificadas([{ nome: '' }, { nome: '   ' }, {}]), null);
});
test('uma parte válida devolve o nome dela', () => {
  assert.equal(resumoPartesIdentificadas([{ nome: 'João da Silva' }]), 'João da Silva');
});
test('remove espaços nas pontas do nome', () => {
  assert.equal(resumoPartesIdentificadas([{ nome: '  Maria Souza  ' }]), 'Maria Souza');
});
test('remove nomes duplicados (mesmo texto exato)', () => {
  assert.equal(resumoPartesIdentificadas([{ nome: 'Ana Lima' }, { nome: 'Ana Lima' }]), 'Ana Lima');
});
test('até 3 nomes distintos, separados por vírgula', () => {
  assert.equal(
    resumoPartesIdentificadas([{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }]),
    'A, B, C'
  );
});
test('mais de 3 nomes trunca e mostra quantos ficaram de fora', () => {
  assert.equal(
    resumoPartesIdentificadas([{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }, { nome: 'D' }, { nome: 'E' }]),
    'A, B, C (+2)'
  );
});
