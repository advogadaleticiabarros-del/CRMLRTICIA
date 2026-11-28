// Extensão do CRM para o Claude Desktop (28/11/2026): cliente da API e ferramentas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { criarCrm } from '../extensao-claude/server/crm.js';
import { FERRAMENTAS } from '../extensao-claude/server/ferramentas.js';
import { INSTRUCOES } from '../extensao-claude/server/instrucoes.js';

function fetchFalso(resposta = { status: 200, corpo: { ok: true } }) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url, init });
    return { ok: resposta.status < 400, status: resposta.status, json: async () => resposta.corpo };
  };
  return { f, chamadas };
}

test('envia a chave no cabeçalho e monta a consulta sem campos vazios', async () => {
  const { f, chamadas } = fetchFalso();
  const crm = criarCrm({ url: 'https://crm.exemplo/', chave: 'crm_abc123456789012345', fetch: f });
  await crm.get('/identificar', { texto: '5001234-56.2026.8.08.0024', nome: '' });
  assert.equal(chamadas[0].url, 'https://crm.exemplo/api/claude/identificar?texto=5001234-56.2026.8.08.0024');
  assert.equal(chamadas[0].init.headers.Authorization, 'Bearer crm_abc123456789012345');
});

test('sem chave ou sem endereço: mensagem clara, sem chamar o CRM', async () => {
  const { f, chamadas } = fetchFalso();
  await assert.rejects(() => criarCrm({ url: 'https://x', chave: '', fetch: f }).get('/eu'), /Configurações → Claude/);
  await assert.rejects(() => criarCrm({ url: '', chave: 'crm_x', fetch: f }).get('/eu'), /endereço do CRM/);
  assert.equal(chamadas.length, 0);
});

test('erro do CRM vira a mensagem do CRM; rede fora vira aviso em português', async () => {
  const { f } = fetchFalso({ status: 401, corpo: { error: 'Chave do Claude inválida ou revogada. Gere outra no CRM.' } });
  await assert.rejects(() => criarCrm({ url: 'https://x', chave: 'crm_abcdefghijklmnopqrs', fetch: f }).get('/eu'), /revogada/);
  const semRede = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(() => criarCrm({ url: 'https://x', chave: 'crm_abcdefghijklmnopqrs', fetch: semRede }).get('/eu'), /Não consegui falar com o CRM/);
});

test('ferramentas: as 4 da fase 0, todas só leitura, batendo com o manifesto', async () => {
  const manifesto = JSON.parse(fs.readFileSync('extensao-claude/manifest.json', 'utf8'));
  assert.deepEqual(FERRAMENTAS.map((x) => x.nome).sort(), manifesto.tools.map((x) => x.name).sort());
  const chamadas = [];
  const crm = { get: async (c, q) => { chamadas.push(['GET', c, q]); return {}; }, post: async () => { throw new Error('fase 0 não escreve'); } };
  for (const f of FERRAMENTAS) await f.executar(crm, { caso_id: 7, texto: 't', nome: 'n' });
  assert.ok(chamadas.every((c) => c[0] === 'GET'));
  assert.ok(chamadas.some((c) => c[1] === '/casos/7'));
  assert.equal(manifesto.user_config.chave.sensitive, true, 'a chave fica guardada como segredo no Claude Desktop');
});

test('instruções: identificar o caso sozinho, não inventar e nunca enviar mensagem a cliente', () => {
  assert.match(INSTRUCOES, /crm_identificar_caso/);
  assert.match(INSTRUCOES, /nunca invente/i);
  assert.match(INSTRUCOES, /Nunca envie mensagem a cliente/);
});
