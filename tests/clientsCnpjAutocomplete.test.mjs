// tests/clientsCnpjAutocomplete.test.mjs
// Ideia 7 de prioridade média da auditoria do módulo Clientes (23/09/2026):
// cliente Pessoa Jurídica tem razão social e endereço digitados 100% manual.
// BrasilAPI é pública, gratuita, sem chave — ao digitar um CNPJ completo (14
// dígitos) com Tipo = Pessoa Jurídica, nome e endereço são preenchidos
// sozinhos a partir do CNPJ.
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

test('clientForm busca o CNPJ na BrasilAPI (API pública, sem chave)', () => {
  const bloco = blocoClientForm();
  assert.match(bloco, /brasilapi\.com\.br\/api\/cnpj/);
});

test('busca de CNPJ só dispara com Tipo = PJ e os 14 dígitos completos', () => {
  const bloco = blocoClientForm();
  const idx = bloco.indexOf('brasilapi.com.br');
  const antes = bloco.slice(Math.max(0, idx - 500), idx);
  assert.match(antes, /\.length\s*(===|!==|>=)\s*14/, 'deveria checar 14 dígitos antes de disparar a busca');
  assert.match(antes, /tipo/i, "deveria checar que o tipo selecionado é 'PJ'");
});

test('preenche nome (razão social) e endereço a partir da resposta da BrasilAPI', () => {
  const bloco = blocoClientForm();
  const idx = bloco.indexOf('brasilapi.com.br');
  const depois = bloco.slice(idx, idx + 700);
  assert.match(depois, /\[name=name\]/);
  assert.match(depois, /\[name=address\]/);
});

test('CNPJ não encontrado ou erro de rede não trava o formulário (best-effort)', () => {
  const bloco = blocoClientForm();
  const idx = bloco.indexOf('brasilapi.com.br');
  const depois = bloco.slice(idx, idx + 700);
  assert.match(depois, /catch/);
});
