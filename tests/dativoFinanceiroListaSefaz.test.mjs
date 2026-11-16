// Dativo no financeiro (pedido da Dra., 16/11/2026): "só vai para financeiro a partir do
// momento que estiver na lista do Sefaz... coloque em disponível para recebimento, mas
// sem o dia, e mantenha acumulado, até irmos retirar e colocar como recebido."
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { filtrarAReceber, kpisAReceber, marcarVencidos } from '../dist/services/aReceberFiltro.js';

const disponivel = (valor, extra = {}) => ({
  fonte: 'dativo_caso', cliente: 'Estado (dativo)', descricao: 'Na lista da Sefaz', valor,
  vencimento: null, recebido: false, pago_em: null, vencido: false, disponivel: true, ...extra,
});
const rows = [
  disponivel(800),
  disponivel(1200),
  { fonte: 'parcela', cliente: 'Ana', descricao: '2ª parcela', valor: 100, vencimento: '2026-11-05', recebido: false, pago_em: null, vencido: false },
  { fonte: 'dativo', cliente: 'Davi', descricao: 'Sem data', valor: 300, vencimento: null, recebido: false, pago_em: null, vencido: false },
  // já sacado: conta pela data em que entrou, como qualquer recebido
  disponivel(500, { recebido: true, pago_em: '2026-10-20' }),
];

test('disponível para saque aparece em qualquer mês até ser recebido (acumulado)', () => {
  for (const mes of [{ de: '2026-11-01', ate: '2026-11-30' }, { de: '2027-03-01', ate: '2027-03-31' }]) {
    const r = filtrarAReceber(rows, { status: 'aberto', ...mes });
    assert.deepStrictEqual(r.filter((x) => x.disponivel).map((x) => x.valor), [800, 1200], JSON.stringify(mes));
  }
  // item sem data que NÃO é "disponível" continua fora do filtro de mês
  assert.ok(!filtrarAReceber(rows, { de: '2026-11-01', ate: '2026-11-30' }).some((x) => x.descricao === 'Sem data'));
  // depois de recebido, segue a data do recebimento
  assert.ok(filtrarAReceber(rows, { status: 'recebido', de: '2026-10-01', ate: '2026-10-31' }).some((x) => x.valor === 500));
  assert.ok(!filtrarAReceber(rows, { status: 'recebido', de: '2026-11-01', ate: '2026-11-30' }).some((x) => x.valor === 500));
});

test('total "disponível para saque" soma só o que está na lista e ainda não foi retirado', () => {
  const k = kpisAReceber(filtrarAReceber(rows, { de: '2026-11-01', ate: '2026-11-30' }));
  assert.strictEqual(k.disponivel, 2000);
  assert.strictEqual(k.a_receber, 2100);
});

test('disponível sem data nunca fica vencido', () => {
  marcarVencidos(rows, '2027-01-01');
  assert.ok(rows.filter((x) => x.disponivel).every((x) => !x.vencido));
});

test('montagem: nomeação dativa só entra quando está na lista da Sefaz, sem vencimento, com o arbitrado', () => {
  const src = fs.readFileSync('src/services/aReceberMontar.ts', 'utf8');
  const bloco = src.slice(src.indexOf('const [datCasos]'), src.indexOf('const [corr]'));
  assert.match(bloco, /dc\.status = 'a_receber'/);
  assert.doesNotMatch(bloco, /NOT IN \('paga'/);
  assert.match(bloco, /COALESCE\(dc\.arbitrated_value, dc\.estimated_value\)/);
  assert.match(bloco, /vencimento: null/);
  assert.match(bloco, /disponivel: true/);
  // recebimento previsto ligado a demanda só entra se a demanda estiver na lista
  const dat = src.slice(src.indexOf('const [dat]'), src.indexOf('const [datCasos]'));
  assert.match(dat, /dp\.status = 'recebido' OR dc\.id IS NULL OR dc\.status = 'a_receber'/);
});

test('resumo financeiro: dativo previsto só da lista da Sefaz', () => {
  const src = fs.readFileSync('src/services/financeSummary.ts', 'utf8');
  const bloco = src.slice(src.indexOf('const dativoCasos'), src.indexOf('dativo.prev ='));
  assert.match(bloco, /dc\.status = 'a_receber'/);
  assert.match(bloco, /COALESCE\(dc\.arbitrated_value, dc\.estimated_value\)/);
});

test('tela do A Receber: selo "disponível para recebimento", sem data, e total acumulado', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const tela = app.slice(app.indexOf('async function finReceitas('), app.indexOf('async function finReceitas(') + 16000);
  assert.match(tela, /disponível para recebimento/);
  assert.match(tela, /x\.disponivel/);
  assert.match(tela, /k\.disponivel/);
  assert.match(tela, /dativo_caso: 'Dativo \(lista da Sefaz\)'/);
});
