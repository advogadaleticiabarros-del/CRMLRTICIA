// tests/clientsViaCep.test.mjs
// Ideia 6 de prioridade média da auditoria do módulo Clientes (23/09/2026):
// endereço é digitado 100% manual, sem nenhuma integração de CEP. ViaCEP é
// pública, gratuita, sem chave — ao digitar um CEP completo (8 dígitos) no
// cadastro/edição de cliente, o campo Endereço é preenchido sozinho (rua,
// bairro, cidade/UF); número/complemento continuam manuais (ViaCEP não
// devolve isso).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const frontSrc = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

function blocoClientForm() {
  const idx = frontSrc.indexOf('async function clientForm');
  assert.ok(idx > -1, 'clientForm não encontrado');
  const fim = frontSrc.indexOf('\n}', frontSrc.indexOf('openModal', idx));
  return frontSrc.slice(idx, fim);
}

test('clientForm tem campo de CEP', () => {
  const bloco = blocoClientForm();
  assert.match(bloco, /field\('CEP'/);
});

test('clientForm busca o CEP na ViaCEP (API pública, sem chave) e preenche o endereço sozinho', () => {
  const bloco = blocoClientForm();
  assert.match(bloco, /viacep\.com\.br/);
  assert.match(bloco, /\[name=address\]/, 'deveria preencher o campo de endereço já existente');
});

test('busca de CEP só dispara com os 8 dígitos completos (não a cada tecla)', () => {
  const bloco = blocoClientForm();
  const idx = bloco.indexOf('viacep.com.br');
  const antes = bloco.slice(Math.max(0, idx - 400), idx);
  assert.match(antes, /\.length\s*(===|!==|>=)\s*8/, 'deveria checar 8 dígitos antes de disparar a busca');
});

test('CEP não encontrado ou erro de rede não trava o formulário (best-effort)', () => {
  const bloco = blocoClientForm();
  const idx = bloco.indexOf('viacep.com.br');
  const depois = bloco.slice(idx, idx + 500);
  assert.match(depois, /catch/);
});
