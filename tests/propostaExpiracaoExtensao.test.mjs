// tests/propostaExpiracaoExtensao.test.mjs
// Proposta expirada (7 dias) com botões "Preciso de mais tempo" / "Recusar"
// + extensão única de prazo + fechamento definitivo da 2ª janela. Ver
// especificação completa nos comentários de src/services/propostaFollowupService.ts
// (dispararPropostaExpirada, concederExtensaoPrazo, runFechamentoDefinitivoPropostas)
// e src/routes/whatsapp-webhook.ts (processarRespostaPropostaExpirada).
//
// Cobre os 5 cenários pedidos pela Letícia:
//  1) 7d dispara a mensagem com botão certo e cria a pendência certa;
//  2) "preciso de mais tempo" estende uma vez e volta status pra 'enviada';
//  3) 2ª tentativa de extensão (já usada) não estende de novo;
//  4) "recusar" no contexto de expirada segue o mesmo caminho da recusa normal;
//  5) o cron de fechamento definitivo fecha quem usou a extensão e sumiu de
//     novo, sem oferecer 3ª chance.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const followupSrc = fs.readFileSync(path.resolve('src/services/propostaFollowupService.ts'), 'utf8');
const webhookSrc = fs.readFileSync(path.resolve('src/routes/whatsapp-webhook.ts'), 'utf8');

function trecho(src, inicioRegex) {
  const m = src.match(inicioRegex);
  assert.ok(m, `trecho não encontrado: ${inicioRegex}`);
  return src.slice(m.index);
}

// ── (1) Cenário 7d: mensagem com botão certo + pendência certa (estático) ──

