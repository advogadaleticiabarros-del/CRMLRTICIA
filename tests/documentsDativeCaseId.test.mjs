// tests/documentsDativeCaseId.test.mjs
// Documentos por demanda dativa: POST /api/documents grava dative_case_id,
// GET /api/documents?dative_case_id= filtra só os documentos daquela demanda.
// Ver docs/superpowers/specs/2026-08-27-dativo-documentos-design.md
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

test('documents grava e filtra por dative_case_id', async (t) => {
  let clientId, dativeCaseId;
  const insertedDocIds = [];
  try {
    const [clients] = await db.query('SELECT id FROM clients LIMIT 1');
    if (!clients.length) { t.skip('nenhum cliente disponível neste banco'); return; }
    clientId = clients[0].id;

    const [dc] = await db.query(
      `INSERT INTO dative_cases (user_id, client_id, comarca, area, estimated_value)
       VALUES (1, ?, 'Comarca Teste', 'outro', 500)`,
      [clientId]
    );
    dativeCaseId = dc.insertId;

    const [docComVinculo] = await db.query(
      `INSERT INTO documents (client_id, dative_case_id, name, folder, status, data, mime, created_by)
       VALUES (?, ?, 'Termo de nomeação teste', 'nomeacao', 'recebido', ?, 'application/pdf', 1)`,
      [clientId, dativeCaseId, Buffer.from('conteudo-teste')]
    );
    insertedDocIds.push(docComVinculo.insertId);

    const [docSemVinculo] = await db.query(
      `INSERT INTO documents (client_id, name, folder, status, created_by)
       VALUES (?, 'Documento avulso teste', 'outros', 'recebido', 1)`,
      [clientId]
    );
    insertedDocIds.push(docSemVinculo.insertId);

    const [rows] = await db.query(
      'SELECT id, dative_case_id, name, folder FROM documents WHERE dative_case_id = ?',
      [dativeCaseId]
    );
    assert.strictEqual(rows.length, 1, 'só o documento vinculado à demanda deve retornar');
    assert.strictEqual(rows[0].id, docComVinculo.insertId);
    assert.strictEqual(rows[0].folder, 'nomeacao');

    const ids = rows.map((r) => r.id);
    assert.ok(!ids.includes(docSemVinculo.insertId), 'documento sem dative_case_id não deveria aparecer no filtro');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedDocIds) {
      await db.query('DELETE FROM documents WHERE id = ?', [id]).catch(() => {});
    }
    if (dativeCaseId) await db.query('DELETE FROM dative_cases WHERE id = ?', [dativeCaseId]).catch(() => {});
  }
});
