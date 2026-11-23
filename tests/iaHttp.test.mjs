// tests/iaHttp.test.mjs — chamadas de IA dos agentes: vazio não é sucesso, erro em HTML não quebra (23/11/2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { textoGemini, textoChat, lerJsonIa, mensagemErroIa, sinalIa, TEMPO_IA_MS } from '../dist/services/iaHttp.js';
import { criarChamadaOpenAI } from '../dist/services/openaiModelos.js';

test('Gemini: texto normal passa; bloqueio/limite vira motivo, não texto vazio', () => {
  assert.deepEqual(textoGemini({ candidates: [{ content: { parts: [{ text: 'oi' }, { text: ' tudo' }] } }] }), { texto: 'oi tudo' });
  assert.match(textoGemini({ candidates: [{ finishReason: 'SAFETY' }] }).motivo, /SAFETY/);
  assert.match(textoGemini({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }).motivo, /PROHIBITED/);
  assert.match(textoGemini({ candidates: [{ content: { parts: [{ text: '   ' }] }, finishReason: 'MAX_TOKENS' }] }).motivo, /MAX_TOKENS/);
  assert.equal(textoGemini({}).texto, '');
});

test('chat (OpenAI/Groq): vazio por "length" ou recusa vira motivo', () => {
  assert.deepEqual(textoChat({ choices: [{ message: { content: 'ok' } }] }), { texto: 'ok' });
  assert.match(textoChat({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }, 'Groq').motivo, /Groq.*length/);
  assert.match(textoChat({ choices: [{ message: { content: null, refusal: 'não posso' } }] }).motivo, /recusou/);
});

test('resposta de erro em HTML não quebra; tempo esgotado tem mensagem clara', async () => {
  assert.deepEqual(await lerJsonIa({ json: async () => { throw new SyntaxError('Unexpected token <'); } }), {});
  const e = new Error('x'); e.name = 'TimeoutError';
  assert.equal(mensagemErroIa(e, 'Gemini'), 'Gemini não respondeu a tempo');
  assert.ok(sinalIa(10) instanceof AbortSignal);
  assert.ok(TEMPO_IA_MS.rapido < TEMPO_IA_MS.normal && TEMPO_IA_MS.normal < TEMPO_IA_MS.longo);
});

test('OpenAI: resposta vazia de um modelo tenta o próximo em vez de devolver ""', async () => {
  const enviados = [];
  const chamar = criarChamadaOpenAI({
    chave: () => 'k', env: () => ({}), registrar: () => {},
    enviar: async (body) => {
      enviados.push(body.model);
      return enviados.length === 1
        ? { ok: true, status: 200, dados: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } }
        : { ok: true, status: 200, dados: { choices: [{ message: { content: 'resposta' } }] } };
    },
  });
  const r = await chamar('p', 'alto');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'resposta');
  assert.ok(enviados.length >= 2);
});

test('toda chamada de IA por fetch tem tempo limite', () => {
  for (const f of ['aiAssistant.ts', 'briefingAudienciaJob.ts', 'whatsappTranscricao.ts']) {
    const src = fs.readFileSync(new URL(`../src/services/${f}`, import.meta.url), 'utf8');
    const chamadas = src.split(/await fetch\(/).slice(1);
    for (const c of chamadas) assert.match(c.slice(0, 900), /signal:\s*sinalIa\(/, `${f}: fetch de IA sem tempo limite`);
  }
});
