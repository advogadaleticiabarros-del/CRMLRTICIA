// Chaves de acesso do Claude (extensão do Claude Desktop, 28/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chaves-'));
execSync(`npx tsc src/services/chavesClaude.ts src/services/claudeConsultas.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const imp = async (f) => (await import(pathToFileURL(path.join(out, f)).href)).default;
const ch = await imp('chavesClaude.js');
const cons = await imp('claudeConsultas.js');

function repoFake() {
  const linhas = [];
  const usuarios = { 1: { id: 1, email: 'dra@x', name: 'Dra. Fictícia', role: 'admin' }, 2: { id: 2, email: 'c@x', name: 'Cliente', role: 'cliente' } };
  return {
    linhas,
    repo: {
      async criar(c) { linhas.push({ ...c, id: linhas.length + 1, usos: 0, revogadaEm: null }); return linhas.length; },
      async porHash(h) { return linhas.find((l) => l.segredoHash === h) || null; },
      async listarDoUsuario(u) { return linhas.filter((l) => l.userId === u && !l.revogadaEm); },
      async revogar(id, u) { const l = linhas.find((x) => x.id === id && x.userId === u && !x.revogadaEm); if (!l) return false; l.revogadaEm = new Date(); return true; },
      async marcarUso(id) { linhas.find((l) => l.id === id).usos++; },
      async usuarioDaEquipe(id) { const u = usuarios[id]; return u && u.role !== 'cliente' ? u : null; },
    },
  };
}

test('criar: devolve a chave uma vez só e guarda apenas o hash', async () => {
  const { repo, linhas } = repoFake();
  const s = ch.criarServicoChaves(repo);
  const r = await s.criar(1, 'Claude do notebook');
  assert.match(r.chave, /^crm_[A-Za-z0-9_-]{40,}$/);
  assert.equal(linhas.length, 1);
  assert.ok(!JSON.stringify(linhas).includes(r.chave), 'a chave não fica gravada');
  assert.equal(linhas[0].segredoHash.length, 64);
  assert.equal(linhas[0].prefixo, r.chave.slice(0, 12));
});

test('autenticar: chave certa devolve a pessoa e conta o uso; errada, revogada ou de cliente não entra', async () => {
  const { repo, linhas } = repoFake();
  const s = ch.criarServicoChaves(repo);
  const { chave, id } = await s.criar(1, 'notebook');
  assert.deepEqual(await s.autenticar(chave), { id: 1, email: 'dra@x', name: 'Dra. Fictícia', role: 'admin' });
  assert.equal(linhas[0].usos, 1);
  assert.equal(await s.autenticar('crm_errada'), null);
  assert.equal(await s.autenticar(''), null);
  assert.equal(await s.autenticar(undefined), null);
  assert.equal(await s.revogar(id, 2), false, 'só a dona revoga');
  assert.equal(await s.revogar(id, 1), true);
  assert.equal(await s.autenticar(chave), null, 'revogada não entra');
  const deCliente = await s.criar(2, 'x').catch((e) => e);
  assert.ok(deCliente instanceof Error, 'cliente do portal não gera chave');
});

test('no máximo 5 chaves ativas por pessoa; nome obrigatório e curto', async () => {
  const { repo } = repoFake();
  const s = ch.criarServicoChaves(repo);
  for (let i = 0; i < 5; i++) await s.criar(1, `c${i}`);
  await assert.rejects(() => s.criar(1, 'sexta'), /5 chaves/);
  await assert.rejects(() => s.criar(1, '   '), /nome/i);
});

// ── identificar o caso pelo texto da conversa ──────────────────────────────

test('extrairPistas: números de processo (com e sem máscara) e CPF', () => {
  const p = cons.extrairPistas('Réplica no processo 5001234-56.2026.8.08.0024 e no 50099999920258080012, cliente CPF 123.456.789-09.');
  assert.deepEqual(p.processos, ['50012345620268080024', '50099999920258080012']);
  assert.deepEqual(p.cpfs, ['12345678909']);
  assert.deepEqual(cons.extrairPistas('nada aqui 2026').processos, []);
});

test('grau de certeza: processo bate = certo; nome com uma ação = certo; várias = dúvida', () => {
  assert.equal(cons.grauDeCerteza({ porProcesso: 1, porNome: 0 }), 'certo');
  assert.equal(cons.grauDeCerteza({ porProcesso: 0, porNome: 1 }), 'certo');
  assert.equal(cons.grauDeCerteza({ porProcesso: 0, porNome: 3 }), 'duvida');
  assert.equal(cons.grauDeCerteza({ porProcesso: 0, porNome: 0 }), 'nenhum');
});
