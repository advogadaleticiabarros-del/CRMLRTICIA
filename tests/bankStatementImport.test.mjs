// tests/bankStatementImport.test.mjs
// Extrato Consolidado: importa o CSV mensal do Nubank, categoriza por
// regras aprendidas (bank_statement_rules) e grava como cashflow_entries
// reais, com dedup por Identificador e fila de revisão para o
// novo/ambíguo. Ver migrations/126_bank_statement_import.sql e
// src/services/bankStatementService.ts.
import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const {
  parseNubankCsv, importStatement, getConsolidatedSummary, getPendentes,
  saveRuleFromReview, RuleConflictError,
} = await import('../dist/services/bankStatementService.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

// Mês sintético e improvável de colidir com dados reais de produção/dev.
const MONTH = '2031-01';
const uid = () => crypto.randomUUID();

function csv(rows) {
  return 'Data,Valor,Identificador,Descrição\n' + rows.map((r) => r.join(',')).join('\n');
}

async function cleanup(refs) {
  if (!refs.length) return;
  await db.query(`DELETE FROM cashflow_entries WHERE bank_ref IN (${refs.map(() => '?').join(',')})`, refs).catch(() => {});
}

test('parseNubankCsv: rejeita cabeçalho não reconhecido e CSV vazio', () => {
  assert.throws(() => parseNubankCsv('Coluna1,Coluna2\n1,2'), /não reconhecido/);
  assert.throws(() => parseNubankCsv(''), /vazio/);
});

test('parseNubankCsv: ignora linha sem Identificador em vez de derrubar o import', () => {
  const { rows, warnings } = parseNubankCsv(csv([
    ['01/01/2031', '100.00', '', 'Sem identificador'],
    ['02/01/2031', '50.00', uid(), 'Com identificador'],
  ]));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0].reason, /Identificador/);
});

test('parseNubankCsv: descrição com vírgula não quebra o parse (último campo)', () => {
  const id = uid();
  const { rows } = parseNubankCsv(csv([
    ['03/01/2031', '-20.00', id, 'Compra no débito - Loja, Bairro, Cidade'],
  ]));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].descricao, 'Compra no débito - Loja, Bairro, Cidade');
});

test('importStatement: dedup — reenviar o mesmo CSV não duplica', async (t) => {
  const refs = [uid(), uid()];
  try {
    const text = csv([
      ['05/01/2031', '100.00', refs[0], 'Teste dedup A'],
      ['05/01/2031', '-30.00', refs[1], 'Teste dedup B'],
    ]);
    const [rows1] = await db.query('SELECT 1 FROM cashflow_entries LIMIT 1').catch((e) => { throw e; });
    const r1 = await importStatement(text, 'teste.csv', 1);
    assert.strictEqual(r1.imported, 2);
    assert.strictEqual(r1.duplicates, 0);

    const r2 = await importStatement(text, 'teste.csv', 1);
    assert.strictEqual(r2.imported, 0, 'segunda importação não deve inserir nada novo');
    assert.strictEqual(r2.duplicates, 2);

    const [count] = await db.query(
      `SELECT COUNT(*) AS n FROM cashflow_entries WHERE bank_ref IN (?, ?)`, refs) ;
    assert.strictEqual(count[0].n, 2, 'não pode haver linhas duplicadas na tabela');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await cleanup(refs);
  }
});

test('importStatement: upload parcial — só a linha nova entra', async (t) => {
  const refs = [uid(), uid()];
  try {
    const first = csv([['06/01/2031', '10.00', refs[0], 'Já importada antes']]);
    await importStatement(first, 'a.csv', 1);

    const second = csv([
      ['06/01/2031', '10.00', refs[0], 'Já importada antes'],
      ['07/01/2031', '20.00', refs[1], 'Nova linha'],
    ]);
    const r = await importStatement(second, 'b.csv', 1);
    assert.strictEqual(r.imported, 1);
    assert.strictEqual(r.duplicates, 1);
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await cleanup(refs);
  }
});

test('regra sem ambiguidade categoriza automaticamente (review_status=ok)', async (t) => {
  const ref = uid();
  const ruleValue = `TESTE UNAMBIGUO ${ref.slice(0, 8)}`;
  try {
    await db.query(
      `INSERT INTO bank_statement_rules (match_type, match_value, type, category, escopo) VALUES ('counterparty', ?, 'entrada', 'correspondente', 'empresa')`,
      [ruleValue]
    );
    const text = csv([['08/01/2031', '150.00', ref, `Transferência recebida pelo Pix - ${ruleValue}`]]);
    await importStatement(text, 'c.csv', 1);
    const [rows] = await db.query('SELECT * FROM cashflow_entries WHERE bank_ref = ?', [ref]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].review_status, 'ok');
    assert.strictEqual(rows[0].category, 'correspondente');
    assert.strictEqual(rows[0].escopo, 'empresa');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await cleanup([ref]);
    await db.query('DELETE FROM bank_statement_rules WHERE match_value = ?', [ruleValue]).catch(() => {});
  }
});

