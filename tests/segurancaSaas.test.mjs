// tests/segurancaSaas.test.mjs — padrão de segurança (23/11/2026)
// senha forte, sessão derrubável, aceite de termos, passes temporários que não valem login.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { problemaDaSenha, gerarSenhaTemporaria, BCRYPT_CUSTO } from '../dist/services/senhaForte.js';
import { criarVerificadorSessao } from '../dist/services/sessaoUsuario.js';
import { TERMOS_VERSAO, rotaLiberadaSemAceite, precisaAceitar } from '../dist/services/termos.js';
import { authenticate, signToken } from '../dist/middleware/auth.js';
import { env } from '../dist/config/env.js';

// ── Senha ──
test('senha: recusa curtas, sem mistura, comuns, sequências e com nome/e-mail', () => {
  assert.match(problemaDaSenha('Ab1!'), /10 caracteres/);
  assert.match(problemaDaSenha('abcdefghijk'), /3 tipos/);
  assert.match(problemaDaSenha('Senha@2026'), /comum/);
  assert.match(problemaDaSenha('P4ssw0rd!!'), /comum/);
  assert.match(problemaDaSenha('Leticia#2026'), /comum/);
  assert.match(problemaDaSenha('Xk9!12345zz'), /sequ/);
  assert.match(problemaDaSenha('Qz8#aaaaWm'), /sequ|repet/);
  assert.match(problemaDaSenha('Mariana#77xq', { nome: 'Mariana Souza' }), /nome/);
  assert.match(problemaDaSenha('Jcardoso!9qz', { email: 'jcardoso@gmail.com' }), /nome|e-mail/);
  assert.ok(problemaDaSenha(undefined));
  assert.ok(problemaDaSenha('A1!' + 'x'.repeat(130)));
});

test('senha: aceita forte e frase longa', () => {
  assert.strictEqual(problemaDaSenha('Vt7#rio-Camb!', { nome: 'Ana Lima', email: 'ana@x.com' }), null);
  assert.strictEqual(problemaDaSenha('cafe com pao na praia de camburi'), null);
});

test('senha temporária: criptográfica, 14 caracteres, passa na própria política, não repete', () => {
  const vistas = new Set();
  for (let i = 0; i < 200; i++) {
    const s = gerarSenhaTemporaria();
    assert.strictEqual(s.length, 14);
    assert.strictEqual(problemaDaSenha(s), null, s);
    vistas.add(s);
  }
  assert.strictEqual(vistas.size, 200);
  assert.ok(BCRYPT_CUSTO >= 12);
});

