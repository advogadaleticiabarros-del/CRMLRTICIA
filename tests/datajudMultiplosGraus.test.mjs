// tests/datajudMultiplosGraus.test.mjs
// Bug real: consultarProcessoDataJud() só lia hits.hits[0] e descartava os
// demais resultados que o DataJud pode devolver para o mesmo número de
// processo (1º grau, 2º grau/recurso, turma recursal — diferenciados pelo
// campo _source.grau). Ver diagnóstico em docs/superpowers/specs/.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/datajud.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { consultarProcessoDataJud } = await import('../dist/services/datajud.js');

function mockHit(grau, numeroProcesso, movimentos) {
  return {
    _source: {
      numeroProcesso,
      grau,
      classe: { nome: 'Procedimento Comum' },
      orgaoJulgador: { nome: grau === 'G1' ? '4ª Vara do Trabalho' : 'Turma Recursal' },
      movimentos,
    },
  };
}

test('consultarProcessoDataJud junta movimentações de TODOS os graus devolvidos, não só o primeiro', async (t) => {
  process.env.DATAJUD_API_KEY = 'chave-de-teste';
  const numero = '50239114720258080012';

  const fakeResponse = {
    hits: {
      hits: [
        mockHit('G1', numero, [
          { dataHora: '2026-01-10T10:00:00', nome: 'Distribuição' },
          { dataHora: '2026-02-15T10:00:00', nome: 'Sentença' },
        ]),
        mockHit('G2', numero, [
          { dataHora: '2026-03-01T10:00:00', nome: 'Recurso recebido' },
        ]),
      ],
    },
  };

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; delete process.env.DATAJUD_API_KEY; });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => fakeResponse,
  });

  const r = await consultarProcessoDataJud(numero, 'api_publica_tjes');

  assert.equal(r.found, true);
  // Antes do fix: só 2 movimentações (do G1) apareciam, a de G2 era perdida.
  assert.equal(r.movements.length, 3, 'deve trazer as movimentações dos dois graus, não só do primeiro hit');
  const titulos = r.movements.map((m) => m.title);
  assert.ok(titulos.includes('Recurso recebido'), 'movimentação do 2º grau (G2) não pode ser descartada');
});

test('consultarProcessoDataJud marca a origem (grau) de cada movimentação quando há múltiplos hits', async (t) => {
  process.env.DATAJUD_API_KEY = 'chave-de-teste';
  const numero = '50239114720258080012';

  const fakeResponse = {
    hits: {
      hits: [
        mockHit('G1', numero, [{ dataHora: '2026-01-10T10:00:00', nome: 'Distribuição' }]),
        mockHit('G2', numero, [{ dataHora: '2026-03-01T10:00:00', nome: 'Recurso recebido' }]),
      ],
    },
  };

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; delete process.env.DATAJUD_API_KEY; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => fakeResponse });

  const r = await consultarProcessoDataJud(numero, 'api_publica_tjes');
  const recurso = r.movements.find((m) => m.title === 'Recurso recebido');
  assert.ok(recurso, 'movimentação do 2º grau deve existir');
  assert.match(recurso.description, /2º grau|G2/i, 'descrição deve indicar de qual grau a movimentação veio, para rastreabilidade');
});

test('consultarProcessoDataJud continua funcionando normalmente quando há só 1 hit (caso comum)', async (t) => {
  process.env.DATAJUD_API_KEY = 'chave-de-teste';
  const numero = '50239114720258080012';

  const fakeResponse = {
    hits: { hits: [mockHit('G1', numero, [{ dataHora: '2026-01-10T10:00:00', nome: 'Distribuição' }])] },
  };

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; delete process.env.DATAJUD_API_KEY; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => fakeResponse });

  const r = await consultarProcessoDataJud(numero, 'api_publica_tjes');
  assert.equal(r.found, true);
  assert.equal(r.movements.length, 1);
});

test('consultarProcessoDataJud devolve found:false quando não há nenhum hit', async (t) => {
  process.env.DATAJUD_API_KEY = 'chave-de-teste';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; delete process.env.DATAJUD_API_KEY; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ hits: { hits: [] } }) });

  const r = await consultarProcessoDataJud('50239114720258080012', 'api_publica_tjes');
  assert.equal(r.found, false);
  assert.equal(r.error, 'Processo não encontrado');
});
