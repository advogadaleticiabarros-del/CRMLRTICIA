// Automação de documentos (diagnóstico ago/2026): dado lido pela IA dos
// documentos recebidos vira SUGESTÃO por campo, com fonte e confiança —
// nunca gravado sem conferência. CPF inválido ou divergência → baixa confiança.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'extr-'));
execSync(`npx tsc src/services/extracaoDocumentos.ts --outDir "${out}" --rootDir src --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'services', 'extracaoDocumentos.js')).href)).default;

const resp = (tipo, campos) => JSON.stringify({ tipo_documento: tipo, campos });

test('parse: normaliza CPF, UF, CEP e data; ignora campo desconhecido', () => {
  const r = m.parseExtracao(resp('RG', {
    nome: { valor: ' Maria da Silva ', confianca: 'alta' },
    cpf: { valor: '529.982.247-25', confianca: 'alta' },
    data_nascimento: { valor: '03/04/1990', confianca: 'alta' },
    state: { valor: 'es', confianca: 'alta' },
    cep: { valor: '29.100-000', confianca: 'alta' },
    senha_banco: { valor: 'x', confianca: 'alta' },
  }));
  assert.equal(r.tipo, 'RG');
  assert.equal(r.campos.nome.valor, 'Maria da Silva');
  assert.equal(r.campos.cpf.valor, '529.982.247-25');
  assert.equal(r.campos.data_nascimento.valor, '1990-04-03');
  assert.equal(r.campos.state.valor, 'ES');
  assert.equal(r.campos.cep.valor, '29100-000');
  assert.equal(r.campos.senha_banco, undefined);
});

test('parse: resposta quebrada → null', () => {
  assert.equal(m.parseExtracao('não consegui ler'), null);
});

test('mesclar: mesmo valor em 2 documentos → alta, com as duas fontes', () => {
  const a = m.parseExtracao(resp('RG', { nome: { valor: 'Maria Silva', confianca: 'alta' } }));
  const b = m.parseExtracao(resp('CTPS', { nome: { valor: 'MARIA SILVA', confianca: 'alta' } }));
  const r = m.mesclarExtracoes([{ fonte: 'RG.jpg', r: a }, { fonte: 'ctps.jpg', r: b }]);
  assert.equal(r.nome.confianca, 'alta');
  assert.deepEqual(r.nome.fontes, ['RG.jpg', 'ctps.jpg']);
  assert.deepEqual(r.nome.alternativas, []);
});

test('mesclar: divergência entre documentos → baixa, com alternativa', () => {
  const a = m.parseExtracao(resp('RG', { rg: { valor: '1.234.567', confianca: 'alta' } }));
  const b = m.parseExtracao(resp('CNH', { rg: { valor: '1.234.568', confianca: 'alta' } }));
  const r = m.mesclarExtracoes([{ fonte: 'a', r: a }, { fonte: 'b', r: b }]);
  assert.equal(r.rg.confianca, 'baixa');
  assert.equal(r.rg.alternativas.length, 1);
});

test('mesclar: CPF com dígito inválido → baixa mesmo com a IA "certa"', () => {
  const a = m.parseExtracao(resp('RG', { cpf: { valor: '529.982.247-26', confianca: 'alta' } }));
  const r = m.mesclarExtracoes([{ fonte: 'a', r: a }]);
  assert.equal(r.cpf.confianca, 'baixa');
  assert.match(r.cpf.aviso, /dígito/);
});

test('mesclar: IA incerta → baixa', () => {
  const a = m.parseExtracao(resp('RG', { nome: { valor: 'Maria', confianca: 'baixa' } }));
  assert.equal(m.mesclarExtracoes([{ fonte: 'a', r: a }]).nome.confianca, 'baixa');
});
