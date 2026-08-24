// tests/asaasConfig.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('rota de configuração do Asaas nunca devolve a chave de API salva', () => {
  const src = fs.readFileSync(path.resolve('src/routes/financial.ts'), 'utf8');
  const m = src.match(/router\.get\('\/asaas-config'[\s\S]*?\}\);/);
  assert.ok(m, 'rota GET /asaas-config não encontrada');
  // Audita só a chamada res.json(...) em si — não o handler inteiro (que
  // legitimamente lê/consulta asaas_api_key para decidir o boolean `configured`).
  const resJsonCall = m[0].match(/res\.json\(\{[\s\S]*?\}\);/);
  assert.ok(resJsonCall, 'chamada res.json(...) não encontrada na rota');
  // Permite só o uso em forma de booleano (!!map.asaas_api_key), que nunca expõe
  // o valor da chave — qualquer outra menção à chave na resposta é bloqueada.
  const semBooleano = resJsonCall[0].replace(/!!\s*map\.asaas_api_key/g, '');
  assert.doesNotMatch(semBooleano, /asaas_api_key/i, 'a chave de API não pode ser devolvida na resposta');
});
