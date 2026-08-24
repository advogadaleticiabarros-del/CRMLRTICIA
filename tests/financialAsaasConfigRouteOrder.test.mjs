// tests/financialAsaasConfigRouteOrder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('rotas /asaas-config vêm antes de PUT /:id em financial.ts (senão o Express casa "asaas-config" como :id)', () => {
  const src = fs.readFileSync(path.resolve('src/routes/financial.ts'), 'utf8');
  const idxAsaasGet = src.indexOf("router.get('/asaas-config'");
  const idxAsaasPut = src.indexOf("router.put('/asaas-config'");
  const idxGenericPut = src.indexOf("router.put('/:id'");
  assert.ok(idxAsaasGet !== -1, 'GET /asaas-config não encontrada');
  assert.ok(idxAsaasPut !== -1, 'PUT /asaas-config não encontrada');
  assert.ok(idxGenericPut !== -1, 'PUT /:id não encontrada');
  assert.ok(idxAsaasGet < idxGenericPut, 'GET /asaas-config precisa vir antes de PUT /:id');
  assert.ok(idxAsaasPut < idxGenericPut, 'PUT /asaas-config precisa vir antes de PUT /:id — bug real: sem isso, salvar a configuração do Asaas cai em PUT /:id e devolve "Lançamento não encontrado"');
});
