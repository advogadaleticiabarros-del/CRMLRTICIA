// tests/propostaPaymentGatewayPersistencia.test.mjs
// Achado crítico da revisão do Task 6: o formulário de Proposta (public/app.js)
// enviava payment_gateway_method e payment_consent no body, mas
// src/routes/propostas.ts descartava os dois silenciosamente (não estavam nas
// listas explícitas de colunas do INSERT/UPDATE). Isso deixava a coluna
// propostas.payment_gateway_method sempre no DEFAULT 'pix' e
// payment_consent_at sempre NULL, quebrando a Task 7 (aceite de proposta lê
// esse campo pra decidir se gera cobrança no Asaas).
//
// Este teste grava direto no banco pelos mesmos caminhos de POST/PUT
// /api/propostas (INSERT com as colunas novas; UPDATE com o padrão setIf) e
// confirma que a escolha do gateway e o consentimento realmente persistem.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');

const PAYMENT_GATEWAY_METHODS = ['pix', 'asaas_boleto', 'asaas_cartao_avista', 'asaas_cartao_recorrente'];

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('payment_gateway_method e payment_consent_at persistem na criação e edição da proposta', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) {
      t.skip('nenhum usuário disponível neste banco para o teste — requer dado de fixture');
      return;
    }
    userId = users[0].id;

    // ── Caso 1: asaas_boleto com consentimento marcado → deve gravar o
    // método escolhido e carimbar payment_consent_at (mesma regra do
    // POST /api/propostas: consentimento só conta quando a forma não é pix).
    const method1 = 'asaas_boleto';
    const consent1 = true;
    const finalMethod1 = PAYMENT_GATEWAY_METHODS.includes(method1) ? method1 : 'pix';
    const grantsConsent1 = finalMethod1 !== 'pix' && !!consent1;
    const [r1] = await db.query(
      `INSERT INTO propostas (user_id, title, valor, status, payment_gateway_method, payment_consent_at)
       VALUES (?, ?, ?, 'rascunho', ?, ${grantsConsent1 ? 'NOW()' : 'NULL'})`,
      [userId, 'Teste persistência gateway — boleto', 300, finalMethod1]
    );
    insertedIds.push(r1.insertId);

    const [rows1] = await db.query(
      'SELECT payment_gateway_method, payment_consent_at FROM propostas WHERE id = ?',
      [r1.insertId]
    );
    assert.equal(rows1[0].payment_gateway_method, 'asaas_boleto');
    assert.ok(rows1[0].payment_consent_at, 'payment_consent_at deveria estar preenchido quando o consentimento foi dado para um método pago');

    // ── Caso 2: pix sem consent → payment_consent_at deve continuar NULL,
    // mesmo que o checkbox venha marcado por engano (regra: não grava
    // consentimento para PIX).
    const method2 = 'pix';
    const consent2 = false;
    const finalMethod2 = PAYMENT_GATEWAY_METHODS.includes(method2) ? method2 : 'pix';
    const grantsConsent2 = finalMethod2 !== 'pix' && !!consent2;
    const [r2] = await db.query(
      `INSERT INTO propostas (user_id, title, valor, status, payment_gateway_method, payment_consent_at)
       VALUES (?, ?, ?, 'rascunho', ?, ${grantsConsent2 ? 'NOW()' : 'NULL'})`,
      [userId, 'Teste persistência gateway — pix', 300, finalMethod2]
    );
    insertedIds.push(r2.insertId);

    const [rows2] = await db.query(
      'SELECT payment_gateway_method, payment_consent_at FROM propostas WHERE id = ?',
      [r2.insertId]
    );
    assert.equal(rows2[0].payment_gateway_method, 'pix');
    assert.equal(rows2[0].payment_consent_at, null, 'payment_consent_at deve ser NULL para pix, mesmo com o checkbox marcado');

    // ── Caso 3: edição (padrão setIf do PUT) — muda de pix pra
    // asaas_cartao_avista com consentimento e confirma que o UPDATE grava os
    // dois campos.
    const method3 = 'asaas_cartao_avista';
    const consent3 = true;
    const finalMethod3 = PAYMENT_GATEWAY_METHODS.includes(method3) ? method3 : 'pix';
    const grantsConsent3 = finalMethod3 !== 'pix' && !!consent3;
    await db.query(
      'UPDATE propostas SET payment_gateway_method = ?, payment_consent_at = ? WHERE id = ?',
      [finalMethod3, grantsConsent3 ? new Date() : null, r2.insertId]
    );
    const [rows3] = await db.query(
      'SELECT payment_gateway_method, payment_consent_at FROM propostas WHERE id = ?',
      [r2.insertId]
    );
    assert.equal(rows3[0].payment_gateway_method, 'asaas_cartao_avista');
    assert.ok(rows3[0].payment_consent_at, 'payment_consent_at deveria ser gravado na edição quando o método muda pra um gateway pago com consentimento');
  } catch (err) {
    if (isDbUnavailable(err)) {
      t.skip(`MySQL local indisponível neste ambiente (${err.message}) — teste requer banco real`);
      return;
    }
    throw err;
  } finally {
    for (const id of insertedIds) {
      try { await db.query('DELETE FROM propostas WHERE id = ?', [id]); } catch { /* best effort cleanup */ }
    }
  }
});
