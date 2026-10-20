// tests/automacoesAprovacao.test.mjs — automações antigas a cliente viram rascunho (contra o banco; sem banco, pula).
// Desde 20/10/2026: acompanhamento de proposta e recusa não saem sozinhos; ficam
// em "Mensagens para aprovar" com o contexto e, quando há, os botões.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
const { db } = await import('../dist/config/database.js');
const { runPropostaFollowups, dispararRecusaProposta } = await import('../dist/services/propostaFollowupService.js');

async function bancoDisponivel() { try { await db.query('SELECT envio FROM atendente_rascunhos LIMIT 1'); return true; } catch { return false; } }
const FONE = '5527900000466';

test('acompanhamento de 48h e recusa: rascunho com contexto, nada enviado', async (t) => {
  if (!(await bancoDisponivel())) { t.skip('banco indisponível neste ambiente'); return; }
  const ids = {};
  try {
    const [[u]] = await db.query('SELECT id FROM users ORDER BY id LIMIT 1');
    if (!u) { t.skip('sem usuário no banco de teste'); return; }
    const [p] = await db.query(
      `INSERT INTO propostas (user_id, title, valor, status, contact_name, phone, public_token, enviada_em)
       VALUES (?, 'Proposta Teste Aprovação', 1000, 'enviada', 'Cliente Aprovação Teste', ?, 'tok-aprovacao-teste', NOW() - INTERVAL 49 HOUR)`,
      [u.id, FONE]);
    ids.proposta = p.insertId;

    await runPropostaFollowups();
    const [[pr]] = await db.query('SELECT followup_48h_at FROM propostas WHERE id = ?', [ids.proposta]);
    assert.ok(pr.followup_48h_at, 'o estágio de 48h fica cumprido (não repete amanhã)');
    const [r48] = await db.query("SELECT * FROM atendente_rascunhos WHERE phone = ? AND agente = 'automacao' AND status = 'pendente'", [FONE]);
    assert.equal(r48.length, 1);
    assert.match(r48[0].mensagem_cliente, /^CONTEXTO: Proposta enviada há 2 dias/);
    assert.match(r48[0].resposta, /tok-aprovacao-teste/, 'o lembrete leva o link da proposta');
    assert.equal(r48[0].envio, null, 'texto simples');

    await runPropostaFollowups();
    const [denovo] = await db.query("SELECT id FROM atendente_rascunhos WHERE phone = ? AND agente = 'automacao'", [FONE]);
    assert.equal(denovo.length, 1, 'rodar de novo não duplica');

    // Três dias depois: o lembrete de 5 dias tira da fila o de 48h que ninguém aprovou.
    await db.query('UPDATE propostas SET enviada_em = NOW() - INTERVAL 121 HOUR WHERE id = ?', [ids.proposta]);
    await runPropostaFollowups();
    const [fila] = await db.query("SELECT status, mensagem_cliente FROM atendente_rascunhos WHERE phone = ? AND agente = 'automacao' ORDER BY id", [FONE]);
    assert.deepEqual(fila.map((r) => r.status), ['substituida', 'pendente']);
    assert.match(fila[1].mensagem_cliente, /há 5 dias/);

    assert.equal(await dispararRecusaProposta({ propostaId: ids.proposta, leadId: null, clientId: null, phone: FONE,
      contactName: 'Cliente Aprovação Teste', motivo: 'A proposta foi marcada como recusada no CRM' }), true);
    const [[rec]] = await db.query("SELECT * FROM atendente_rascunhos WHERE phone = ? AND agente = 'automacao' AND resposta LIKE '%informativos%'", [FONE]);
    assert.match(rec.mensagem_cliente, /recusada no CRM \(proposta nº \d+\)/);
    const envio = typeof rec.envio === 'string' ? JSON.parse(rec.envio) : rec.envio;
    assert.equal(envio.tipo, 'botoes');
    assert.equal(envio.pendencia.tipo, 'newsletter_opt_in');
    const [pend] = await db.query('SELECT id FROM whatsapp_pending_replies WHERE phone = ?', [FONE]);
    assert.equal(pend.length, 0, 'a pendência só nasce quando a mensagem aprovada sair');
  } finally {
    await db.query('DELETE FROM atendente_rascunhos WHERE phone = ?', [FONE]).catch(() => {});
    await db.query('DELETE FROM whatsapp_pending_replies WHERE phone = ?', [FONE]).catch(() => {});
    if (ids.proposta) await db.query('DELETE FROM propostas WHERE id = ?', [ids.proposta]).catch(() => {});
  }
});
