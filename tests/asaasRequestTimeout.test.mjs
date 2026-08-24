// tests/asaasRequestTimeout.test.mjs
// Achado C2/C3: a função privada request() do asaasService fazia fetch sem
// timeout algum — se o Asaas ficar lento/fora do ar, a chamada trava
// indefinidamente. Confirma que há um AbortController com timeout, tanto na
// fonte (revisão estática) quanto no comportamento real (fetch mockado que
// nunca resolve deve estourar o timeout, não travar o teste para sempre).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

test('request() interno do asaasService usa AbortController com timeout', () => {
  const src = fs.readFileSync(path.resolve('src/services/asaasService.ts'), 'utf8');
  assert.match(src, /AbortController/, 'falta AbortController para limitar o tempo de espera da chamada ao Asaas');
  assert.match(src, /setTimeout\(\s*\(\)\s*=>\s*controller\.abort\(\)/, 'o timeout precisa chamar controller.abort()');
  assert.match(src, /signal:\s*controller\.signal/, 'o fetch precisa receber o signal do AbortController');
});

if (!existsSync(new URL('../dist/services/asaasService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}

test('chamada ao Asaas que nunca resolve estoura em timeout, não trava indefinidamente', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  process.env.ASAAS_TEST_API_KEY = 'chave-fake-sandbox';
  // Mocka fetch para respeitar o AbortSignal (como o fetch real faz), mas nunca
  // resolver por conta própria — só o abort() do timeout deve rejeitar a promise.
  globalThis.fetch = (url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  const { createAsaasCharge } = await import('../dist/services/asaasService.js?t=' + Date.now());
  await assert.rejects(
    () => createAsaasCharge({ customerId: 'cus_1', billingType: 'BOLETO', value: 10, dueDate: '2026-09-01', description: 'x' }),
    /timeout/i
  );
  delete process.env.ASAAS_TEST_API_KEY;
});
