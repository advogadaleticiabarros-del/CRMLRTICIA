// tests/leadsFirstResponse.test.mjs
// Cronômetro de tempo de primeira resposta: leads.first_response_at é
// setado por 2 caminhos independentes (sair de 'triagem' via PATCH
// /:id/status, ou POST /:id/mark-response a partir do clique em "Chamar
// no WhatsApp") e nunca sobrescrito depois de preenchido. Ver
// docs/superpowers/specs/2026-08-25-cronometro-primeira-resposta-lead.md
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

test('sair de triagem seta first_response_at; permanecer em triagem não seta', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Cronômetro', '27999990000', 'site', 'triagem')`,
      [userId]
    );
    insertedIds.push(lead.insertId);

    const [antes] = await db.query('SELECT first_response_at FROM leads WHERE id = ?', [lead.insertId]);
    assert.strictEqual(antes[0].first_response_at, null, 'lead recém-criado não deveria ter first_response_at');

    // Sair de triagem → deve setar.
    const prev = { status: 'triagem' };
    const status = 'atendimento_inicial';
    const primeiraRespostaSql = (prev.status === 'triagem' && status !== 'triagem')
      ? ', first_response_at = COALESCE(first_response_at, NOW())' : '';
    await db.query(`UPDATE leads SET status = ?${primeiraRespostaSql} WHERE id = ?`, [status, lead.insertId]);

    const [depois] = await db.query('SELECT first_response_at, status FROM leads WHERE id = ?', [lead.insertId]);
    assert.strictEqual(depois[0].status, 'atendimento_inicial');
    assert.ok(depois[0].first_response_at, 'first_response_at deveria estar preenchido após sair de triagem');

    const primeiroTimestamp = depois[0].first_response_at;

    // Mudar de novo (atendimento_inicial → reuniao) NÃO deve sobrescrever
    // (a condição só dispara saindo de 'triagem').
    const prev2 = { status: 'atendimento_inicial' };
    const status2 = 'reuniao';
    const sql2 = (prev2.status === 'triagem' && status2 !== 'triagem')
      ? ', first_response_at = COALESCE(first_response_at, NOW())' : '';
    await db.query(`UPDATE leads SET status = ?${sql2} WHERE id = ?`, [status2, lead.insertId]);

    const [final] = await db.query('SELECT first_response_at FROM leads WHERE id = ?', [lead.insertId]);
    assert.deepStrictEqual(final[0].first_response_at, primeiroTimestamp, 'first_response_at não deveria mudar em transições subsequentes');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});

test('POST /:id/mark-response (query direta) seta first_response_at e não sobrescreve em 2ª chamada', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste WhatsApp', '27999990001', 'site', 'triagem')`,
      [userId]
    );
    insertedIds.push(lead.insertId);

    // Mesma query que a rota POST /:id/mark-response executa.
    await db.query('UPDATE leads SET first_response_at = COALESCE(first_response_at, NOW()) WHERE id = ?', [lead.insertId]);
    const [rows1] = await db.query('SELECT first_response_at, status FROM leads WHERE id = ?', [lead.insertId]);
    assert.ok(rows1[0].first_response_at, 'first_response_at deveria estar preenchido após mark-response');
    assert.strictEqual(rows1[0].status, 'triagem', 'mark-response não deve alterar o status do lead');

    const primeiroTimestamp = rows1[0].first_response_at;
    await new Promise((r) => setTimeout(r, 1100)); // garante NOW() diferente se sobrescrevesse
    await db.query('UPDATE leads SET first_response_at = COALESCE(first_response_at, NOW()) WHERE id = ?', [lead.insertId]);
    const [rows2] = await db.query('SELECT first_response_at FROM leads WHERE id = ?', [lead.insertId]);
    assert.deepStrictEqual(rows2[0].first_response_at, primeiroTimestamp, 'segunda chamada não deveria sobrescrever first_response_at');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
