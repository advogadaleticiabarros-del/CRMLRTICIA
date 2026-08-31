// tests/pendingWhatsappReminder.test.mjs
// Lembrete de 24h pra pendência de WhatsApp sem resposta (ver comentário no
// topo de src/services/pendingWhatsappReminderService.ts). Cobre os 3
// cenários pedidos pela Letícia: (a) pendência com mais de 24h, sem resposta
// e sem lembrete ainda → dispara e marca reminder_sent_at; (b) pendência já
// resolvida OU já com lembrete mandado → não dispara de novo; (c) pendência
// com menos de 24h → ainda não dispara.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const { findPendingRepliesNeedingReminder, markReminderSent } =
  await import('../dist/services/pendingWhatsappReplyService.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|doesn't exist|Unknown/.test(err.message || '');
}

async function criarPendencia(phone, { leadId, horasAtras, resolvedAt, reminderSentAt }) {
  await db.query(
    `INSERT INTO whatsapp_pending_replies
       (phone, tipo, lead_id, expected_yes, expected_no, created_at, resolved_at, reminder_sent_at)
     VALUES (?, 'newsletter_opt_in', ?, 'newsletter_sim', 'newsletter_nao',
             NOW() - INTERVAL ? HOUR, ?, ?)`,
    [phone, leadId, horasAtras, resolvedAt ? new Date() : null, reminderSentAt ? new Date() : null]
  );
}

test('findPendingRepliesNeedingReminder: pendência há mais de 24h, sem resposta e sem lembrete ainda, entra na lista', async (t) => {
  let userId;
  const leadIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const phone = '5527999990096';
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [phone]).catch(() => {});
    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Lembrete', ?, 'site', 'proposta')`,
      [userId, phone]
    );
    leadIds.push(lead.insertId);

    await criarPendencia(phone, { leadId: lead.insertId, horasAtras: 30 });

    const pendentes = await findPendingRepliesNeedingReminder();
    const achou = pendentes.find((p) => p.phone === phone);
    assert.ok(achou, 'pendência de 30h atrás, sem resposta e sem lembrete, deveria precisar de lembrete');
    assert.strictEqual(achou.expected_yes, 'newsletter_sim');
    assert.strictEqual(achou.nome, 'Lead Teste Lembrete', 'deve trazer o nome do lead pra compor a mensagem');

    // Depois de marcar o lembrete como enviado, some da lista (não dispara 2x).
    await markReminderSent(achou.id);
    const [[depois]] = await db.query(
      'SELECT reminder_sent_at FROM whatsapp_pending_replies WHERE id = ?', [achou.id]
    );
    assert.ok(depois.reminder_sent_at, 'reminder_sent_at precisa estar preenchido após markReminderSent');

    const pendentesDepois = await findPendingRepliesNeedingReminder();
    assert.ok(!pendentesDepois.some((p) => p.id === achou.id), 'pendência já lembrada não pode aparecer de novo');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of leadIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});

test('findPendingRepliesNeedingReminder: pendência já resolvida não recebe lembrete', async (t) => {
  let userId;
  const leadIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const phone = '5527999990095';
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [phone]).catch(() => {});
    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Lembrete Resolvida', ?, 'site', 'proposta')`,
      [userId, phone]
    );
    leadIds.push(lead.insertId);

    await criarPendencia(phone, { leadId: lead.insertId, horasAtras: 30, resolvedAt: true });

    const pendentes = await findPendingRepliesNeedingReminder();
    assert.ok(!pendentes.some((p) => p.phone === phone), 'pendência já resolvida não pode gerar lembrete');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of leadIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});

test('findPendingRepliesNeedingReminder: pendência com menos de 24h ainda não dispara lembrete', async (t) => {
  let userId;
  const leadIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const phone = '5527999990094';
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [phone]).catch(() => {});
    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Lembrete Recente', ?, 'site', 'proposta')`,
      [userId, phone]
    );
    leadIds.push(lead.insertId);

    await criarPendencia(phone, { leadId: lead.insertId, horasAtras: 2 });

    const pendentes = await findPendingRepliesNeedingReminder();
    assert.ok(!pendentes.some((p) => p.phone === phone), 'pendência de 2h atrás ainda não deve receber lembrete (só depois de 24h)');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of leadIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});

test('findPendingRepliesNeedingReminder: pendência com mais de 7 dias não recebe lembrete (webhook já não considera mais)', async (t) => {
  let userId;
  const leadIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const phone = '5527999990093';
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [phone]).catch(() => {});
    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Lembrete Velha', ?, 'site', 'proposta')`,
      [userId, phone]
    );
    leadIds.push(lead.insertId);

    await criarPendencia(phone, { leadId: lead.insertId, horasAtras: 24 * 10 });

    const pendentes = await findPendingRepliesNeedingReminder();
    assert.ok(!pendentes.some((p) => p.phone === phone), 'pendência de 10 dias já fora da janela de 7 dias não deve receber lembrete');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of leadIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
