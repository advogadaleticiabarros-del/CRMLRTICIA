// Cabeçalho das peças (regra da Jessica): toda peça abre com "AO DOUTO JUÍZO" (13/11/2026);
// na trabalhista, o cabeçalho é fixo: "AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)" (30/10/2026).
import { test } from 'node:test';
import assert from 'node:assert';
import { ehAreaTrabalhista, enderecamentoTrabalhista, regraEnderecamento, aplicarEnderecamento } from '../dist/services/enderecamentoPeca.js';

test('área trabalhista: trabalhista, gestante e texto livre com "trabalh"', () => {
  assert.ok(ehAreaTrabalhista('trabalhista'));
  assert.ok(ehAreaTrabalhista('gestante'));
  assert.ok(ehAreaTrabalhista('Justiça do Trabalho — reclamação trabalhista'));
  assert.ok(!ehAreaTrabalhista('consumidor'));
  assert.ok(!ehAreaTrabalhista(null));
});

test('cabeçalho trabalhista: vara em branco; cidade e estado quando se sabe, senão (CIDADE) – (ESTADO)', () => {
  assert.strictEqual(enderecamentoTrabalhista(), 'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)');
  assert.strictEqual(enderecamentoTrabalhista('Vitória', 'es'), 'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE VITÓRIA – ES');
});

test('regra no prompt: cabeçalho fixo na trabalhista; "AO DOUTO JUÍZO" nas outras áreas', () => {
  assert.match(regraEnderecamento('trabalhista'), /AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE \(CIDADE\) – \(ESTADO\)/);
  assert.match(regraEnderecamento('consumidor'), /começa com "AO DOUTO JUÍZO"/);
  assert.match(regraEnderecamento(null), /AO DOUTO JUÍZO/);
});

test('trabalhista: troca o endereçamento antigo pelo padrão e aproveita a cidade e o estado', () => {
  const t = 'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DA VARA DO TRABALHO DE VITÓRIA/ES\n\nFULANA, brasileira, vem propor RECLAMAÇÃO TRABALHISTA.';
  assert.strictEqual(aplicarEnderecamento(t, 'trabalhista'),
    'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE VITÓRIA – ES\n\nFULANA, brasileira, vem propor RECLAMAÇÃO TRABALHISTA.');
});

test('trabalhista: vara numerada, negrito em markdown e "– ES" também são reconhecidos', () => {
  const t = '**EXMO. SR. JUIZ DA 3ª VARA DO TRABALHO DE SERRA – ES**\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(t, 'gestante'), 'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE SERRA – ES\n\nTexto.');
});

test('trabalhista: sem cidade no cabeçalho antigo, fica (CIDADE) – (ESTADO)', () => {
  const t = 'EXCELENTÍSSIMO SENHOR JUIZ DO TRABALHO\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(t, 'trabalhista'), 'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)\n\nTexto.');
});

test('trabalhista: peça sem endereçamento ganha o cabeçalho no topo', () => {
  assert.strictEqual(aplicarEnderecamento('FULANA vem propor ação.', 'trabalhista'),
    'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)\n\nFULANA vem propor ação.');
});

test('trabalhista: cabeçalho antigo sem o "AO" ganha o "AO"; já no padrão fica como está', () => {
  assert.strictEqual(aplicarEnderecamento('DOUTO JUÍZO DA ___ VARA DO TRABALHO DE CARIACICA – ES\n\nTexto.', 'trabalhista'),
    'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE CARIACICA – ES\n\nTexto.');
  const ok = 'AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE CARIACICA – ES\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(ok, 'trabalhista'), ok);
});

test('cível: "AO JUÍZO DE UMA DAS VARAS CÍVEIS" vira "AO DOUTO JUÍZO", mantendo o resto', () => {
  const t = 'AO JUÍZO DE UMA DAS VARAS CÍVEIS DA COMARCA DE CARIACICA/ES\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(t, 'bancario'),
    'AO DOUTO JUÍZO DE UMA DAS VARAS CÍVEIS DA COMARCA DE CARIACICA/ES\n\nTexto.');
});

test('outras áreas: "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO" e "EXMO. SR. DR. JUIZ FEDERAL" viram "AO DOUTO JUÍZO"', () => {
  assert.strictEqual(aplicarEnderecamento('EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 1ª VARA CÍVEL DE VITÓRIA/ES\n\nTexto.', 'consumidor'),
    'AO DOUTO JUÍZO DA 1ª VARA CÍVEL DE VITÓRIA/ES\n\nTexto.');
  assert.strictEqual(aplicarEnderecamento('**EXMO. SR. DR. JUIZ FEDERAL DO JUIZADO ESPECIAL FEDERAL DE VITÓRIA/ES**\n\nTexto.', 'previdenciario'),
    'AO DOUTO JUÍZO DO JUIZADO ESPECIAL FEDERAL DE VITÓRIA/ES\n\nTexto.');
});

test('outras áreas: "AO JUIZADO…" e "À VARA…" ganham o "DOUTO JUÍZO"', () => {
  assert.strictEqual(aplicarEnderecamento('AO JUIZADO ESPECIAL CÍVEL DA COMARCA DE SERRA/ES\n\nTexto.', 'consumidor'),
    'AO DOUTO JUÍZO DO JUIZADO ESPECIAL CÍVEL DA COMARCA DE SERRA/ES\n\nTexto.');
  assert.strictEqual(aplicarEnderecamento('À 2ª VARA CÍVEL DE CARIACICA/ES\n\nTexto.', 'civel'),
    'AO DOUTO JUÍZO DA 2ª VARA CÍVEL DE CARIACICA/ES\n\nTexto.');
});

test('outras áreas: já no padrão ou sem endereçamento na 1ª linha, o texto fica como está', () => {
  const ok = 'AO DOUTO JUÍZO DA ___ VARA CÍVEL DA COMARCA DE CARIACICA – ES\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(ok, 'bancario'), ok);
  const sem = 'FULANA vem propor ação contra o BANCO.';
  assert.strictEqual(aplicarEnderecamento(sem, 'bancario'), sem);
});

test('negrito com sublinhado sai, mas o "___" da vara fica', () => {
  assert.strictEqual(aplicarEnderecamento('__AO JUÍZO DA ___ VARA CÍVEL DE SERRA/ES__\n\nTexto.', 'consumidor'),
    'AO DOUTO JUÍZO DA ___ VARA CÍVEL DE SERRA/ES\n\nTexto.');
});
