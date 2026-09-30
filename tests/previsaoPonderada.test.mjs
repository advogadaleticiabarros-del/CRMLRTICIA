// Previsão de receita ponderada (diagnóstico ago/2026): não somar tudo que
// está em aberto como se fosse entrar — ponderar pela taxa histórica de
// recebimento e pela chance real de cada proposta fechar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'prev-'));
execSync(`npx tsc src/services/previsaoPonderada.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'previsaoPonderada.js')).href)).default;

test('taxa de recebimento pelo valor; sem histórico = 100%', () => {
  assert.equal(m.taxa(800, 1000), 0.8);
  assert.equal(m.taxa(0, 0), 1);
  assert.equal(m.taxa(1200, 1000), 1); // nunca passa de 100%
});

test('previsão do mês = realizado + a receber × taxa', () => {
  const r = m.preverMes({ realizado: 3000, aReceber: 5000, recebidoHist: 900, devidoHist: 1000, propostas: [], aceitasHist: 0, decididasHist: 0 });
  assert.equal(r.previsaoMes, 3000 + 4500);
  assert.equal(r.taxaRecebimento, 0.9);
  assert.equal(r.otimista, 8000);
});

test('pipeline usa a probabilidade do lead quando existe, senão a taxa histórica de aceite', () => {
  const r = m.preverMes({
    realizado: 0, aReceber: 0, recebidoHist: 0, devidoHist: 0,
    propostas: [{ valor: 10000, prob: 50 }, { valor: 4000, prob: null }],
    aceitasHist: 1, decididasHist: 4,
  });
  assert.equal(r.taxaConversao, 0.25);
  assert.equal(r.pipelinePonderado, 5000 + 1000);
  assert.equal(r.pipelineBruto, 14000);
});

test('probabilidade fora de 0-100 é limitada', () => {
  const r = m.preverMes({ realizado: 0, aReceber: 0, recebidoHist: 0, devidoHist: 0, propostas: [{ valor: 100, prob: 150 }], aceitasHist: 0, decididasHist: 0 });
  assert.equal(r.pipelinePonderado, 100);
});

test('sem histórico de propostas, taxa de aceite neutra de 30%', () => {
  const r = m.preverMes({ realizado: 0, aReceber: 0, recebidoHist: 0, devidoHist: 0, propostas: [{ valor: 1000, prob: null }], aceitasHist: 0, decididasHist: 0 });
  assert.equal(r.taxaConversao, 0.3);
  assert.equal(r.pipelinePonderado, 300);
});
