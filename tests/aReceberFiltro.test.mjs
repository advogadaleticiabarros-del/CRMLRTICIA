// tests/aReceberFiltro.test.mjs — A Receber: filtro por mês/período e totais do período
import { test } from 'node:test';
import assert from 'node:assert';
import { periodoDoMes, filtrarAReceber, kpisAReceber, marcarVencidos } from '../dist/services/aReceberFiltro.js';

const rows = [
  { fonte: 'parcela', cliente: 'Ana', descricao: '1ª parcela', valor: 100, vencimento: '2026-10-05', recebido: true, pago_em: '2026-10-04', vencido: false },
  { fonte: 'parcela', cliente: 'Ana', descricao: '2ª parcela', valor: 100, vencimento: '2026-11-05', recebido: false, pago_em: null, vencido: false },
  { fonte: 'exito', cliente: 'Bia', descricao: 'Alvará', valor: 1000, vencimento: '2026-09-20', recebido: true, pago_em: new Date('2026-10-02T13:00:00Z'), vencido: false },
  { fonte: 'lancamento', cliente: 'Caio', descricao: 'Consulta', valor: 50, vencimento: '2026-10-01', recebido: false, pago_em: null, vencido: true },
  { fonte: 'dativo', cliente: 'Davi', descricao: 'Honorário dativo', valor: 300, vencimento: null, recebido: false, pago_em: null, vencido: false },
];
const HOJE = '2026-10-07';

test('periodoDoMes: primeiro e último dia do mês (inclui fevereiro bissexto)', () => {
  assert.deepStrictEqual(periodoDoMes('2026-10'), { de: '2026-10-01', ate: '2026-10-31' });
  assert.deepStrictEqual(periodoDoMes('2028-02'), { de: '2028-02-01', ate: '2028-02-29' });
  assert.strictEqual(periodoDoMes('xx'), null);
});

test('período: recebido conta pela data em que o dinheiro ENTROU; a receber, pelo vencimento', () => {
  const r = filtrarAReceber(rows, { status: '', de: '2026-10-01', ate: '2026-10-31' }, HOJE);
  // o alvará venceu em setembro, mas entrou em 02/10 → é de outubro
  assert.deepStrictEqual(r.map((x) => x.descricao).sort(), ['1ª parcela', 'Alvará', 'Consulta']);
});

test('totais seguem o filtro: outubro', () => {
  const k = kpisAReceber(filtrarAReceber(rows, { status: '', de: '2026-10-01', ate: '2026-10-31' }, HOJE));
  assert.deepStrictEqual(k, { programado: 1150, recebido: 1100, a_receber: 50, vencido: 50, itens: 3 });
});

test('situação + origem + busca', () => {
  assert.deepStrictEqual(filtrarAReceber(rows, { status: 'aberto' }, HOJE).map((x) => x.descricao), ['2ª parcela', 'Consulta', 'Honorário dativo']);
  assert.deepStrictEqual(filtrarAReceber(rows, { status: 'recebido', fonte: 'exito' }, HOJE).map((x) => x.descricao), ['Alvará']);
  assert.deepStrictEqual(filtrarAReceber(rows, { status: '', busca: 'ana' }, HOJE).length, 2);
  assert.deepStrictEqual(filtrarAReceber(rows, { status: 'vencido' }, HOJE).map((x) => x.descricao), ['Consulta']);
});

test('sem data não entra quando há período; sem período, entra', () => {
  assert.ok(!filtrarAReceber(rows, { status: '', de: '2026-01-01', ate: '2026-12-31' }, HOJE).some((x) => x.fonte === 'dativo'));
  assert.ok(filtrarAReceber(rows, { status: '' }, HOJE).some((x) => x.fonte === 'dativo'));
});

test('marcarVencidos: vencimento vindo do banco como Date também conta (bug real: Vencido R$ 0,00)', () => {
  const r = marcarVencidos([
    { fonte: 'contrato', valor: 800, vencimento: new Date('2026-09-05T00:00:00Z'), recebido: false, vencido: false },
    { fonte: 'contrato', valor: 55, vencimento: '2026-09-20', recebido: false, vencido: false },
    { fonte: 'contrato', valor: 10, vencimento: new Date('2026-10-07T00:00:00Z'), recebido: false, vencido: false },
    { fonte: 'contrato', valor: 99, vencimento: new Date('2026-09-01T00:00:00Z'), recebido: true, vencido: false },
    { fonte: 'dativo', valor: 1, vencimento: null, recebido: false, vencido: false },
  ], '2026-10-07');
  assert.deepStrictEqual(r.map((x) => x.vencido), [true, true, false, false, false]);
});
