// 66 números de WhatsApp sem lead/cliente em 30 dias (análise 02/10/2026):
// IA sugere a categoria, a advogada confirma em lote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
execSync(`npx tsc src/services/triagemSemCadastro.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'triagemSemCadastro.js')).href)).default;

test('lê a resposta da IA e normaliza a categoria', () => {
  assert.deepEqual(m.lerTriagem('{"categoria":"Lead","nome":"Ana Souza","motivo":"quer saber de rescisão"}'),
    { categoria: 'lead', nome: 'Ana Souza', motivo: 'quer saber de rescisão' });
  assert.equal(m.lerTriagem('```json\n{"categoria":"parte contrária","nome":"","motivo":"x"}\n```').categoria, 'parte_contraria');
  assert.equal(m.lerTriagem('{"categoria":"spam","nome":"","motivo":""}').categoria, 'servico');
  assert.equal(m.lerTriagem('lixo'), null);
});

test('categoria → destino (etapa do quadro ou cadastro de lead)', () => {
  assert.deepEqual(m.destinoDaCategoria('lead'), { acao: 'lead', etapa: null });
  assert.deepEqual(m.destinoDaCategoria('pessoal'), { acao: 'etapa', etapa: 'Pessoal' });
  assert.deepEqual(m.destinoDaCategoria('parceiro'), { acao: 'etapa', etapa: 'Parceiros' });
  assert.deepEqual(m.destinoDaCategoria('parte_contraria'), { acao: 'etapa', etapa: 'Parte contraria' });
  assert.deepEqual(m.destinoDaCategoria('servico'), { acao: 'etapa', etapa: 'Arquivado' });
  assert.deepEqual(m.destinoDaCategoria('outro'), { acao: 'nada', etapa: null });
});
