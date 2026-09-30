// Copiloto (diagnóstico ago/2026): a análise da movimentação passa a vir em
// JSON validado campo a campo (não mais "recortar" texto solto), com tipo da
// movimentação e grau. Formato inválido deixa de passar em silêncio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'movia-'));
execSync(`npx tsc src/services/movimentacaoIa.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'movimentacaoIa.js')).href)).default;

test('JSON válido vira resumo tipado', () => {
  const r = m.parseMovimentacaoJson(JSON.stringify({
    resumo: 'Sentença de parcial procedência.', acao: 'Avaliar recurso ordinário', prazo_interno: '10/10/2026',
    prioridade: 'Alta', tipo: 'sentenca', grau: '1',
  }));
  assert.deepEqual(r, { resumo: 'Sentença de parcial procedência.', acao: 'Avaliar recurso ordinário', prazo_interno: '10/10/2026', prioridade: 'Alta', tipo: 'sentenca', grau: '1º grau' });
});

test('aceita cercas de código e normaliza vocabulário', () => {
  const r = m.parseMovimentacaoJson('```json\n{"resumo":"x","acao":"nenhuma","prazo_interno":"sem prazo","prioridade":"media","tipo":"Acórdão","grau":"2º grau"}\n```');
  assert.equal(r.prioridade, 'Média');
  assert.equal(r.tipo, 'acordao');
  assert.equal(r.grau, '2º grau');
});

test('tipo/grau desconhecidos viram "outro"/null; prioridade desconhecida vira Baixa', () => {
  const r = m.parseMovimentacaoJson('{"resumo":"x","acao":"y","prazo_interno":"","prioridade":"urgente!!","tipo":"xpto","grau":"?"}');
  assert.equal(r.tipo, 'outro');
  assert.equal(r.grau, null);
  assert.equal(r.prioridade, 'Baixa');
});

test('sem resumo ou JSON quebrado → null (falha visível, não silenciosa)', () => {
  assert.equal(m.parseMovimentacaoJson('{"acao":"y"}'), null);
  assert.equal(m.parseMovimentacaoJson('RESUMO: texto solto'), null);
  assert.equal(m.parseMovimentacaoJson(''), null);
});

test('rótulo do tipo para exibição', () => {
  assert.equal(m.TIPO_MOVIMENTACAO_PT.transito_julgado, 'Trânsito em julgado');
});
