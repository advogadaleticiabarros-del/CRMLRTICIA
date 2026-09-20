// tests/dativeCaseRejection.test.mjs
// Status "recusada" em dative_cases: aceita o valor no ENUM, guarda motivo/data/
// status anterior, e reverter limpa esses campos e restaura o status anterior.
// Ver docs/manual/05-dativo.md e migrations/131_dative_case_recusada_status.sql
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('dative_cases aceita status recusada com motivo, e reverter restaura o status anterior', async (t) => {
  let clientId, dativeCaseId;
  try {
    const [clients] = await db.query('SELECT id FROM clients LIMIT 1');
    if (!clients.length) { t.skip('nenhum cliente disponível neste banco'); return; }
    clientId = clients[0].id;

    const [dc] = await db.query(
      `INSERT INTO dative_cases (user_id, client_id, comarca, area, estimated_value, status)
       VALUES (1, ?, 'Comarca Teste', 'outro', 500, 'nomeada')`,
      [clientId]
    );
    dativeCaseId = dc.insertId;

    // Recusa: grava motivo, data e o status de onde veio (mesmo padrão de
    // cases.production_stage = 'recusado' — ver POST /api/dative/cases/:id/reject).
    await db.query(
      `UPDATE dative_cases SET status = 'recusada', status_before_rejection = 'nomeada',
              rejection_reason = 'Conflito de interesse', rejected_at = NOW() WHERE id = ?`,
      [dativeCaseId]
    );
    const [[recusada]] = await db.query(
      'SELECT status, rejection_reason, status_before_rejection, rejected_at FROM dative_cases WHERE id = ?',
      [dativeCaseId]
    );
    assert.strictEqual(recusada.status, 'recusada');
    assert.strictEqual(recusada.rejection_reason, 'Conflito de interesse');
    assert.strictEqual(recusada.status_before_rejection, 'nomeada');
    assert.ok(recusada.rejected_at, 'rejected_at deve ser preenchido');

    // Reverter: volta pro status anterior e limpa os campos de recusa.
    await db.query(
      `UPDATE dative_cases SET status = ?, status_before_rejection = NULL,
              rejection_reason = NULL, rejected_at = NULL WHERE id = ?`,
      [recusada.status_before_rejection, dativeCaseId]
    );
    const [[revertida]] = await db.query(
      'SELECT status, rejection_reason, status_before_rejection, rejected_at FROM dative_cases WHERE id = ?',
      [dativeCaseId]
    );
    assert.strictEqual(revertida.status, 'nomeada');
    assert.strictEqual(revertida.rejection_reason, null);
    assert.strictEqual(revertida.status_before_rejection, null);
    assert.strictEqual(revertida.rejected_at, null);
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    if (dativeCaseId) await db.query('DELETE FROM dative_cases WHERE id = ?', [dativeCaseId]).catch(() => {});
  }
});
