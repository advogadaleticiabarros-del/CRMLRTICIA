// tests/fechamentoRpvParceriaBanco.test.mjs — Fechamento de parceria com RPV no banco
// real (CI: banco do zero). Confere a migration 177 e as consultas do repositório:
// receita paga, repasse repassado, caso encerrado, reaproveitamento do "Êxito"
// pendente e salvar de novo sem duplicar. Dados fictícios, apagados no fim.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const { registrarFechamentoRpv } = await import('../dist/services/fechamentoRpvParceria.js');
const { repoFechamentoMysql, lerFechamento, ligarComprovante } = await import('../dist/services/fechamentoRpvParceriaMysql.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('fechamento no banco: receita, repasse, caso encerrado e sem duplicar', async (t) => {
  let partnerId, clientId, caseId;
  try {
    const [[u]] = await db.query('SELECT id FROM users ORDER BY id LIMIT 1');
    if (!u) { t.skip('banco sem usuário'); return; }
    const [p] = await db.query(`INSERT INTO partners (name, success_fee_percent, partner_split_percent) VALUES ('Parceira Fictícia RPV', 30, 50)`);
    partnerId = p.insertId;
    const [cl] = await db.query(`INSERT INTO clients (user_id, name) VALUES (?, 'Cliente Fictícia RPV')`, [u.id]);
    clientId = cl.insertId;
    const [cs] = await db.query(
      `INSERT INTO cases (user_id, client_id, partner_id, title, case_number, status) VALUES (?, ?, ?, 'RPV teste', '0000001-00.2025.4.02.5001', 'ativo')`,
      [u.id, clientId, partnerId]);
    caseId = cs.insertId;
    // "Êxito" já lançado pelo botão antigo: pendente e sem data.
    const [rec] = await db.query(
      `INSERT INTO financial_records (user_id, client_id, case_id, tipo, description, valor, status, due_date)
       VALUES (?, ?, ?, 'receita', 'Êxito (30% sobre R$ 10000.00) — Cliente Fictícia RPV', 3000, 'pendente', NULL)`, [u.id, clientId, caseId]);
    const [rep] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, percentual, descricao, status, data_vencimento)
       VALUES (?, 'Parceira Fictícia RPV', 'indicacao', 1500, 50, 'Repasse êxito — Cliente Fictícia RPV', 'pendente', NULL)`, [caseId]);

    const out = await registrarFechamentoRpv(repoFechamentoMysql, { caseId, userId: u.id, valorSacado: 10000, dataSaque: '2026-11-10', dataRepasse: '2026-11-11' });
    assert.strictEqual(out.divisao.valorRepasse, 8500);

    const [recs] = await db.query(`SELECT id, valor, status, DATE_FORMAT(due_date, '%Y-%m-%d') AS d FROM financial_records WHERE case_id = ? AND tipo = 'receita'`, [caseId]);
    assert.strictEqual(recs.length, 1, 'reaproveitou a receita pendente, sem duplicar');
    assert.strictEqual(recs[0].id, rec.insertId);
    assert.strictEqual(Number(recs[0].valor), 3000);
    assert.strictEqual(recs[0].status, 'pago');
    assert.strictEqual(recs[0].d, '2026-11-10');

    const [reps] = await db.query('SELECT id, valor, status FROM repasses WHERE case_id = ?', [caseId]);
    assert.strictEqual(reps.length, 1);
    assert.strictEqual(reps[0].id, rep.insertId);
    assert.strictEqual(reps[0].status, 'repassado');

    const [[c]] = await db.query('SELECT status, resultado, valor_obtido FROM cases WHERE id = ?', [caseId]);
    assert.strictEqual(c.status, 'encerrado');
    assert.strictEqual(c.resultado, 'procedente');
    assert.strictEqual(Number(c.valor_obtido), 10000);

    // Salvar de novo com valor corrigido: mesmo fechamento, mesmos lançamentos.
    await registrarFechamentoRpv(repoFechamentoMysql, { caseId, userId: u.id, valorSacado: 9000, valorCliente: 6300 });
    const [[n]] = await db.query(`SELECT
        (SELECT COUNT(*) FROM parceria_fechamentos WHERE case_id = ?) AS f,
        (SELECT COUNT(*) FROM financial_records WHERE case_id = ? AND tipo = 'receita') AS r,
        (SELECT COUNT(*) FROM repasses WHERE case_id = ?) AS p`, [caseId, caseId, caseId]);
    assert.deepStrictEqual([Number(n.f), Number(n.r), Number(n.p)], [1, 1, 1]);
    const f = await lerFechamento(caseId);
    assert.strictEqual(Number(f.valor_cliente), 6300);
    assert.strictEqual(Number(f.valor_escritorio), 1350);

    // Comprovante ligado ao fechamento.
    const [doc] = await db.query(`INSERT INTO documents (client_id, case_id, name, file_url, status) VALUES (?, ?, 'Recibo', 'https://exemplo.invalid/r', 'recebido')`, [clientId, caseId]);
    assert.strictEqual(await ligarComprovante(caseId, 'recibo', doc.insertId), true);
    assert.strictEqual((await lerFechamento(caseId)).recibo_url, 'https://exemplo.invalid/r');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível: ${err.message}`); return; }
    throw err;
  } finally {
    try {
      if (caseId) {
        await db.query('DELETE FROM financial_records WHERE case_id = ?', [caseId]);
        await db.query('DELETE FROM repasses WHERE case_id = ?', [caseId]);
        await db.query('DELETE FROM client_timeline WHERE case_id = ?', [caseId]).catch(() => {});
        await db.query('DELETE FROM documents WHERE case_id = ?', [caseId]);
        await db.query('DELETE FROM cases WHERE id = ?', [caseId]);
      }
      if (clientId) await db.query('DELETE FROM clients WHERE id = ?', [clientId]);
      if (partnerId) await db.query('DELETE FROM partners WHERE id = ?', [partnerId]);
    } catch { /* banco indisponível */ }
  }
});