test('dispararPropostaExpirada manda sendMenu tipo button com os 2 botões certos e grava pendência tipo proposta_expirada', () => {
  const fn = trecho(followupSrc, /export async function dispararPropostaExpirada/);
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(bloco, /uazapi\.sendMenu\(/, 'deve usar uazapi.sendMenu para os botões nativos');
  assert.match(bloco, /'button'/, "o menu deve ser do tipo 'button'");
  assert.match(bloco, /PROPOSTA_EXPIRADA_BOTAO_MAIS_TEMPO_ID/, 'deve usar a constante do botão "mais tempo"');
  assert.match(bloco, /PROPOSTA_EXPIRADA_BOTAO_RECUSAR_ID/, 'deve usar a constante do botão "recusar"');
  assert.match(bloco, /createPendingReply\(/, 'deve gravar a pendência de confirmação');
  assert.match(bloco, /tipo:\s*'proposta_expirada'/, "o tipo da pendência deve ser 'proposta_expirada'");
});

test('runPropostaFollowups: estágio 7d chama dispararPropostaExpirada (não manda mais o aviso simples antigo)', () => {
  const fn = trecho(followupSrc, /export async function runPropostaFollowups/);
  const bloco = fn.slice(0, fn.indexOf('\nexport async function runFechamentoDefinitivoPropostas'));
  assert.match(bloco, /dispararPropostaExpirada\(/, 'o estágio de 7 dias deve chamar dispararPropostaExpirada');
  assert.doesNotMatch(bloco, /msg7d\(/, 'o aviso simples antigo (msg7d) não deve mais existir');
});

test('runPropostaFollowups: 7d só marca followup_7d_at e status=expirada se o envio deu certo (retry no dia seguinte se falhar)', () => {
  const fn = trecho(followupSrc, /export async function runPropostaFollowups/);
  const bloco = fn.slice(0, fn.indexOf('\nexport async function runFechamentoDefinitivoPropostas'));
  const idx = bloco.indexOf('dispararPropostaExpirada(');
  const trechoSeguinte = bloco.slice(idx, idx + 400);
  assert.match(trechoSeguinte, /if\s*\(ok\)\s*\{/, 'só deve persistir o estado se dispararPropostaExpirada retornou true');
  assert.match(trechoSeguinte, /status = 'expirada'/, 'mantém status=expirada no 7d, como já era antes');
});

// ── (4) "Recusar" no contexto de expirada segue o mesmo caminho da recusa normal (estático) ──

test('processarRespostaPropostaExpirada: resposta "nao" (Recusar) muda status para recusada e reaproveita dispararRecusaProposta', () => {
  const fn = trecho(webhookSrc, /async function processarRespostaPropostaExpirada/);
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  const idxElse = bloco.lastIndexOf('} else {');
  const ramoNao = bloco.slice(idxElse);
  assert.match(ramoNao, /UPDATE propostas SET status = 'recusada'/, 'recusar no contexto de expirada precisa marcar status=recusada, igual à recusa manual');
  assert.match(ramoNao, /dispararRecusaProposta\(/, 'deve reaproveitar a função compartilhada — não duplicar a mensagem de recusa');
});

test('processarRespostaPropostaExpirada: resposta "sim" (mais tempo) usa concederExtensaoPrazo (extensão única, guardada no banco)', () => {
  const fn = trecho(webhookSrc, /async function processarRespostaPropostaExpirada/);
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(bloco, /concederExtensaoPrazo\(/, 'deve usar a função que concede a extensão de forma atômica e única');
  assert.match(bloco, /msgPropostaMaisTempoJaUsada/, 'precisa ter uma mensagem específica para quando a extensão já foi usada antes (defensivo)');
  assert.match(bloco, /msgPropostaMaisTempoConfirmado/, 'precisa confirmar a extensão concedida');
});

// ── Integração com banco real (skip se indisponível, mesmo padrão dos outros testes) ──

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const {
  concederExtensaoPrazo, runFechamentoDefinitivoPropostas, fecharPropostaDefinitivamente,
} = await import('../dist/services/propostaFollowupService.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|doesn't exist|Unknown/.test(err.message || '');
}

async function criarProposta(userId, overrides = {}) {
  const [r] = await db.query(
    `INSERT INTO propostas (user_id, title, valor, status, contact_name, phone, prazo_estendido_em)
     VALUES (?, 'Proposta Teste Extensão', 1000, ?, 'Cliente Teste', '5527999990199', ?)`,
    [userId, overrides.status ?? 'enviada', overrides.prazoEstendidoEm ?? null]
  );
  return r.insertId;
}

// (2) + (3) concederExtensaoPrazo: 1ª vez estende, 2ª vez não estende de novo.
test('concederExtensaoPrazo: 1ª chamada estende (status volta para enviada) — 2ª chamada não estende de novo', async (t) => {
  let userId;
  const propostaIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const propostaId = await criarProposta(userId, { status: 'expirada' });
    propostaIds.push(propostaId);

    // (2) 1ª vez: concede a extensão.
    const primeira = await concederExtensaoPrazo(propostaId);
    assert.strictEqual(primeira, true, 'a 1ª extensão deve ser concedida');

    const [[depois1]] = await db.query(
      'SELECT status, prazo_estendido_em FROM propostas WHERE id = ?', [propostaId]
    );
    assert.strictEqual(depois1.status, 'enviada', 'status deve voltar para enviada após conceder a extensão');
    assert.ok(depois1.prazo_estendido_em, 'prazo_estendido_em deve ficar preenchido');
    const prazoOriginal = depois1.prazo_estendido_em;

    // (3) 2ª vez (extensão já usada): não concede de novo.
    const segunda = await concederExtensaoPrazo(propostaId);
    assert.strictEqual(segunda, false, 'a 2ª tentativa de extensão não pode ser concedida de novo (extensão de uso único)');

    const [[depois2]] = await db.query(
      'SELECT prazo_estendido_em FROM propostas WHERE id = ?', [propostaId]
    );
    assert.deepStrictEqual(depois2.prazo_estendido_em, prazoOriginal, 'prazo_estendido_em não pode mudar numa 2ª tentativa');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of propostaIds) await db.query('DELETE FROM propostas WHERE id = ?', [id]).catch(() => {});
  }
});

// (5) Fechamento definitivo: fecha quem usou a extensão e sumiu de novo (7+ dias depois),
// mas NÃO mexe em quem ainda está dentro da 2ª janela, nem em quem nunca usou a extensão.
test('runFechamentoDefinitivoPropostas: fecha (expirada) quem usou a extensão e sumiu 7+ dias, sem tocar nos demais', async (t) => {
  let userId;
  const propostaIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    // Candidata ao fechamento: extensão usada há 8 dias, ainda 'enviada' (sumiu de novo).
    const [rOld] = await db.query(
      `INSERT INTO propostas (user_id, title, valor, status, contact_name, phone, prazo_estendido_em)
       VALUES (?, 'Proposta Extensão Vencida', 1000, 'enviada', 'Cliente A', '5527999990198', NOW() - INTERVAL 8 DAY)`,
      [userId]
    );
    const idFechar = rOld.insertId;
    propostaIds.push(idFechar);

    // NÃO deve fechar: extensão usada há só 3 dias (ainda dentro da 2ª janela).
    const [rRecent] = await db.query(
      `INSERT INTO propostas (user_id, title, valor, status, contact_name, phone, prazo_estendido_em)
       VALUES (?, 'Proposta Extensão Recente', 1000, 'enviada', 'Cliente B', '5527999990197', NOW() - INTERVAL 3 DAY)`,
      [userId]
    );
    propostaIds.push(rRecent.insertId);

    // NÃO deve fechar: nunca usou a extensão (prazo_estendido_em NULL).
    const semExtensao = await criarProposta(userId, { status: 'enviada', prazoEstendidoEm: null });
    propostaIds.push(semExtensao);

    // NÃO deve fechar: extensão vencida, mas já foi aceita nesse meio tempo.
    const [rAceita] = await db.query(
      `INSERT INTO propostas (user_id, title, valor, status, contact_name, phone, prazo_estendido_em)
       VALUES (?, 'Proposta Extensão Vencida Mas Aceita', 1000, 'aceita', 'Cliente C', '5527999990196', NOW() - INTERVAL 8 DAY)`,
      [userId]
    );
    propostaIds.push(rAceita.insertId);

    const resultado = await runFechamentoDefinitivoPropostas();
    assert.ok(resultado.fechadas >= 1, 'deve ter fechado ao menos a proposta candidata');

    const [[fechada]] = await db.query('SELECT status FROM propostas WHERE id = ?', [idFechar]);
    assert.strictEqual(fechada.status, 'expirada', 'a proposta candidata deve fechar como expirada (nunca recusada — ela não disse não)');

    const [[recente]] = await db.query('SELECT status FROM propostas WHERE id = ?', [rRecent.insertId]);
    assert.strictEqual(recente.status, 'enviada', 'proposta ainda dentro da 2ª janela não pode ser fechada ainda (sem oferecer 3ª chance cedo demais)');

    const [[semExt]] = await db.query('SELECT status FROM propostas WHERE id = ?', [semExtensao]);
    assert.strictEqual(semExt.status, 'enviada', 'proposta que nunca usou a extensão não é candidata a este fechamento (é papel do cron de 7d normal)');

    const [[aceita]] = await db.query('SELECT status FROM propostas WHERE id = ?', [rAceita.insertId]);
    assert.strictEqual(aceita.status, 'aceita', 'proposta já aceita não pode ser reaberta/fechada por este cron');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of propostaIds) await db.query('DELETE FROM propostas WHERE id = ?', [id]).catch(() => {});
  }
});

test('fecharPropostaDefinitivamente marca status=expirada (nunca recusada, isolado do envio de mensagem)', async (t) => {
  let userId;
  const propostaIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const propostaId = await criarProposta(userId, { status: 'enviada' });
    propostaIds.push(propostaId);

    await fecharPropostaDefinitivamente(propostaId);
    const [[depois]] = await db.query('SELECT status FROM propostas WHERE id = ?', [propostaId]);
    assert.strictEqual(depois.status, 'expirada');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of propostaIds) await db.query('DELETE FROM propostas WHERE id = ?', [id]).catch(() => {});
  }
});