test('contraparte ambígua (2 regras) cai em pendências com os candidatos', async (t) => {
  const ref = uid();
  const ruleValue = `TESTE AMBIGUO ${ref.slice(0, 8)}`;
  try {
    await db.query(
      `INSERT INTO bank_statement_rules (match_type, match_value, type, category, escopo) VALUES
        ('counterparty', ?, 'saida', 'pessoal', 'pessoal'),
        ('counterparty', ?, 'saida', 'cartao', 'empresa')`,
      [ruleValue, ruleValue]
    );
    const text = csv([['09/01/2031', '-40.00', ref, `Transferência enviada pelo Pix - ${ruleValue}`]]);
    const r = await importStatement(text, 'd.csv', 1);
    assert.strictEqual(r.pending, 1);

    const [rows] = await db.query('SELECT * FROM cashflow_entries WHERE bank_ref = ?', [ref]);
    assert.strictEqual(rows[0].review_status, 'pendente');

    const mine = (await getPendentes()).find((p) => p.id === rows[0].id);
    assert.ok(mine, 'linha deveria aparecer em getPendentes()');
    assert.strictEqual(mine.candidates.length, 2, 'deveria sugerir as 2 categorias cadastradas');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await cleanup([ref]);
    await db.query('DELETE FROM bank_statement_rules WHERE match_value = ?', [ruleValue]).catch(() => {});
  }
});

test('RDB fica fora de entradas/saídas reais, mas entra na Reserva RDB', async (t) => {
  const refAporte = uid();
  const refResgate = uid();
  try {
    const text = csv([
      [`10/01/2031`, '-500.00', refAporte, 'Aplicação RDB'],
      [`11/01/2031`, '300.00', refResgate, 'Resgate RDB'],
    ]);
    await importStatement(text, 'e.csv', 1);

    const [testRows] = await db.query('SELECT amount, type, is_transferencia_interna, review_status FROM cashflow_entries WHERE bank_ref IN (?, ?)', [refAporte, refResgate]);
    assert.ok(testRows.every((r) => r.is_transferencia_interna === 1), 'linhas de RDB devem estar marcadas como transferência interna');
    // Regressão: "Aplicação RDB" e "Resgate RDB" contêm "RDB" nos dois
    // sentidos — sem filtrar a regra pela direção (entrada/saída) real da
    // transação, as duas regras colidiam e TODO lançamento de RDB virava
    // "pendente" em vez de categorizar automaticamente (aconteceu em
    // produção antes desse teste existir).
    assert.ok(testRows.every((r) => r.review_status === 'ok'), 'RDB deveria categorizar automaticamente (regra sem ambiguidade), não cair em pendências');

    // Filtra pelo marcador único "RDB" no counterparty pra isolar só essas
    // 2 linhas de teste, mesmo num banco com outros dados no mesmo mês.
    const summary = await getConsolidatedSummary(MONTH, { counterparty: 'RDB' });
    assert.strictEqual(summary.kpis.entradas_reais, 0, 'resgate RDB não deveria contar em entradas reais');
    assert.strictEqual(summary.kpis.saidas_reais, 0, 'aplicação RDB não deveria contar em saídas reais');
    assert.strictEqual(summary.kpis.reserva_rdb.aportes, 500);
    assert.strictEqual(summary.kpis.reserva_rdb.resgates, 300);
    assert.strictEqual(summary.kpis.reserva_rdb.saldo, 200, 'saldo = quanto a reserva cresceu (aportes − resgates); 500 aportado − 300 resgatado = guardou 200 a mais');
    assert.strictEqual(summary.por_categoria.length, 0, 'RDB não deveria aparecer em por_categoria');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await cleanup([refAporte, refResgate]);
  }
});

test('saveRuleFromReview: conflito exige force_ambiguous, não sobrescreve silenciosamente', async (t) => {
  const ref = uid();
  const counterparty = `TESTE CONFLITO ${ref.slice(0, 8)}`;
  try {
    await db.query(
      `INSERT INTO bank_statement_rules (match_type, match_value, type, category, escopo) VALUES ('counterparty', ?, 'saida', 'pessoal', 'pessoal')`,
      [counterparty]
    );
    const [ins] = await db.query(
      `INSERT INTO cashflow_entries (type, category, description, amount, due_date, status, paid_at, escopo, bank_ref, counterparty, origin, review_status)
       VALUES ('saida', 'outro_saida', 'Teste conflito', 25.00, ?, 'realizado', ?, 'empresa', ?, ?, 'extrato_nubank', 'pendente')`,
      [`${MONTH}-12`, `${MONTH}-12`, ref, counterparty]
    );

    await assert.rejects(
      () => saveRuleFromReview({ id: ins.insertId, category: 'cartao', escopo: 'empresa', saveAsRule: true, userId: 1 }),
      RuleConflictError
    );

    const result = await saveRuleFromReview({ id: ins.insertId, category: 'cartao', escopo: 'empresa', saveAsRule: true, forceAmbiguous: true, userId: 1 });
    assert.strictEqual(result.rule_created, true);

    const [rules] = await db.query(
      `SELECT category FROM bank_statement_rules WHERE match_type='counterparty' AND match_value = ? ORDER BY category`, [counterparty]);
    assert.deepStrictEqual(rules.map((r) => r.category).sort(), ['cartao', 'pessoal']);
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    await cleanup([ref]);
    await db.query('DELETE FROM bank_statement_rules WHERE match_value = ?', [counterparty]).catch(() => {});
  }
});
