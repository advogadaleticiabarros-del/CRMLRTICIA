// Barramento de automação além de prazos (diagnóstico ago/2026):
// contrato assinado → tarefas iniciais do caso; fase mudou → tarefa de avisar
// o cliente com rascunho pronto (nunca envia sozinho — ética OAB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'playbooks-'));
execSync(`npx tsc src/services/playbooksNegocio.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'playbooksNegocio.js')).href)).default;

const hoje = new Date('2026-09-30T12:00:00Z');

test('contrato assinado gera boas-vindas (D+1) e conferência de documentos (D+5)', () => {
  const t = m.tarefasContratoAssinado({ clientName: 'Maria', area: 'trabalhista' }, hoje);
  assert.equal(t.length, 2);
  assert.match(t[0].title, /boas-vindas.*Maria/i);
  assert.equal(t[0].dueDate, '2026-10-01');
  assert.match(t[1].title, /documentos.*Maria/i);
  assert.equal(t[1].dueDate, '2026-10-05');
  assert.match(t[1].description, /CTPS/); // lista de documentos por área
});

test('área sem lista específica usa a genérica', () => {
  const t = m.tarefasContratoAssinado({ clientName: 'João', area: null }, hoje);
  assert.match(t[1].description, /RG|documento de identidade/i);
});

test('fase mudou: tarefa com rascunho de mensagem em linguagem simples', () => {
  const t = m.tarefaFaseMudou({ processNumber: '0001', clientName: 'Maria Silva', de: 'instrucao', para: 'sentenca' }, hoje);
  assert.match(t.title, /Avisar Maria Silva/);
  assert.match(t.description, /sentença/i);
  assert.match(t.description, /Olá, Maria/);
  assert.equal(t.dueDate, '2026-10-01');
});

test('fase igual ou sem cliente não gera tarefa', () => {
  assert.equal(m.tarefaFaseMudou({ processNumber: '1', clientName: 'X', de: 'recurso', para: 'recurso' }, hoje), null);
  assert.equal(m.tarefaFaseMudou({ processNumber: '1', clientName: null, de: 'inicial', para: 'recurso' }, hoje), null);
});
