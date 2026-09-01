// tests/cardStatementImport.test.mjs
// Fatura do Cartão: formato de CSV diferente do extrato da conta corrente
// (date,title,amount — valor em "1.234,56"/"- 150,00", sem Identificador
// único, títulos entre aspas com aspas/vírgulas escapadas dentro). Ver
// src/services/cardStatementService.ts — deliberadamente NÃO soma no
// saldo real (o valor da fatura já é uma saída no Extrato Consolidado).
import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/cardStatementService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const {
  parseCsvGeneric, parseCardCsv, importCardStatement, getCardSummary, getCardEntries, reviewCardEntry,
} = await import('../dist/services/cardStatementService.js');

function isDbUnavailable(err) { return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || ''); }
const MONTH = '2031-02'; // sintético, evita colidir com dados reais
async function cleanup(hashes) {
  if (!hashes.length) return;
  await db.query(`DELETE FROM card_statement_entries WHERE row_hash IN (${hashes.map(() => '?').join(',')})`, hashes).catch(() => {});
}

test('parseCsvGeneric: respeita aspas escapadas e vírgula dentro de campo com aspas', () => {
  const csv = 'date,title,amount\n2026-08-27,"Estorno de ""Ebn*Tiktok Sh"" (TikTok)","- 79,23"';
  const rows = parseCsvGeneric(csv);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[1], ['2026-08-27', 'Estorno de "Ebn*Tiktok Sh" (TikTok)', '- 79,23']);
});

test('parseCardCsv: valor em formato brasileiro (milhar com ponto, decimal com vírgula, negativo com espaço)', () => {
  const csv = 'date,title,amount\n2026-08-01,Pagamento recebido,"- 4.503,35"\n2026-08-13,Stilo Pet,"260,00"';
  const { rows } = parseCardCsv(csv, 'Nubank_2026-09-08.csv');
  assert.strictEqual(rows[0].amount, -4503.35);
  assert.strictEqual(rows[1].amount, 260);
});

test('parseCardCsv: mês de referência vem do nome do arquivo (data de vencimento)', () => {
  const csv = 'date,title,amount\n2026-08-01,X,"10,00"';
  const { billRefMonth } = parseCardCsv(csv, 'Nubank_2026-09-08.csv');
  assert.strictEqual(billRefMonth, '2026-09');
});

test('parseCardCsv: cabeçalho não reconhecido rejeita com mensagem clara', () => {
  assert.throws(() => parseCardCsv('a,b,c\n1,2,3'), /não reconhecido/);
});

test('importCardStatement: categoriza por regra, exclui pagamento/estorno do gasto, dedup funciona', async (t) => {
  const filename = `teste_${crypto.randomUUID()}.csv`;
  const csv = [
    'date,title,amount',
    '2031-02-05,Drogasil1520,"128,13"',
    '2031-02-06,Comerciante Nunca Visto Xyz,"50,00"',
    '2031-02-01,Pagamento recebido,"- 300,00"',
  ].join('\n');
  let hashes = [];
  try {
    const r1 = await importCardStatement(csv, filename, 1);
    assert.strictEqual(r1.imported, 3);
    assert.strictEqual(r1.pending, 1, 'só o comerciante desconhecido deveria ficar pendente');
    assert.strictEqual(r1.bill_ref_month, MONTH);

    const entries = await getCardEntries(MONTH);
    hashes = []; // limpar por bill_ref_month no finally, não por hash individual
    const drogasil = entries.find((e) => e.title === 'Drogasil1520');
    assert.strictEqual(drogasil.category, 'farmacia');
    assert.strictEqual(drogasil.review_status, 'ok');

    const pagamento = entries.find((e) => e.title === 'Pagamento recebido');
    assert.strictEqual(pagamento.category, 'pagamento_estorno');
    assert.strictEqual(pagamento.is_payment_or_refund, 1);

    const summary = await getCardSummary(MONTH);
    assert.strictEqual(summary.total_gasto, 178.13, 'só as 2 compras (128.13+50), sem o pagamento');
    assert.strictEqual(summary.total_pago_estornado, 300);
    assert.ok(!summary.por_categoria.some((c) => c.category === 'pagamento_estorno'), 'pagamento/estorno não deve aparecer no gasto por categoria');

    // reenviar o mesmo CSV não duplica
    const r2 = await importCardStatement(csv, filename, 1);
    assert.strictEqual(r2.imported, 0);
    assert.strictEqual(r2.duplicates, 3);
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await db.query('DELETE FROM card_statement_entries WHERE bill_ref_month = ?', [MONTH]).catch(() => {});
    await db.query('DELETE FROM card_statement_imports WHERE bill_ref_month = ?', [MONTH]).catch(() => {});
  }
});

test('reviewCardEntry: confirma categoria e opcionalmente salva regra pro comerciante', async (t) => {
  const marker = `TESTE MARCA ${crypto.randomUUID().slice(0, 8)}`;
  const csv = `date,title,amount\n2031-02-10,${marker},"42,00"`;
  try {
    await importCardStatement(csv, 'r.csv', 1);
    const entries = await getCardEntries(MONTH);
    const row = entries.find((e) => e.title === marker);
    assert.strictEqual(row.review_status, 'pendente');

    await reviewCardEntry(row.id, 'pet', true);
    const [rows2] = await db.query('SELECT category, review_status FROM card_statement_entries WHERE id = ?', [row.id]);
    assert.strictEqual(rows2[0].category, 'pet');
    assert.strictEqual(rows2[0].review_status, 'ok');

    const [rules] = await db.query('SELECT category FROM card_statement_rules WHERE match_value = ?', [marker]);
    assert.strictEqual(rules[0].category, 'pet');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await db.query('DELETE FROM card_statement_entries WHERE bill_ref_month = ?', [MONTH]).catch(() => {});
    await db.query('DELETE FROM card_statement_imports WHERE bill_ref_month = ?', [MONTH]).catch(() => {});
    await db.query('DELETE FROM card_statement_rules WHERE match_value = ?', [marker]).catch(() => {});
  }
});
