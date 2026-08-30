// tests/djenBlockedBackoff.test.mjs
// Item 6 do plano: o DJEN (comunicaapi.pje.jus.br) não tem limite de requisições
// documentado oficialmente, mas fica atrás de CloudFront e pode bloquear (429/403).
// Antes: fetchDjenByOAB tratava QUALQUER !res.ok (inclusive 429/403) como "acabaram
// as páginas" e devolvia a lista parcial em silêncio — sem avisar ninguém que foi
// bloqueio, não fim normal da busca. Isso é perigoso ao aumentar a frequência das
// buscas: o sistema coletaria cada vez menos, silenciosamente.
// Agora: 429/403 tentam de novo com backoff (poucas tentativas) e, se persistir,
// fetchDjenByOAB devolve { blocked: true } em vez de fingir que terminou normal.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/djen.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { fetchDjenByOAB } = await import('../dist/services/djen.js');

test('fetchDjenByOAB sinaliza blocked:true quando o DJEN responde 429 persistentemente (não confunde com fim das páginas)', async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  // Acelera o backoff no teste sem mudar o comportamento (mesma contagem de tentativas).
  globalThis.setTimeout = (fn, _ms) => originalSetTimeout(fn, 0);
  t.after(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalSetTimeout; });

  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 429, json: async () => ({}) };
  };

  const r = await fetchDjenByOAB('123456', 'ES', { maxPages: 3 });

  assert.equal(r.blocked, true, 'deve sinalizar bloqueio, não fim normal da busca');
  assert.deepEqual(r.publications, [], 'nenhuma publicação coletada nesta página bloqueada');
  // 1 tentativa inicial + 3 retentativas de backoff = 4 chamadas de fetch, e para
  // (não avança para a página 2 nem esgota maxPages tentando página após página).
  assert.equal(calls, 4, 'deve tentar a página bloqueada até esgotar o backoff, e então parar (não seguir para outras páginas)');
});

test('fetchDjenByOAB se recupera de um 429 passageiro (sucede antes de esgotar o backoff)', async (t) => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms) => originalSetTimeout(fn, 0);
  t.after(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalSetTimeout; });

  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };

  const r = await fetchDjenByOAB('123456', 'ES', { maxPages: 3 });

  assert.equal(r.blocked, false, 'não deve marcar bloqueio quando a 2ª tentativa já teve sucesso');
  assert.equal(calls, 2, 'deve ter tentado de novo só 1x após o 429 passageiro');
});

test('fetchDjenByOAB trata fim normal das páginas (200 com lista vazia) como não-bloqueado, igual antes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) });

  const r = await fetchDjenByOAB('123456', 'ES', { maxPages: 3 });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.publications, []);
});
