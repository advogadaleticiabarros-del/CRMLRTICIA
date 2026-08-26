// tests/cashflowRepasses.test.mjs
// Contas a Pagar só lia cashflow_entries (lançamentos manuais) — repasses a
// parceiros, que já existem no sistema, nunca entravam no total de "Saídas
// do mês". Este teste grava repasses reais e confirma que
// buscarRepassesComoSaida() os retorna no formato e sob as regras exatas
// do spec: docs/superpowers/specs/2026-08-25-contas-a-pagar-repasses-unificado.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const { buscarRepassesComoSaida } = await import('../dist/routes/cashflow.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('buscarRepassesComoSaida traz pendente/processando, exclui repassado/cancelado', async (t) => {
  let caseId;
  const insertedRepasseIds = [];
  try {
    const [cases] = await db.query('SELECT id FROM cases LIMIT 1');
    if (!cases.length) { t.skip('nenhum caso disponível neste banco para vincular o repasse de teste'); return; }
    caseId = cases[0].id;

    const [rPendente] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, descricao, status, data_vencimento)
       VALUES (?, 'Parceiro Teste Pendente', 'indicacao', 321.50, 'Repasse de teste pendente', 'pendente', '2026-08-20')`,
      [caseId]
    );
    insertedRepasseIds.push(rPendente.insertId);

    const [rProcessando] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, descricao, status, data_vencimento)
       VALUES (?, 'Parceiro Teste Processando', 'audiencia', 150.00, 'Repasse de teste processando', 'processando', '2026-08-21')`,
      [caseId]
    );
    insertedRepasseIds.push(rProcessando.insertId);

    const [rRepassado] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, descricao, status, data_vencimento, data_repasse)
       VALUES (?, 'Parceiro Teste Repassado', 'indicacao', 99.00, 'Repasse já pago', 'repassado', '2026-08-22', NOW())`,
      [caseId]
    );
    insertedRepasseIds.push(rRepassado.insertId);

    const rows = await buscarRepassesComoSaida('2026-08-01', '2026-08-31');
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(`repasse:${rPendente.insertId}`), 'repasse pendente deveria aparecer');
    assert.ok(ids.includes(`repasse:${rProcessando.insertId}`), 'repasse processando deveria aparecer');
    assert.ok(!ids.includes(`repasse:${rRepassado.insertId}`), 'repasse já repassado NÃO deveria aparecer');

    const linhaPendente = rows.find((r) => r.id === `repasse:${rPendente.insertId}`);
    assert.strictEqual(linhaPendente.type, 'saida');
    assert.strictEqual(linhaPendente.category, 'repasse_parceiro');
    assert.strictEqual(linhaPendente.escopo, 'empresa');
    assert.strictEqual(Number(linhaPendente.amount), 321.5);
    assert.strictEqual(linhaPendente.status, 'previsto');
    assert.ok(linhaPendente.description.includes('Parceiro Teste Pendente'));
    assert.strictEqual(linhaPendente.pagador, null);
    assert.strictEqual(linhaPendente.banco, null);

    // Fora da janela from/to — não deve aparecer.
    const rowsForaDaJanela = await buscarRepassesComoSaida('2026-01-01', '2026-01-31');
    const idsForaDaJanela = rowsForaDaJanela.map((r) => r.id);
    assert.ok(!idsForaDaJanela.includes(`repasse:${rPendente.insertId}`), 'repasse fora da janela de datas não deveria aparecer');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedRepasseIds) {
      await db.query('DELETE FROM repasses WHERE id = ?', [id]).catch(() => {});
    }
  }
});
