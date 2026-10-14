// tests/laya.test.mjs — Laya (modelo de decisão local, grátis) na qualificação do lead
import { test } from 'node:test';
import assert from 'node:assert';
import { PERGUNTAS_LEAD, lerQualificacaoLaya, perguntarLaya, CONFIANCA_MINIMA } from '../dist/services/laya.js';

const resposta = (area, urg, faixa, conf = 0.9) => ({
  answers: {
    area: { choice: area, confidence: conf },
    urgencia: { choice: urg, confidence: conf },
    faixa: { choice: faixa, confidence: conf },
  },
});

test('PERGUNTAS_LEAD: área, urgência e faixa no formato systemone (choice)', () => {
  for (const k of ['area', 'urgencia', 'faixa']) assert.strictEqual(PERGUNTAS_LEAD[k].type, 'choice');
  assert.ok(PERGUNTAS_LEAD.area.criteria.trabalhista);
  assert.ok(PERGUNTAS_LEAD.area.criteria.previdenciario);
});

test('lerQualificacaoLaya: com confiança alta devolve a qualificação no formato do CRM', () => {
  assert.deepStrictEqual(lerQualificacaoLaya(resposta('trabalhista', 'alta', 'medio')), {
    legal_area: 'trabalhista', ai_urgency: 'alta', ai_value_range: 'medio',
  });
});

test('lerQualificacaoLaya: qualquer resposta com pouca certeza → null (a IA paga decide)', () => {
  assert.strictEqual(lerQualificacaoLaya(resposta('trabalhista', 'alta', 'medio', CONFIANCA_MINIMA - 0.05)), null);
  const r = resposta('familia', 'baixa', 'baixo');
  r.answers.urgencia.confidence = 0.3;
  assert.strictEqual(lerQualificacaoLaya(r), null);
});

test('lerQualificacaoLaya: opção fora da lista ou resposta vazia → null', () => {
  assert.strictEqual(lerQualificacaoLaya(resposta('tributario', 'alta', 'alto')), null);
  assert.strictEqual(lerQualificacaoLaya(null), null);
  assert.strictEqual(lerQualificacaoLaya({}), null);
});

test('lerQualificacaoLaya: área "outro" vira null (não sobrescreve), o resto vale', () => {
  assert.deepStrictEqual(lerQualificacaoLaya(resposta('outro', 'media', 'baixo')), {
    legal_area: null, ai_urgency: 'media', ai_value_range: 'baixo',
  });
});

test('perguntarLaya: sem LAYA_URL não chama a rede', async () => {
  let chamou = false;
  const r = await perguntarLaya('Cliente: oi', PERGUNTAS_LEAD, { url: '', fetch: async () => { chamou = true; } });
  assert.strictEqual(r, null);
  assert.strictEqual(chamou, false);
});

test('perguntarLaya: manda state + questions para /v1/systemone e devolve o JSON', async () => {
  let pedido;
  const r = await perguntarLaya('Cliente: fui demitida grávida', PERGUNTAS_LEAD, {
    url: 'http://127.0.0.1:8765',
    fetch: async (url, init) => { pedido = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => resposta('gestante', 'alta', 'alto') }; },
  });
  assert.strictEqual(pedido.url, 'http://127.0.0.1:8765/v1/systemone');
  assert.strictEqual(pedido.body.state, 'Cliente: fui demitida grávida');
  assert.ok(pedido.body.questions.area);
  assert.strictEqual(r.answers.area.choice, 'gestante');
});

test('perguntarLaya: erro de rede ou HTTP → null, nunca lança', async () => {
  assert.strictEqual(await perguntarLaya('x', PERGUNTAS_LEAD, { url: 'http://l', fetch: async () => { throw new Error('ECONNREFUSED'); } }), null);
  assert.strictEqual(await perguntarLaya('x', PERGUNTAS_LEAD, { url: 'http://l', fetch: async () => ({ ok: false }) }), null);
});
