// 109 de 114 tarefas vencidas eram "Analisar <tipo> — proc. <nº>" criadas por
// intimação detectada, que nunca fechavam ao confirmar/descartar o prazo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tarefa-'));
execSync(`npx tsc src/services/tarefaAnalisar.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'tarefaAnalisar.js')).href)).default;

test('lê tipo e número do processo do título automático', () => {
  assert.deepEqual(m.lerTituloAnalisar('Analisar Contestação — proc. 0000082-24.2026.5.17.0001'), { tipo: 'Contestação', digitos: '00000822420265170001' });
  assert.deepEqual(m.lerTituloAnalisar('Analisar Recurso'), { tipo: 'Recurso', digitos: null });
});

test('não confunde com tarefa manual', () => {
  assert.equal(m.lerTituloAnalisar('Ligar para a cliente'), null);
  assert.equal(m.lerTituloAnalisar('Analisar documentos da Maria'), null);
});

test('fecha a tarefa quando o prazo detectado ligado já foi resolvido', () => {
  assert.equal(m.deveFechar('confirmado'), true);
  assert.equal(m.deveFechar('descartado'), true);
  assert.equal(m.deveFechar('a_confirmar'), false);
  assert.equal(m.deveFechar(null), false);
});
