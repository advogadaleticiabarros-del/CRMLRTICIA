// Ideias 6 e 8 (parte) da auditoria de Processos e prazos (28/09/2026):
// o gatilho de prazo era o PRIMEIRO da lista fixa que batesse no texto todo,
// não o mais específico/relevante. Agora: específicos (sentença, acórdão,
// citação, embargos) antes dos genéricos (intimação, decisão/despacho,
// publicação); entre os do mesmo grupo vence o que aparece primeiro; e o
// título do ato pesa mais que a descrição.
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'detprazo-'));
execSync(`npx tsc src/utils/deteccaoPrazo.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck`, { stdio: 'pipe' });
const { identificarGatilho } = (await import(pathToFileURL(path.join(out, 'deteccaoPrazo.js')).href)).default;

const tipo = (t, d = '') => identificarGatilho(t, d)?.type ?? null;

test('sem palavra-gatilho → null', () => {
  assert.equal(tipo('Juntada de petição', 'Juntado comprovante'), null);
});

test('cada gatilho simples mantém tipo e prazo', () => {
  assert.deepEqual(identificarGatilho('Sentença', ''), { type: 'Recurso (apelação)', days: 15, marco: true, re: identificarGatilho('Sentença', '').re });
  assert.equal(identificarGatilho('Acórdão publicado').days, 15);
  assert.equal(tipo('Citação expedida'), 'Contestação');
  assert.equal(identificarGatilho('Embargos de declaração').days, 5);
  assert.equal(identificarGatilho('Despacho').days, 5);
});

test('específico vence genérico mesmo aparecendo depois no texto', () => {
  assert.equal(tipo('Intimação', 'Fica a parte intimada da sentença de fls. 10'), 'Recurso (apelação)');
  assert.equal(tipo('Publicação', 'Citação da ré para contestar'), 'Contestação');
});

test('entre específicos vence o que aparece primeiro (não o primeiro da lista fixa)', () => {
  // antes: "sentença" ganhava só por estar antes na lista, mesmo com citação primeiro
  assert.equal(tipo('Citação da ré, sem prejuízo da sentença de tutela anterior'), 'Contestação');
  assert.equal(tipo('Sentença. Cite-se e faça-se a citação'), 'Recurso (apelação)');
});

test('título pesa mais que a descrição', () => {
  assert.equal(tipo('Citação', 'Vide sentença de fls. 3'), 'Contestação');
  assert.equal(tipo('Ato ordinatório', 'Certifique-se a citação'), 'Contestação');
});

test('só sentença e acórdão são marco processual', () => {
  assert.equal(identificarGatilho('Sentença').marco, true);
  assert.equal(identificarGatilho('Acórdão').marco, true);
  assert.equal(!!identificarGatilho('Citação').marco, false);
});

test('acentos e caixa não atrapalham', () => {
  assert.equal(tipo('SENTENCA'), 'Recurso (apelação)');
  assert.equal(tipo('acordao'), 'Recurso');
  assert.equal(tipo('INTIMAÇÃO'), 'Manifestação');
});
