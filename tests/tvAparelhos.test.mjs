// tests/tvAparelhos.test.mjs — TV liberada por código, sem login na TV (19/11/2026)
import { test } from 'node:test';
import assert from 'node:assert';
import { criarServicoTv, hashSegredo, VALIDADE_CODIGO_MIN, MAX_PEDIDOS_JANELA } from '../dist/services/tvAparelhos.js';

function repoFalso(usuarios = { 7: { id: 7, email: 'equipe@exemplo.com', name: 'Equipe', role: 'staff' } }) {
  const linhas = [];
  return {
    linhas,
    async criar(a) { linhas.push({ id: linhas.length + 1, status: 'aguardando', nome: null, liberadaPor: null, liberadaEm: null, ultimoUso: null, ...a }); return linhas.length; },
    async porHash(h) { return linhas.find((l) => l.segredoHash === h) || null; },
    async aguardandoPorCodigo(codigo, desde) { return linhas.find((l) => l.codigo === codigo && l.status === 'aguardando' && l.criadoEm > desde) || null; },
    async contarCriadosDesde(desde) { return linhas.filter((l) => l.criadoEm > desde).length; },
    async liberar(id, usuarioId, nome, em) { Object.assign(linhas[id - 1], { status: 'liberada', liberadaPor: usuarioId, nome, liberadaEm: em, codigo: null }); },
    async revogar(id) { if (linhas[id - 1]) linhas[id - 1].status = 'revogada'; },
    async listarLiberadas() { return linhas.filter((l) => l.status === 'liberada'); },
    async marcarUso(id, em) { linhas[id - 1].ultimoUso = em; },
    async usuarioPodeVer(id) { return usuarios[id] || null; },
  };
}

let n = 0;
const sorteio = { codigo: () => ['123456', '123456', '654321'][Math.min(n++, 2)], segredo: () => `segredo-${n}-${'x'.repeat(40)}` };
const relogioEm = (iso) => { const r = { agora: new Date(iso) }; r.fn = () => r.agora; return r; };

test('iniciar: devolve código de 6 números, segredo e validade; guarda só o hash do segredo', async () => {
  n = 0;
  const repo = repoFalso(), rel = relogioEm('2026-11-19T15:00:00Z');
  const s = criarServicoTv(repo, sorteio, rel.fn);
  const r = await s.iniciar();
  assert.strictEqual(r.ok, true);
  assert.match(r.codigo, /^\d{6}$/);
  assert.ok(r.segredo.length >= 40);
  assert.strictEqual(new Date(r.expiraEm).getTime() - rel.agora.getTime(), VALIDADE_CODIGO_MIN * 60000);
  assert.strictEqual(repo.linhas[0].segredoHash, hashSegredo(r.segredo));
  assert.ok(!JSON.stringify(repo.linhas).includes(r.segredo));
});

test('iniciar: não repete um código que ainda está esperando', async () => {
  n = 0;
  const repo = repoFalso(), s = criarServicoTv(repo, sorteio, relogioEm('2026-11-19T15:00:00Z').fn);
  const a = await s.iniciar(), b = await s.iniciar();
  assert.notStrictEqual(a.codigo, b.codigo);
});

test('iniciar: trava pedidos em excesso (endereço público)', async () => {
  const repo = repoFalso(), s = criarServicoTv(repo, { codigo: () => String(100000 + repo.linhas.length), segredo: () => 'y'.repeat(64) + repo.linhas.length }, relogioEm('2026-11-19T15:00:00Z').fn);
  for (let i = 0; i < MAX_PEDIDOS_JANELA; i++) assert.strictEqual((await s.iniciar()).ok, true);
  const r = await s.iniciar();
  assert.strictEqual(r.ok, false);
});

test('liberar pelo código: a TV passa a valer e autentica com o usuário que liberou', async () => {
  n = 0;
  const repo = repoFalso(), rel = relogioEm('2026-11-19T15:00:00Z'), s = criarServicoTv(repo, sorteio, rel.fn);
  const { codigo, segredo } = await s.iniciar();
  assert.strictEqual(await s.situacao(segredo), 'aguardando');
  assert.strictEqual(await s.autenticar(segredo), null);
  const r = await s.liberar(` ${codigo.slice(0, 3)} ${codigo.slice(3)} `, { id: 7 }, 'TV da recepção');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(await s.situacao(segredo), 'liberada');
  const u = await s.autenticar(segredo);
  assert.strictEqual(u.id, 7);
  assert.strictEqual(repo.linhas[0].nome, 'TV da recepção');
});

test('liberar: código errado ou vencido não libera nada', async () => {
  n = 0;
  const repo = repoFalso(), rel = relogioEm('2026-11-19T15:00:00Z'), s = criarServicoTv(repo, sorteio, rel.fn);
  const { codigo, segredo } = await s.iniciar();
  assert.strictEqual((await s.liberar('999999', { id: 7 }, 'TV')).ok, false);
  rel.agora = new Date(rel.agora.getTime() + (VALIDADE_CODIGO_MIN + 1) * 60000);
  assert.strictEqual(await s.situacao(segredo), 'expirado');
  assert.strictEqual((await s.liberar(codigo, { id: 7 }, 'TV')).ok, false);
});

test('desligar a TV ou usuário sem acesso: a chave deixa de valer', async () => {
  n = 0;
  const usuarios = { 7: { id: 7, email: 'e@exemplo.com', name: 'E', role: 'staff' } };
  const repo = repoFalso(usuarios), s = criarServicoTv(repo, sorteio, relogioEm('2026-11-19T15:00:00Z').fn);
  const { codigo, segredo } = await s.iniciar();
  await s.liberar(codigo, { id: 7 }, 'TV');
  delete usuarios[7];
  assert.strictEqual(await s.autenticar(segredo), null);
  usuarios[7] = { id: 7, email: 'e@exemplo.com', name: 'E', role: 'staff' };
  await s.revogar(1);
  assert.strictEqual(await s.autenticar(segredo), null);
  assert.strictEqual(await s.situacao(segredo), 'revogada');
});

test('segredo desconhecido ou vazio', async () => {
  const s = criarServicoTv(repoFalso(), sorteio, relogioEm('2026-11-19T15:00:00Z').fn);
  assert.strictEqual(await s.situacao('nada'), 'desconhecido');
  assert.strictEqual(await s.autenticar(''), null);
});

test('listar: TVs liberadas sem o hash do segredo', async () => {
  n = 0;
  const repo = repoFalso(), s = criarServicoTv(repo, sorteio, relogioEm('2026-11-19T15:00:00Z').fn);
  const { codigo } = await s.iniciar();
  await s.liberar(codigo, { id: 7 }, 'TV');
  const l = await s.listar();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].nome, 'TV');
  assert.ok(!('segredoHash' in l[0]));
});
