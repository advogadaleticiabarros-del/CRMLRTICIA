// tests/tabelaOabRj.test.mjs — referência de honorários da OAB/RJ para as propostas
import { test } from 'node:test';
import assert from 'node:assert';
import { ITENS_OAB_RJ, referenciaOab, textoReferencia } from '../dist/services/tabelaOabRj.js';
import { valoresDeTabela, mensagemAprovacao } from '../dist/services/esteiraComercial.js';

test('itens: todos com código, mínimo e sugestão coerentes (sugestão nunca abaixo do mínimo)', () => {
  assert.ok(ITENS_OAB_RJ.length >= 15);
  for (const i of ITENS_OAB_RJ) {
    assert.match(i.codigo, /^\d+\.\d+/);
    assert.ok(i.minimo > 0 && i.sugerido >= i.minimo, i.codigo);
  }
});

test('referenciaOab: trabalhista do reclamante é percentual com mínimo de R$ 1.000 (item 14.11)', () => {
  const r = referenciaOab('trabalhista', 'horas extras e verbas rescisórias');
  assert.strictEqual(r.codigo, '14.11');
  assert.strictEqual(r.tipo, 'percentual');
  assert.strictEqual(r.minimo, 1000);
  assert.strictEqual(referenciaOab('gestante', '').codigo, '14.11');
  assert.strictEqual(referenciaOab('trabalhista', 'acidente de trabalho com sequela').codigo, '14.18');
});

test('referenciaOab: escolhe o item pelo assunto dentro da área', () => {
  assert.strictEqual(referenciaOab('previdenciario', 'auxílio-doença negado').codigo, '13.29');
  assert.strictEqual(referenciaOab('previdenciario', 'salário-maternidade').codigo, '13.28');
  assert.strictEqual(referenciaOab('previdenciario', 'revisão da aposentadoria').codigo, '13.30');
  assert.strictEqual(referenciaOab('previdenciario', 'BPC LOAS para idoso').codigo, '13.26');
  assert.strictEqual(referenciaOab('familia', 'divórcio litigioso').codigo, '12.2c');
  assert.strictEqual(referenciaOab('familia', 'pensão alimentícia para os filhos').codigo, '12.12');
  assert.strictEqual(referenciaOab('familia', 'regulamentar visitas').codigo, '12.21');
  assert.strictEqual(referenciaOab('consumidor', 'cartão RMC').codigo, '16.3');
  assert.strictEqual(referenciaOab('civel', 'juizado especial').codigo, '8.1');
  assert.strictEqual(referenciaOab('outro', 'qualquer coisa'), null);
});

test('valoresDeTabela: sem tabela da Dra., usa a OAB/RJ (antes do histórico)', () => {
  const hist = [{ area: 'previdenciario', total: 900, entrada: 300, parcelas: 2 }];
  const fixo = valoresDeTabela('previdenciario', hist, {}, referenciaOab('previdenciario', 'auxílio-doença'));
  assert.strictEqual(fixo.origem, 'oab_rj');
  assert.strictEqual(fixo.total, 3000);
  assert.strictEqual(fixo.entrada, 1000, '1/3 no início (art. 22, §3º, do Estatuto)');
  assert.strictEqual(fixo.exito, 30);
  const pct = valoresDeTabela('trabalhista', [], {}, referenciaOab('trabalhista', ''));
  assert.strictEqual(pct.origem, 'oab_rj');
  assert.strictEqual(pct.total, 0, 'reclamante: só êxito, com o mínimo da tabela');
  const daDra = valoresDeTabela('previdenciario', hist, { previdenciario: { total: 4000, entrada: 1000, parcelas: 3, exito: 30 } }, referenciaOab('previdenciario', ''));
  assert.strictEqual(daDra.origem, 'tabela');
});

test('textoReferencia e mensagemAprovacao mostram o item da OAB/RJ', () => {
  const r = referenciaOab('trabalhista', '');
  const t = textoReferencia(r);
  assert.match(t, /OAB\/RJ 14\.11/);
  assert.match(t, /R\$ 1\.000,00/);
  const m = mensagemAprovacao({ id: 1, nome: 'Fulana', area: 'trabalhista', tipoCausa: null, resumo: null, exito: 30,
    parcelamento: { total: 0, entrada: 0, parcelas: 0, valor_parcela: 0, ultima_parcela: 0 }, origem: 'oab_rj', referencia: t });
  assert.match(m, /OAB\/RJ 14\.11/);
});
