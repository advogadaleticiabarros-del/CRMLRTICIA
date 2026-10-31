// tests/openaiModelos.test.mjs — Modelos da OpenAI por nível (pedido da Jessica, 31/10/2026:
// "qualidade e economizar ao mesmo tempo"). A redação da peça usa o GPT-6 Sol; o resto, o
// Luna barato. Se o modelo novo falhar, cai no seguinte sem a peça deixar de sair.
import { test } from 'node:test';
import assert from 'node:assert';
import { tentativasPara, criarChamadaOpenAI } from '../dist/services/openaiModelos.js';

const ok = (texto, modelo) => ({ ok: true, status: 200, dados: { model: modelo, choices: [{ message: { content: texto } }] } });
const erro = (status, msg, code) => ({ ok: false, status, dados: { error: { message: msg, code } } });

function montar(respostas, env = {}) {
  const enviados = [];
  const usos = [];
  const chamar = criarChamadaOpenAI({
    chave: () => 'sk-teste',
    env: () => env,
    enviar: async (body) => { enviados.push(body); const r = respostas(body); return typeof r === 'function' ? r() : r; },
    registrar: (u) => usos.push(u),
  });
  return { chamar, enviados, usos };
}

test('redação vai para o GPT-6 Sol com esforço alto e conta como nível pago forte', async () => {
  const { chamar, enviados, usos } = montar((b) => ok('peça', b.model));
  const r = await chamar('redija', 'redacao');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'peça');
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].model, 'gpt-6-sol');
  assert.strictEqual(enviados[0].reasoning_effort, 'high');
  assert.deepStrictEqual(usos, ['openai_smart']);
});

test('o resto usa o Luna barato, com o esforço pedido', async () => {
  const { chamar, enviados, usos } = montar((b) => ok('x', b.model));
  await chamar('p', 'baixo');
  await chamar('p', 'medio');
  await chamar('p', 'alto');
  assert.deepStrictEqual(enviados.map((b) => [b.model, b.reasoning_effort]), [
    ['gpt-6-luna', 'low'], ['gpt-6-luna', 'medium'], ['gpt-6-luna', 'high'],
  ]);
  assert.deepStrictEqual(usos, ['openai', 'openai', 'openai']);
});

test('Sol recusado: tenta sem o esforço, depois cai no Luna com esforço alto', async () => {
  const { chamar, enviados, usos } = montar((b) => (b.model === 'gpt-6-sol' ? erro(400, 'model not found', 'model_not_found') : ok('peça', b.model)));
  const r = await chamar('redija', 'redacao');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(enviados.map((b) => [b.model, b.reasoning_effort]), [
    ['gpt-6-sol', 'high'], ['gpt-6-sol', undefined], ['gpt-6-luna', 'high'],
  ]);
  assert.deepStrictEqual(usos, ['openai']);
});

test('modelo recusado não é tentado de novo nas próximas chamadas', async () => {
  const { chamar, enviados } = montar((b) => (b.model === 'gpt-6-luna' ? erro(404, 'The model does not exist') : ok('x', b.model)));
  await chamar('p', 'baixo');
  await chamar('p', 'baixo');
  assert.deepStrictEqual(enviados.map((b) => b.model), ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.6-luna']);
});

test('falha passageira (limite, servidor) tenta o próximo mas não marca o modelo', async () => {
  let primeira = true;
  const { chamar, enviados } = montar((b) => {
    if (b.model === 'gpt-6-luna' && primeira) { primeira = false; return erro(429, 'Rate limit'); }
    return ok('x', b.model);
  });
  await chamar('p', 'baixo');
  await chamar('p', 'baixo');
  assert.deepStrictEqual(enviados.map((b) => b.model), ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-6-luna']);
});

test('texto grande demais (400 sem ser do modelo) não risca o modelo', async () => {
  let primeira = true;
  const { chamar, enviados } = montar((b) => {
    if (b.model === 'gpt-6-sol' && primeira) { primeira = false; return erro(400, "This model's maximum context length is...", 'context_length_exceeded'); }
    return ok('x', b.model);
  });
  await chamar('p', 'redacao');
  await chamar('p', 'redacao');
  assert.strictEqual(enviados.at(-1).model, 'gpt-6-sol');
});

test('tudo falhou: devolve a mensagem do último erro', async () => {
  const { chamar } = montar(() => erro(500, 'servidor fora'));
  const r = await chamar('p', 'baixo');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, 'servidor fora');
});

test('sem chave não chama a API', async () => {
  const enviados = [];
  const chamar = criarChamadaOpenAI({ chave: () => undefined, env: () => ({}), enviar: async (b) => { enviados.push(b); return ok('x'); }, registrar: () => {} });
  const r = await chamar('p', 'redacao');
  assert.deepStrictEqual(r, { ok: false, message: 'sem_openai' });
  assert.strictEqual(enviados.length, 0);
});

test('modelos configuráveis pelo .env, sem repetir o mesmo modelo na lista', () => {
  const t = tentativasPara('baixo', { OPENAI_MODEL: 'gpt-5.6-luna' });
  assert.deepStrictEqual(t.map((x) => x.modelo), ['gpt-5.6-luna']);
  const r = tentativasPara('redacao', { OPENAI_MODEL_REDACAO: 'gpt-6.1-sol' });
  assert.strictEqual(r[0].modelo, 'gpt-6.1-sol');
  assert.strictEqual(tentativasPara('forte', {})[0].modelo, 'gpt-6-sol');
});

test('a esteira de peças pede o nível de redação para redigir', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/services/esteiraPecaMysql.ts', import.meta.url), 'utf8');
  assert.ok(/nivel === 'redacao' \? 'openai-redacao'/.test(src));
});
