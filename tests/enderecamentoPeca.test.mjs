// Cabeçalho das peças trabalhistas (regra da Jessica, 30/10/2026):
// "DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)".
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

test('cabeçalho padrão: vara em branco; cidade e estado quando se sabe, senão (CIDADE) – (ESTADO)', () => {
  assert.strictEqual(enderecamentoTrabalhista(), 'DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)');
  assert.strictEqual(enderecamentoTrabalhista('Vitória', 'es'), 'DOUTO JUÍZO DA ___ VARA DO TRABALHO DE VITÓRIA – ES');
});

test('regra no prompt só para peça trabalhista', () => {
  assert.match(regraEnderecamento('trabalhista'), /DOUTO JUÍZO DA ___ VARA DO TRABALHO DE \(CIDADE\) – \(ESTADO\)/);
  assert.strictEqual(regraEnderecamento('consumidor'), '');
});

test('troca o endereçamento antigo pelo padrão e aproveita a cidade e o estado', () => {
  const t = 'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DA VARA DO TRABALHO DE VITÓRIA/ES\n\nFULANA, brasileira, vem propor RECLAMAÇÃO TRABALHISTA.';
  assert.strictEqual(aplicarEnderecamento(t, 'trabalhista'),
    'DOUTO JUÍZO DA ___ VARA DO TRABALHO DE VITÓRIA – ES\n\nFULANA, brasileira, vem propor RECLAMAÇÃO TRABALHISTA.');
});

test('vara numerada, negrito em markdown e "– ES" também são reconhecidos', () => {
  const t = '**EXMO. SR. JUIZ DA 3ª VARA DO TRABALHO DE SERRA – ES**\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(t, 'gestante'), 'DOUTO JUÍZO DA ___ VARA DO TRABALHO DE SERRA – ES\n\nTexto.');
});

test('sem cidade no cabeçalho antigo: fica (CIDADE) – (ESTADO)', () => {
  const t = 'EXCELENTÍSSIMO SENHOR JUIZ DO TRABALHO\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(t, 'trabalhista'), 'DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)\n\nTexto.');
});

test('peça sem endereçamento ganha o cabeçalho no topo', () => {
  assert.strictEqual(aplicarEnderecamento('FULANA vem propor ação.', 'trabalhista'),
    'DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)\n\nFULANA vem propor ação.');
});

test('outras áreas e cabeçalho já no padrão ficam como estão', () => {
  const civel = 'EXCELENTÍSSIMO SENHOR JUIZ DA VARA CÍVEL DE VITÓRIA/ES\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(civel, 'consumidor'), civel);
  const ok = 'DOUTO JUÍZO DA ___ VARA DO TRABALHO DE CARIACICA – ES\n\nTexto.';
  assert.strictEqual(aplicarEnderecamento(ok, 'trabalhista'), ok);
});
