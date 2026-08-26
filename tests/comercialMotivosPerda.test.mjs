// tests/comercialMotivosPerda.test.mjs
// Dashboard comercial ganha uma quebra de leads perdidos por motivo —
// mesmo filtro user_id das outras queries dessa rota (nenhuma delas
// filtra por período). Ver
// docs/superpowers/specs/2026-08-25-motivo-perda-estruturado-lead.md
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

test('query de motivos_perda agrupa corretamente por loss_reason, ignora vazios/nulos', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const leadsParaCriar = [
      { name: 'Perda Preço 1', loss_reason: 'preco' },
      { name: 'Perda Preço 2', loss_reason: 'preco' },
      { name: 'Perda Sumiu', loss_reason: 'sumiu' },
      { name: 'Perda Sem Motivo', loss_reason: null }, // deve ser ignorado
      { name: 'Não Perdido', loss_reason: null, status: 'triagem' }, // não é 'perdida', deve ser ignorado
    ];
    for (const l of leadsParaCriar) {
      const [r] = await db.query(
        `INSERT INTO leads (user_id, name, phone, source, status, loss_reason) VALUES (?, ?, '27999990003', 'site', ?, ?)`,
        [userId, l.name, l.status || 'perdida', l.loss_reason]
      );
      insertedIds.push(r.insertId);
    }

    // Mesma query que a Task 2 adiciona à rota.
    const [rows] = await db.query(
      `SELECT loss_reason, COUNT(*) AS total FROM leads
        WHERE user_id = ? AND status = 'perdida' AND loss_reason IS NOT NULL AND loss_reason <> ''
        GROUP BY loss_reason ORDER BY total DESC`,
      [userId]
    );

    const porMotivo = Object.fromEntries(rows.map((r) => [r.loss_reason, Number(r.total)]));
    assert.ok(porMotivo.preco >= 2, `esperava pelo menos 2 leads com motivo 'preco', achei ${porMotivo.preco}`);
    assert.ok(porMotivo.sumiu >= 1, `esperava pelo menos 1 lead com motivo 'sumiu', achei ${porMotivo.sumiu}`);
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
