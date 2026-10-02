// Análise 02/10/2026: 16 "clientes" eram a empresa da parte contrária
// (ex.: Oliveira Saúde Vila Velha, M. A. M. Medeiros). Com a advogada como
// única intimada, todas as partes viravam candidatas e a primeira (a ré) ganhava.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'djenc-'));
execSync(`npx tsc src/services/djen.ts --outDir "${out}" --rootDir src --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'services', 'djen.js')).href)).default;

const pub = (parties, adv_count = 1) => ({ id: 1, process_number: '00000822420265170001', process_masked: '', court: 'TRT17', orgao: null, classe: null, date: '2026-08-28', type: 'Intimação', texto: 'x', link: null, parties, adv_count });

test('empresa ré listada primeiro não vira cliente: escolhe a pessoa física', () => {
  const [p] = m.groupPublicationsByProcess([pub([{ nome: 'OLIVEIRA SAUDE VILA VELHA LTDA', polo: 'P' }, { nome: 'MARIA DA SILVA', polo: 'A' }])]);
  assert.equal(p.client_name, 'MARIA DA SILVA');
  assert.equal(p.client_type, 'PF');
});

test('ente público (INSS, Estado, Município) também não vira cliente', () => {
  const [p] = m.groupPublicationsByProcess([pub([{ nome: 'INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS', polo: 'P' }, { nome: 'JOAO PEREIRA', polo: 'A' }])]);
  assert.equal(p.client_name, 'JOAO PEREIRA');
  const [q] = m.groupPublicationsByProcess([pub([{ nome: 'MUNICIPIO DE SERRA', polo: 'P' }, { nome: 'ANA LIMA', polo: 'A' }])]);
  assert.equal(q.client_name, 'ANA LIMA');
});

test('duas pessoas físicas sem polo claro → ambíguo (cadastro manual)', () => {
  const [p] = m.groupPublicationsByProcess([pub([{ nome: 'ANA LIMA', polo: '' }, { nome: 'JOSE LIMA', polo: '' }])]);
  assert.equal(p.client_name, null);
});

test('duas pessoas físicas: escolhe a do polo ativo', () => {
  const [p] = m.groupPublicationsByProcess([pub([{ nome: 'JOSE LIMA', polo: 'P' }, { nome: 'ANA LIMA', polo: 'A' }])]);
  assert.equal(p.client_name, 'ANA LIMA');
});

test('só empresa no processo continua vinculando (cliente PJ legítimo)', () => {
  const [p] = m.groupPublicationsByProcess([pub([{ nome: 'PADARIA BOA LTDA', polo: 'A' }])]);
  assert.equal(p.client_name, 'PADARIA BOA LTDA');
  assert.equal(p.client_type, 'PJ');
});
