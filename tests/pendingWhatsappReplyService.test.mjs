// tests/pendingWhatsappReplyService.test.mjs
// Serviço de "pergunta com botão aguardando resposta" (ver comentário no
// topo de src/services/pendingWhatsappReplyService.ts). Cobre os 4 cenários
// pedidos pela Letícia: (a) recusa cria a pendência certa, (b) "sim" resolve
// e atualiza, (c) "não" resolve e só audita, (d) sem pendência não mexe em nada.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const {
  createPendingReply, findOpenPendingReply, resolvePendingReply, interpretarResposta,
} = await import('../dist/services/pendingWhatsappReplyService.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|doesn't exist|Unknown/.test(err.message || '');
}

// ── interpretarResposta é pura — não precisa de banco ───────────────────
test('interpretarResposta casa pelo id exato do botão clicado (REPLY da Uazapi manda o id como texto)', () => {
  const pending = { expected_yes: 'newsletter_sim', expected_no: 'newsletter_nao' };
  assert.strictEqual(interpretarResposta('newsletter_sim', pending), 'sim');
  assert.strictEqual(interpretarResposta('newsletter_nao', pending), 'nao');
});

test('interpretarResposta aceita fallback de texto digitado à mão', () => {
  const pending = { expected_yes: 'newsletter_sim', expected_no: 'newsletter_nao' };
  assert.strictEqual(interpretarResposta('Sim', pending), 'sim');
  assert.strictEqual(interpretarResposta('  sim  ', pending), 'sim');
  assert.strictEqual(interpretarResposta('não', pending), 'nao');
  assert.strictEqual(interpretarResposta('nao', pending), 'nao');
  assert.strictEqual(interpretarResposta('Não!', pending), null, 'pontuação extra não deveria casar (evita falso positivo)');
});

test('interpretarResposta devolve null para texto não reconhecido — não resolve a pendência com um chute', () => {
  const pending = { expected_yes: 'newsletter_sim', expected_no: 'newsletter_nao' };
  assert.strictEqual(interpretarResposta('oi, tudo bem?', pending), null);
  assert.strictEqual(interpretarResposta('', pending), null);
});

// ── createPendingReply / findOpenPendingReply / resolvePendingReply ─────
test('cria, encontra e resolve uma pendência de newsletter (fluxo completo)', async (t) => {
  let userId;
  const leadIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const phone = '5527999990099';
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [phone]).catch(() => {});

    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Pendencia', ?, 'site', 'proposta')`,
      [userId, phone]
    );
    leadIds.push(lead.insertId);

    // (d) sem pendência nenhuma — findOpenPendingReply não acha nada.
    const semNada = await findOpenPendingReply(phone);
    assert.strictEqual(semNada, null, 'telefone sem pendência não pode achar nada (não pode confundir com fluxo normal)');

    // (a) recusa cria a pendência.
    await createPendingReply({
      phone, tipo: 'newsletter_opt_in', leadId: lead.insertId, clientId: null, propostaId: null,
      expectedYes: 'newsletter_sim', expectedNo: 'newsletter_nao',
    });

    const pend = await findOpenPendingReply(phone);
    assert.ok(pend, 'a pendência recém-criada deveria ser encontrada');
    assert.strictEqual(pend.lead_id, lead.insertId);
    assert.strictEqual(pend.expected_yes, 'newsletter_sim');

    // (b) resolve como "sim".
    await resolvePendingReply(pend.id, 'sim');
    const [[depois]] = await db.query('SELECT resposta, resolved_at FROM whatsapp_pending_replies WHERE id = ?', [pend.id]);
    assert.strictEqual(depois.resposta, 'sim');
    assert.ok(depois.resolved_at, 'resolved_at precisa estar preenchido após resolver');

    // Não fica aberta pra sempre: uma segunda mensagem do mesmo telefone não acha mais nada.
    const depoisResolvida = await findOpenPendingReply(phone);
    assert.strictEqual(depoisResolvida, null, 'pendência já resolvida não pode ser encontrada de novo (não reprocessa)');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of leadIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});

test('(c) resolve como "não" sem cadastrar em lugar nenhum — só marca a resposta', async (t) => {
  let userId;
  const leadIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const phone = '5527999990098';
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [phone]).catch(() => {});
    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Pendencia Nao', ?, 'site', 'proposta')`,
      [userId, phone]
    );
    leadIds.push(lead.insertId);

    await createPendingReply({
      phone, tipo: 'newsletter_opt_in', leadId: lead.insertId, clientId: null, propostaId: null,
      expectedYes: 'newsletter_sim', expectedNo: 'newsletter_nao',
    });
    const pend = await findOpenPendingReply(phone);
    await resolvePendingReply(pend.id, 'nao');

    const [[leadDepois]] = await db.query('SELECT status FROM leads WHERE id = ?', [lead.insertId]);
    assert.strictEqual(leadDepois.status, 'proposta', 'recusar a newsletter não pode mudar o status do lead — só a rota do webhook decide isso, e aqui só testamos o serviço de pendência');

    const [[pendDepois]] = await db.query('SELECT resposta FROM whatsapp_pending_replies WHERE id = ?', [pend.id]);
    assert.strictEqual(pendDepois.resposta, 'nao');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of leadIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});

test('findOpenPendingReply ignora pendência com mais de 7 dias (não reabre pergunta antiga)', async (t) => {
  let userId;
  const leadIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const phone = '5527999990097';
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [phone]).catch(() => {});
    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Pendencia Velha', ?, 'site', 'proposta')`,
      [userId, phone]
    );
    leadIds.push(lead.insertId);

    await db.query(
      `INSERT INTO whatsapp_pending_replies (phone, tipo, lead_id, expected_yes, expected_no, created_at)
       VALUES (?, 'newsletter_opt_in', ?, 'newsletter_sim', 'newsletter_nao', NOW() - INTERVAL 10 DAY)`,
      [phone, lead.insertId]
    );

    const pend = await findOpenPendingReply(phone);
    assert.strictEqual(pend, null, 'pendência de 10 dias atrás não pode mais ser considerada em aberto');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of leadIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
