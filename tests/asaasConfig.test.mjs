// tests/asaasConfig.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('rota de configuração do Asaas nunca devolve a chave de API salva', () => {
  const src = fs.readFileSync(path.resolve('src/routes/financial.ts'), 'utf8');
  const m = src.match(/router\.get\('\/asaas-config'[\s\S]*?\n\}\);/);
  assert.ok(m, 'rota GET /asaas-config não encontrada');
  // Audita a chamada res.json({ configured: ... }) — a resposta de sucesso —
  // não o res.json(403) do bloqueio de admin nem o handler inteiro (que
  // legitimamente lê/consulta asaas_api_key para decidir o boolean `configured`).
  const resJsonCalls = m[0].match(/res\.json\(\{[\s\S]*?\}\);/g);
  assert.ok(resJsonCalls && resJsonCalls.length, 'chamada res.json(...) não encontrada na rota');
  const successCall = resJsonCalls.find((c) => /configured/.test(c));
  assert.ok(successCall, 'chamada res.json({ configured: ... }) não encontrada na rota');
  // Permite só o uso em forma de booleano (!!map.asaas_api_key), que nunca expõe
  // o valor da chave — qualquer outra menção à chave na resposta é bloqueada.
  const semBooleano = successCall.replace(/!!\s*map\.asaas_api_key/g, '');
  assert.doesNotMatch(semBooleano, /asaas_api_key/i, 'a chave de API não pode ser devolvida na resposta');
});

test('GET e PUT /asaas-config exigem role admin (não só staff genérico)', () => {
  const src = fs.readFileSync(path.resolve('src/routes/financial.ts'), 'utf8');
  const getM = src.match(/router\.get\('\/asaas-config'[\s\S]*?\n\}\);/);
  const putM = src.match(/router\.put\('\/asaas-config'[\s\S]*?\n\}\);/);
  assert.ok(getM, 'rota GET /asaas-config não encontrada');
  assert.ok(putM, 'rota PUT /asaas-config não encontrada');
  for (const [name, m] of [['GET', getM], ['PUT', putM]]) {
    assert.match(m[0], /req\.user!\.role\s*!==\s*'admin'/, `${name} /asaas-config precisa checar req.user!.role !== 'admin'`);
    assert.match(m[0], /res\.status\(403\)/, `${name} /asaas-config precisa responder 403 quando não é admin`);
  }
});
