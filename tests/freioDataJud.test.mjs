// tests/freioDataJud.test.mjs
// Incidente de 23/11/2026: "DataJud HTTP 429" ao sincronizar processo. O
// monitoramento consultava os 136 processos toda hora (rodada de 1h43, uma por
// cima da outra), e o CNJ passou a recusar 400-650 consultas por dia. Agora:
// uma consulta por vez com intervalo, pausa de todas as automáticas depois de
// um 429/timeout, e o clique manual com prioridade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'freio-datajud-'));
execSync(`npx tsc src/services/datajud.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
process.env.DATAJUD_API_KEY = 'chave-de-teste';
process.env.DATAJUD_RETRY_DELAY_MS = '1';
process.env.DATAJUD_INTERVALO_MS = '0';
const { criarFreio } = (await import(pathToFileURL(path.join(out, 'freioDataJud.js')).href)).default;
const datajud = (await import(pathToFileURL(path.join(out, 'datajud.js')).href)).default;

function relogio() {
  let t = 1_000_000;
  const esperas = [];
  return { agora: () => t, esperar: async (ms) => { esperas.push(ms); t += ms; }, avancar: (ms) => { t += ms; }, esperas };
}

test('consultas saem uma por vez, com o intervalo mínimo entre elas', async () => {
  const r = relogio();
  const f = criarFreio({ agora: r.agora, esperar: r.esperar, intervaloMs: () => 2000, pausaMs: () => 600000 });
  const ordem = [];
  await Promise.all([1, 2, 3].map((n) => f.executar(async () => { ordem.push(n); return n; })));
  assert.deepEqual(ordem, [1, 2, 3]);
  assert.deepEqual(r.esperas, [2000, 2000]);
});

test('depois de um limite, as automáticas param pela pausa inteira sem chamar o DataJud', async () => {
  const r = relogio();
  const f = criarFreio({ agora: r.agora, esperar: r.esperar, intervaloMs: () => 0, pausaMs: () => 15 * 60000 });
  f.registrarLimite();
  let chamou = 0;
  assert.equal(await f.executar(async () => { chamou++; return 'x'; }), null);
  assert.equal(chamou, 0);
  assert.equal(f.pausadoAte(), r.agora() + 15 * 60000);
  r.avancar(15 * 60000);
  assert.equal(await f.executar(async () => { chamou++; return 'x'; }), 'x');
  assert.equal(chamou, 1);
});

test('consulta com prioridade (clique manual) passa mesmo durante a pausa', async () => {
  const r = relogio();
  const f = criarFreio({ agora: r.agora, esperar: r.esperar, intervaloMs: () => 0, pausaMs: () => 600000 });
  f.registrarLimite();
  assert.equal(await f.executar(async () => 'manual', { prioridade: true }), 'manual');
});

const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });

test('429: não repete a consulta, aciona o freio e explica em português', async () => {
  datajud.freioDataJud.liberar();
  let n = 0;
  globalThis.fetch = async () => { n++; return { ok: false, status: 429 }; };
  const r = await datajud.consultarProcessoDataJud('0001234-56.2024.8.08.0001');
  assert.equal(n, 1, 'repetir em 429 só gasta mais limite');
  assert.equal(r.found, false);
  assert.equal(r.limitado, true);
  assert.match(r.error, /DataJud \(CNJ\) está sobrecarregado e recusando consultas/);
  assert.match(r.error, /429/);
  assert.match(r.error, /depois das \d{2}:\d{2}/);
  // a próxima automática nem chega ao CNJ
  const r2 = await datajud.consultarProcessoDataJud('0001234-56.2024.8.08.0001');
  assert.equal(n, 1);
  assert.equal(r2.limitado, true);
  // a manual tenta
  globalThis.fetch = async () => { n++; return { ok: true, status: 200, json: async () => ({ hits: { hits: [{ _source: { movimentos: [] } }] } }) }; };
  const r3 = await datajud.consultarProcessoDataJud('0001234-56.2024.8.08.0001', null, { prioridade: true });
  assert.equal(n, 2);
  assert.equal(r3.found, true);
  datajud.freioDataJud.liberar();
});

test('timeout em todas as tentativas também aciona o freio', async () => {
  datajud.freioDataJud.liberar();
  globalThis.fetch = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; };
  const r = await datajud.consultarProcessoDataJud('0001234-56.2024.8.08.0001');
  assert.equal(r.limitado, true);
  assert.match(r.error, /Timeout na consulta DataJud/);
  assert.ok(datajud.freioDataJud.pausadoAte() > Date.now());
  datajud.freioDataJud.liberar();
});

test('monitoramento: lote dos mais antigos, sem rodada por cima de rodada, para no freio', () => {
  const src = fs.readFileSync(path.resolve('src/services/monitoringService.ts'), 'utf8');
  const job = src.match(/export async function runMonitoringJob[\s\S]*?\n\}/)[0];
  assert.match(job, /ORDER BY lp\.last_sync_at IS NOT NULL, lp\.last_sync_at/);
  assert.match(job, /LIMIT \?/);
  assert.match(job, /monitorRodando/);
  assert.match(job, /limitado\) \{[^}]*break/);
  const rota = fs.readFileSync(path.resolve('src/routes/processes.ts'), 'utf8');
  assert.match(rota, /syncProcess\(Number\(req\.params\.id\), \{ manual: true \}\)/);
});
