// tests/juntarProcessos.test.mjs — quando pedidos do mesmo cliente viram UM processo.
// Regra da Jessica (22/10/2026): mesmo cliente + mesmo banco + mesma família de tese.
// Cartão consignado (RMC/RCC), empréstimo consignado (inclui refinanciamento e
// portabilidade), empréstimo pessoal e cartão comum são famílias diferentes:
// nunca juntam entre si, mesmo contra o mesmo réu. Juros abusivos são pedido dentro da peça.
import { test } from 'node:test';
import assert from 'node:assert';
import { familiaDaTese, reuDoTitulo, sugestoesDeJuncao, casosCorrelatos } from '../dist/services/pecaConsolidacao.js';

test('familiaDaTese classifica o pedido pela tese', () => {
  assert.strictEqual(familiaDaTese('RCC — Banco PAN'), 'cartao_consignado');
  assert.strictEqual(familiaDaTese('RMC + juros abusivos'), 'cartao_consignado');
  assert.strictEqual(familiaDaTese('Cartão de crédito consignado oferecido como empréstimo'), 'cartao_consignado');
  assert.strictEqual(familiaDaTese('Empréstimo consignado não contratado'), 'emprestimo_consignado');
  assert.strictEqual(familiaDaTese('Refinanciamento do consignado'), 'emprestimo_consignado');
  assert.strictEqual(familiaDaTese('Portabilidade sem autorização'), 'emprestimo_consignado');
  assert.strictEqual(familiaDaTese('Empréstimo pessoal + juros abusivos'), 'emprestimo_pessoal');
  assert.strictEqual(familiaDaTese('Crédito pessoal com juros abusivos'), 'emprestimo_pessoal');
  assert.strictEqual(familiaDaTese('Cartão não solicitado — anuidade indevida'), 'cartao_comum');
  assert.strictEqual(familiaDaTese('Reclamação trabalhista'), null);
  assert.strictEqual(familiaDaTese(''), null);
});

test('reuDoTitulo lê o banco depois do travessão, do "x" ou do "contra"', () => {
  assert.strictEqual(reuDoTitulo('RCC — Banco PAN'), 'Banco PAN');
  assert.strictEqual(reuDoTitulo('RMC - Facta Financeira'), 'Facta Financeira');
  assert.strictEqual(reuDoTitulo('Empréstimo consignado x Banco BMG S.A.'), 'Banco BMG S.A.');
  assert.strictEqual(reuDoTitulo('Revisional contra Itaú Consignado'), 'Itaú Consignado');
  assert.strictEqual(reuDoTitulo('empréstimo consignado'), null);
});

const c = (id, titulo, extra = {}) => ({ id, client_id: 7, cliente: 'Cliente Teste', legal_area: 'consumidor', production_stage: 'em_analise', titulo, partes: [], unido_ao_caso: null, ...extra });

test('sugestoesDeJuncao: junta só mesma família e mesmo banco; pessoal e consignado ficam separados', () => {
  const s = sugestoesDeJuncao([
    c(1, 'RCC — Banco PAN'),
    c(2, 'RMC — Banco Pan S.A.'),
    c(3, 'Empréstimo consignado — Banco PAN'),
    c(4, 'Refinanciamento — Banco PAN'),
    c(5, 'Empréstimo pessoal — Banco PAN'),
    c(6, 'RMC — Facta Financeira'),
    c(7, 'Empréstimo consignado', { partes: [{ nome: 'BANCO PAN' }] }),
    c(8, 'RCC — Banco PAN', { client_id: 9 }),
    c(9, 'RCC — Banco PAN', { production_stage: 'protocolado' }),
    c(10, 'RCC — Banco PAN', { unido_ao_caso: 1 }),
  ]);
  const grupos = s.map((g) => ({ familia: g.familia, ids: g.casos.map((x) => x.id).sort((a, b) => a - b) }));
  assert.deepStrictEqual(grupos, [
    { familia: 'cartao_consignado', ids: [1, 2] },
    { familia: 'emprestimo_consignado', ids: [3, 4, 7] },
  ]);
  assert.strictEqual(s[0].reu, 'Banco PAN');
});

test('sugestoesDeJuncao: o card que já é processo (tem pedidos unidos) entra como principal', () => {
  const s = sugestoesDeJuncao([c(1, 'RCC — Banco PAN'), c(5, 'RMC — Banco PAN', { pedidos_unidos: 1 })]);
  assert.strictEqual(s[0].principal, 5);
});

test('casosCorrelatos: família diferente não junta, mesmo banco', () => {
  const alvo = { id: 1, client_id: 7, legal_area: 'consumidor', production_stage: 'criacao_inicial', familia: 'emprestimo_consignado', partes: [{ nome: 'Banco PAN' }] };
  const outros = [
    { id: 2, client_id: 7, legal_area: 'consumidor', production_stage: 'em_analise', familia: 'emprestimo_pessoal', partes: [{ nome: 'Banco PAN' }] },
    { id: 3, client_id: 7, legal_area: 'consumidor', production_stage: 'em_analise', familia: 'emprestimo_consignado', partes: [{ nome: 'Banco PAN' }] },
    { id: 4, client_id: 7, legal_area: 'consumidor', production_stage: 'em_analise', familia: null, partes: [{ nome: 'Banco PAN' }] },
  ];
  assert.deepStrictEqual(casosCorrelatos(alvo, outros).map((x) => x.id), [3]);
});
