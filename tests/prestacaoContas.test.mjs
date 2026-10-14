// tests/prestacaoContas.test.mjs — texto padrão da prestação de contas do acordo (WhatsApp)
import { test } from 'node:test';
import assert from 'node:assert';
import { textoPrestacaoContas } from '../dist/services/prestacaoContas.js';

const DADOS = {
  cliente: 'Fulano de Tal Teste',
  processo: '00012345620265170003',
  vara: '3ª Vara do Trabalho de Vitória',
  total: 20000, pctHonorarios: 30, honorariosTotal: 6000,
  parcelas: [
    { rotulo: '1ª parcela', data: '2026-10-15', bruto: 5000, honorarios: 1500, liquido: 3500, repassada: true },
    { rotulo: '2ª parcela', data: '2026-11-16', bruto: 5000, honorarios: 1500, liquido: 3500, repassada: false },
    { rotulo: '3ª parcela', data: '2026-12-15', bruto: 5000, honorarios: 1500, liquido: 3500, repassada: false },
    { rotulo: '4ª parcela', data: '2027-01-15', bruto: 5000, honorarios: 1500, liquido: 3500, repassada: false },
  ],
  atual: 0, pix: '27999990000', banco: 'Nubank',
};

test('cabeçalho com primeiro nome, processo (com máscara CNJ) e vara', () => {
  const t = textoPrestacaoContas(DADOS);
  assert.match(t, /^Olá, Fulano!/);
  assert.match(t, /0001234-56\.2026\.5\.17\.0003/);
  assert.match(t, /3ª Vara do Trabalho de Vitória/);
});

test('resumo do acordo: total, honorários com %, total líquido', () => {
  const t = textoPrestacaoContas(DADOS);
  assert.match(t, /Valor total do acordo: \*R\$\s?20\.000,00\*/);
  assert.match(t, /4 parcelas de R\$\s?5\.000,00/);
  assert.match(t, /Honorários contratuais \(30%\): \*R\$\s?6\.000,00\*/);
  assert.match(t, /Total líquido para você: R\$\s?14\.000,00/);
});

test('parcela desta prestação: recebido, honorários, repassado e Pix', () => {
  const t = textoPrestacaoContas(DADOS);
  assert.match(t, /1ª PARCELA \(recebida\)/);
  assert.match(t, /Recebido da empresa: R\$\s?5\.000,00/);
  assert.match(t, /Repassado a você: R\$\s?3\.500,00/);
  assert.match(t, /Pix: 27999990000 \(Nubank\)/);
});

test('cronograma mantém todas as parcelas do acordo e marca as repassadas', () => {
  const t = textoPrestacaoContas(DADOS);
  assert.match(t, /1ª · 15\/10\/2026 · R\$\s?3\.500,00 ✅/);
  assert.match(t, /4ª · 15\/01\/2027 · R\$\s?3\.500,00$/m);
});

test('situação atual soma o que já foi repassado e o que falta', () => {
  const t = textoPrestacaoContas({ ...DADOS, parcelas: DADOS.parcelas.map((p, i) => ({ ...p, repassada: i < 2 })), atual: 1 });
  assert.match(t, /2ª PARCELA \(recebida\)/);
  assert.match(t, /Já repassado: \*R\$\s?7\.000,00\*/);
  assert.match(t, /Ainda a receber: \*R\$\s?7\.000,00\*/);
});

test('sem Pix, sem processo e sem vara: as linhas somem, nada de "undefined"', () => {
  const t = textoPrestacaoContas({ ...DADOS, pix: '', banco: '', processo: null, vara: null });
  assert.doesNotMatch(t, /Pix:/);
  assert.doesNotMatch(t, /Processo:/);
  assert.doesNotMatch(t, /undefined|null/);
});

test('última parcela repassada: avisa que o acordo foi quitado', () => {
  const t = textoPrestacaoContas({ ...DADOS, parcelas: DADOS.parcelas.map((p) => ({ ...p, repassada: true })), atual: 3 });
  assert.match(t, /Acordo quitado/);
  assert.doesNotMatch(t, /Ainda a receber/);
});
