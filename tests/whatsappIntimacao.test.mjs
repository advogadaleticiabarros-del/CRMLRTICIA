// WhatsApp jurídico (diagnóstico ago/2026): cliente que escreve "recebi uma
// intimação" vira tarefa urgente — sem resposta automática; o rascunho deixa
// claro que não é a confirmação oficial do prazo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'waint-'));
execSync(`npx tsc src/services/whatsappIntimacao.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'whatsappIntimacao.js')).href)).default;

test('detecta menções típicas', () => {
  for (const t of [
    'Dra, recebi uma intimação hoje',
    'chegou uma carta do fórum aqui em casa',
    'o oficial de justiça passou aqui',
    'fui citado, e agora?',
    'Recebi uma CITAÇÃO pelo correio',
    'tem um mandado com meu nome',
    'recebi notificação do tribunal',
  ]) assert.equal(m.mencionaIntimacao(t), true, t);
});

test('não dispara em conversa comum', () => {
  for (const t of [
    'bom dia, tudo bem?',
    'quando é a audiência?',
    'mandei o documento',
    'obrigada pela citação do artigo', // falso positivo aceitável? não: exige contexto de recebimento
    '',
  ]) assert.equal(m.mencionaIntimacao(t), false, t);
});

test('tarefa com trecho da mensagem e rascunho de resposta', () => {
  const t = m.tarefaIntimacao('Maria Souza', 'recebi uma intimação ontem, o que faço?');
  assert.match(t.title, /Maria Souza.*intimação/i);
  assert.match(t.description, /recebi uma intimação ontem/);
  assert.match(t.description, /não é a confirmação oficial/i);
});
