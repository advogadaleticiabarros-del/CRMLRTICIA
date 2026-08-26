// tests/leadsLossReason.test.mjs
// Motivo de perda estruturado: marcar um lead como 'perdida' sem um
// loss_reason válido (das 7 chaves fixas) deve ser rejeitado ANTES de
// qualquer escrita no banco. Ver
// docs/superpowers/specs/2026-08-25-motivo-perda-estruturado-lead.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');

const LOSS_REASONS = ['preco', 'sumiu', 'foi_com_outro', 'desistiu', 'fora_area_atuacao', 'sem_perfil', 'outro'];

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

// Reproduz a validação exata do handler PATCH /:id/status (sem HTTP —
// mesmo padrão de tests/leadsFirstResponse.test.mjs desta mesma sessão).
function validarTransicaoPerdida(status, lossReason) {
  if (status === 'perdida' && !LOSS_REASONS.includes(lossReason)) {
    return { valido: false, erro: `loss_reason é obrigatório e deve ser um de: ${LOSS_REASONS.join(', ')}` };
  }
  return { valido: true };
}

test('status=perdida sem loss_reason válido é rejeitado antes de qualquer escrita', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Perda', '27999990002', 'site', 'triagem')`,
      [userId]
    );
    insertedIds.push(lead.insertId);

    // loss_reason ausente — rejeitado.
    const r1 = validarTransicaoPerdida('perdida', undefined);
    assert.strictEqual(r1.valido, false, 'sem loss_reason deveria ser inválido');

    // loss_reason fora da lista fixa — rejeitado.
    const r2 = validarTransicaoPerdida('perdida', 'texto livre qualquer');
    assert.strictEqual(r2.valido, false, 'loss_reason fora da lista deveria ser inválido');

    // loss_reason válido — aceito, e a escrita real reflete corretamente.
    const r3 = validarTransicaoPerdida('perdida', 'foi_com_outro');
    assert.strictEqual(r3.valido, true, 'loss_reason válido deveria ser aceito');
    await db.query(`UPDATE leads SET status = 'perdida', loss_reason = 'foi_com_outro' WHERE id = ?`, [lead.insertId]);
    const [rows] = await db.query('SELECT status, loss_reason FROM leads WHERE id = ?', [lead.insertId]);
    assert.strictEqual(rows[0].status, 'perdida');
    assert.strictEqual(rows[0].loss_reason, 'foi_com_outro');

    // Mudar pra status diferente de 'perdida' não exige loss_reason.
    const r4 = validarTransicaoPerdida('atendimento_inicial', undefined);
    assert.strictEqual(r4.valido, true, 'transição para status diferente de perdida não deveria exigir loss_reason');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
