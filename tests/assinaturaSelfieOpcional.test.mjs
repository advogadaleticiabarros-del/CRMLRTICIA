// Ideia 12 (prioridade baixa) do módulo Clientes — "selfie simples": a
// advogada escolhe, POR LINK de assinatura, se exige uma selfie do signatário.
// Só registro/evidência (nenhuma comparação facial). Foto do rosto é dado
// pessoal sensível (LGPD): por isso só é pedida quando solicitada (minimização),
// e vira obrigatória nesse caso.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { lerSchema, auditarArquivos } from './helpers/schemaAudit.mjs';

const rd = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const signPath = path.resolve('src/routes/sign-public.ts');
const sign = rd('src/routes/sign-public.ts');
const docs = rd('src/routes/documents.ts');
const contracts = rd('src/routes/contracts.ts');
const assinar = rd('public/assinar.html');
const app = rd('public/app.js');

test('migration adiciona signature_requests.require_selfie', () => {
  assert.ok(lerSchema().get('signature_requests')?.has('require_selfie'));
});

test('criação de link (documento e contrato) aceita require_selfie', () => {
  for (const [nome, src] of [['documents', docs], ['contracts', contracts]]) {
    const i = src.indexOf("router.post('/:id/sign-request'");
    const bloco = src.slice(i, src.indexOf('\n});', i));
    assert.match(bloco, /require_selfie/, `${nome} não grava require_selfie`);
  }
});

test('GET público informa se a selfie é exigida', () => {
  const i = sign.indexOf("router.get('/sign/:token'");
  const bloco = sign.slice(i, sign.indexOf('\n});', i));
  assert.match(bloco, /require_selfie/);
});

test('POST público: exige selfie quando pedida e ignora quando não foi pedida', () => {
  const i = sign.indexOf("router.post('/sign/:token'");
  const bloco = sign.slice(i, sign.indexOf('\n});', i));
  assert.match(bloco, /reqRow\.require_selfie/);
  assert.match(bloco, /Selfie/);
  assert.match(bloco, /status\(400\)/);
  // só grava a selfie se ela foi solicitada
  assert.match(bloco, /selfieFinal/);
});

test('trilha de eventos registra a selfie quando exigida', () => {
  assert.match(sign, /Selfie de verificação registrada/);
});

test('página de assinatura só mostra o campo de selfie quando exigida, e o torna obrigatório', () => {
  assert.match(assinar, /r\.require_selfie/);
  assert.match(assinar, /_requireSelfie/);
  assert.doesNotMatch(assinar, /Selfie segurando o documento \(opcional/);
});

test('advogada escolhe exigir selfie ao gerar o link (documento e contrato)', () => {
  const i = app.indexOf("wrap.querySelector('#doc-sign').onclick");
  assert.match(app.slice(i, i + 1800), /require_selfie/);
  const j = app.indexOf("sendBtn.onclick");
  assert.match(app.slice(j - 200, j + 900), /require_selfie/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([signPath, path.resolve('src/routes/documents.ts'), path.resolve('src/routes/contracts.ts')]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
