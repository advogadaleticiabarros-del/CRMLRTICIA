// Envio da proposta pela conversa do WhatsApp (pedido 01/10/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'propwa-'));
execSync(`npx tsc src/services/propostaWhatsapp.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'propostaWhatsapp.js')).href)).default;

test('texto com primeiro nome, título e link; sem travessão (padrão das mensagens ao cliente)', () => {
  const t = m.textoEnvioProposta('Jaine Batista Cardoso', 'Proposta de honorários trabalhista', 'https://x/proposta.html?t=abc');
  assert.match(t, /^Olá, Jaine!/);
  assert.match(t, /Proposta de honorários trabalhista/);
  assert.match(t, /https:\/\/x\/proposta\.html\?t=abc/);
  assert.doesNotMatch(t, /—/);
});

test('sem nome nem título ainda gera texto válido', () => {
  const t = m.textoEnvioProposta('', '', 'https://x');
  assert.match(t, /^Olá!/);
  assert.match(t, /https:\/\/x/);
});

test('link público a partir do token', () => {
  assert.equal(m.linkProposta('abc'), 'https://crm.advogadaleticiabarros.com.br/proposta.html?t=abc');
});

test('em análise = enviada ou em negociação', () => {
  assert.equal(m.emAnalise('enviada'), true);
  assert.equal(m.emAnalise('em_negociacao'), true);
  assert.equal(m.emAnalise('aceita'), false);
  assert.equal(m.emAnalise('rascunho'), false);
});
