// Testa a paginação genérica usada para não cortar eventos do Google Calendar
// em 100 resultados (bug: compromissos futuros somiam quando havia mais de
// 100 eventos no período de 25 meses varrido).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/googlePagination.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { collectAllPages } = await import('../dist/services/googlePagination.js');

test('uma única página sem nextPageToken devolve só os itens dela', async () => {
  const r = await collectAllPages(async () => ({ items: [1, 2, 3] }));
  assert.deepEqual(r, [1, 2, 3]);
});

test('duas páginas são concatenadas na ordem', async () => {
  let calls = 0;
  const r = await collectAllPages(async (token) => {
    calls++;
    if (!token) return { items: [1, 2], nextPageToken: 'abc' };
    assert.equal(token, 'abc');
    return { items: [3, 4] };
  });
  assert.deepEqual(r, [1, 2, 3, 4]);
  assert.equal(calls, 2);
});

test('mais de 100 itens (3 páginas de ~50) não corta nada — reproduz o bug original', async () => {
  const totalPaginas = 3;
  let pagina = 0;
  const r = await collectAllPages(async () => {
    pagina++;
    const items = Array.from({ length: 50 }, (_, i) => `evento-${pagina}-${i}`);
    return { items, nextPageToken: pagina < totalPaginas ? `p${pagina}` : null };
  });
  assert.equal(r.length, 150);
  assert.equal(r[0], 'evento-1-0');
  assert.equal(r[149], 'evento-3-49');
});

test('página vazia sem items não quebra (items ausente)', async () => {
  const r = await collectAllPages(async () => ({}));
  assert.deepEqual(r, []);
});
