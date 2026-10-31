// tests/danoMoralPadrao.test.mjs — dano moral padrão (Jessica, 31/10/2026: "coloque o padrão de
// dano moral 10.000,00 para todas as peças desse mesmo perfil"). Perfil: descontos de banco no
// benefício do INSS (empréstimo consignado e cartão consignado RMC/RCC).
import { test } from 'node:test';
import assert from 'node:assert';
import { danoMoralPadrao, DANO_MORAL_PADRAO, calcularPeca } from '../dist/services/pecaCalculos.js';
import { blocoCalculos } from '../dist/services/pecaDossie.js';

test('R$ 10.000,00 para empréstimo consignado e cartão consignado; nada para outras teses', () => {
  assert.strictEqual(DANO_MORAL_PADRAO, 10000);
  assert.strictEqual(danoMoralPadrao(['emprestimo_consignado']), 10000);
  assert.strictEqual(danoMoralPadrao(['cartao_consignado']), 10000);
  assert.strictEqual(danoMoralPadrao([null, 'cartao_consignado']), 10000);
  assert.strictEqual(danoMoralPadrao(['emprestimo_pessoal']), null);
  assert.strictEqual(danoMoralPadrao([]), null);
});

test('sem descontos apurados, o valor da causa leva o dano moral padrão e [valor a apurar]', () => {
  const c = calcularPeca({ contratos: [], descontos: [], danoMoral: 10000, hoje: new Date(2026, 9, 31) });
  const b = blocoCalculos(c);
  assert.match(b, /VALOR DA CAUSA: \[valor a apurar\] \+ R\$ 10\.000,00/);
  assert.match(b, /DANO MORAL: pedir R\$ 10\.000,00/);
  assert.doesNotMatch(b, /\[valor do dano moral\]/);
});