test('nenhuma rota grava senha com bcrypt custo 10 nem com a regra antiga de 8 caracteres', () => {
  for (const f of ['auth.ts', 'users.ts', 'cases.ts']) {
    const src = fs.readFileSync(new URL(`../src/routes/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /bcrypt\.hash\([^)]*,\s*10\)/, `${f} ainda usa custo 10`);
    assert.doesNotMatch(src, /length\s*<\s*8/, `${f} ainda usa a regra de 8 caracteres`);
    assert.doesNotMatch(src, /Math\.random\(\)\.toString\(36\)/, `${f} gera senha com Math.random`);
  }
});

// ── Sessão ──
test('sessão: ativo com versão certa passa; inativo, versão velha ou inexistente caem', async () => {
  const banco = { 1: { ativo: true, versao: 0, termosVersao: null }, 2: { ativo: false, versao: 0, termosVersao: null }, 3: { ativo: true, versao: 2, termosVersao: null } };
  const v = criarVerificadorSessao(async (id) => banco[id] ?? null);
  assert.strictEqual((await v.verificar(1, undefined)).ok, true, 'token antigo sem versão = 0');
  assert.deepStrictEqual(await v.verificar(2, 0), { ok: false, motivo: 'inativo' });
  assert.deepStrictEqual(await v.verificar(3, 1), { ok: false, motivo: 'encerrada' });
  assert.strictEqual((await v.verificar(3, 2)).ok, true);
  assert.deepStrictEqual(await v.verificar(99, 0), { ok: false, motivo: 'inexistente' });
});

test('sessão: guarda 30 s em memória; esquecer() força ler de novo (desativação vale na hora)', async () => {
  let agora = 0; let leituras = 0;
  const banco = { 1: { ativo: true, versao: 0, termosVersao: null } };
  const v = criarVerificadorSessao(async (id) => { leituras++; return { ...banco[id] }; }, 30_000, () => agora);
  await v.verificar(1, 0); await v.verificar(1, 0);
  assert.strictEqual(leituras, 1);
  banco[1].ativo = false;
  agora = 31_000;
  assert.deepStrictEqual(await v.verificar(1, 0), { ok: false, motivo: 'inativo' });
  banco[1] = { ativo: true, versao: 1, termosVersao: null };
  v.esquecer(1);
  assert.deepStrictEqual(await v.verificar(1, 0), { ok: false, motivo: 'encerrada' });
});

test('sessão: erro do banco sobe (o middleware responde 503, não deixa passar)', async () => {
  const v = criarVerificadorSessao(async () => { throw new Error('banco fora'); });
  await assert.rejects(() => v.verificar(1, 0), /banco fora/);
});

// ── Termos ──
test('termos: só login/sessão/aceite e o envio de erro funcionam antes do aceite', () => {
  assert.ok(rotaLiberadaSemAceite('/api/auth/termos/aceitar'));
  assert.ok(rotaLiberadaSemAceite('/api/auth/me?x=1'));
  assert.ok(rotaLiberadaSemAceite('/api/erros'));
  assert.ok(!rotaLiberadaSemAceite('/api/clients'));
  assert.ok(!rotaLiberadaSemAceite('/api/portal/meu-caso'));
  assert.ok(!rotaLiberadaSemAceite('/api/authx'));
  assert.ok(precisaAceitar(null));
  assert.ok(precisaAceitar('2020-01-01'));
  assert.ok(!precisaAceitar(TERMOS_VERSAO));
});

test('termos: páginas públicas existem e mostram a versão vigente', () => {
  for (const f of ['termos.html', 'privacidade.html']) {
    const html = fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    assert.ok(html.includes(`Versão ${TERMOS_VERSAO}`), `${f} desatualizada: suba a versão no texto junto com TERMOS_VERSAO`);
  }
});

// ── Middleware: passes temporários nunca valem como login ──
function chamar(token) {
  return new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: '/api/auth/me' };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); }, setHeader() {} };
    authenticate(req, res, () => resolve({ status: 'next' }));
  });
}

test('middleware: passe do 2FA, de passkey ou de OAuth é recusado (antes pulava a 2ª etapa)', async () => {
  for (const purpose of ['2fa', 'passkey_reg', 'court_email', 'inbox']) {
    const t = jwt.sign({ id: 1, purpose }, env.JWT_SECRET, { expiresIn: '5m' });
    assert.strictEqual((await chamar(t)).status, 401, purpose);
  }
  const semPapel = jwt.sign({ id: 1 }, env.JWT_SECRET, { expiresIn: '5m' }); // state do Google Agenda
  assert.strictEqual((await chamar(semPapel)).status, 401);
  const alg = jwt.sign({ id: 1, role: 'admin', email: 'a', name: 'a' }, env.JWT_SECRET, { algorithm: 'HS512' });
  assert.strictEqual((await chamar(alg)).status, 401, 'só HS256');
});

test('signToken leva a versão da sessão e não vaza campos extras', () => {
  const t = signToken({ id: 5, email: 'e', name: 'n', role: 'admin', tv: 3, purpose: 'x' });
  const p = jwt.decode(t);
  assert.strictEqual(p.tv, 3);
  assert.strictEqual(p.purpose, undefined);
});
