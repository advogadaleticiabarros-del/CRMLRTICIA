// tests/clientsFichaUploadDocumento.test.mjs
// Ideia 9 de prioridade média da auditoria do módulo Clientes (23/09/2026):
// upload de documento (RG/CPF digitalizado etc.) só existia na tela genérica
// de Documentos, sem atalho a partir do cadastro/ficha do cliente. Agora a
// ficha do cliente tem um botão de enviar documento direto, reaproveitando
// o mesmo endpoint (POST /api/documents, base64) já usado na Central de
// Documentos — sem endpoint novo.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const frontSrc = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

function blocoFichaCliente() {
  const idx = frontSrc.indexOf('async function fichaCliente');
  assert.ok(idx > -1, 'fichaCliente não encontrado');
  const fim = frontSrc.indexOf('\n}', frontSrc.indexOf('openModal', idx));
  return frontSrc.slice(idx, fim);
}

test('ficha do cliente tem botão de enviar documento', () => {
  const bloco = blocoFichaCliente();
  assert.match(bloco, /fc-upload-doc/);
  assert.match(bloco, /Enviar documento/i);
});

test('upload reaproveita POST \\/api\\/documents (não cria endpoint novo)', () => {
  const bloco = blocoFichaCliente();
  assert.match(bloco, /api\('\/api\/documents'/);
  assert.match(bloco, /file_base64/);
  assert.match(bloco, /client_id/);
});

test('upload converte o arquivo em base64 no navegador (FileReader), mesmo padrão da tela de Documentos', () => {
  const bloco = blocoFichaCliente();
  assert.match(bloco, /FileReader/);
});

test('depois de enviar, a ficha recarrega pra mostrar o documento novo na lista', () => {
  const bloco = blocoFichaCliente();
  // A própria declaração ("async function fichaCliente(...)") já conta como
  // 1 ocorrência — precisa de pelo menos mais 1 chamada real dentro do corpo
  // (recarregar) pra não passar só por causa da assinatura da função.
  const ocorrencias = bloco.match(/fichaCliente\(/g) || [];
  assert.ok(ocorrencias.length >= 2, 'deveria recarregar a ficha (chamar fichaCliente novamente) após o upload, além da própria declaração');
});
