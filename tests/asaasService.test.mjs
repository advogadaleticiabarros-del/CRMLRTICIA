// tests/asaasService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/asaasService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { ensureAsaasCustomer } = await import('../dist/services/asaasService.js');

test('ensureAsaasCustomer lança erro claro quando a chave não está configurada', async () => {
  const originalFetch = globalThis.fetch;
  // Sem chave no banco simulado: mocka a leitura de config para devolver vazio.
  process.env.ASAAS_TEST_FORCE_EMPTY_KEY = '1';
  try {
    await assert.rejects(
      () => ensureAsaasCustomer({ id: 1, name: 'Teste', cpf_cnpj: '12345678900' }),
      /Asaas não configurado/i
    );
  } finally {
    delete process.env.ASAAS_TEST_FORCE_EMPTY_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('ensureAsaasCustomer cria e devolve o id do cliente no Asaas', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/customers') && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      assert.equal(body.name, 'Maria da Silva');
      assert.equal(body.cpfCnpj, '12345678900');
      return { ok: true, status: 200, json: async () => ({ id: 'cus_000001', name: body.name, cpfCnpj: body.cpfCnpj }) };
    }
    throw new Error('chamada inesperada: ' + url);
  };
  const { ensureAsaasCustomer: fn } = await import('../dist/services/asaasService.js?t=' + Date.now());
  // Simula config presente via variável de ambiente de teste (ver Step 3 da implementação).
  process.env.ASAAS_TEST_API_KEY = 'chave-fake-sandbox';
  process.env.ASAAS_TEST_BASE_URL = 'https://sandbox.asaas.com/api/v3';
  try {
    // ensureAsaasCustomer grava clients.asaas_customer_id no banco real ao
    // final — exige MySQL acessível, diferente do resto da suíte (que audita
    // schema estaticamente). Pula com aviso quando o banco local não está
    // configurado, em vez de falhar — mesmo padrão já usado em
    // tests/whatsappTranscricao.test.mjs para garantirMidiaTranscrita.
    const cust = await fn({ id: 1, name: 'Maria da Silva', cpf_cnpj: '12345678900' });
    assert.equal(cust.id, 'cus_000001');
  } catch (e) {
    if (/Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(e.message || '')) {
      t.skip(`MySQL local indisponível neste ambiente (${e.message}) — teste requer banco real`);
      return;
    }
    throw e;
  } finally {
    delete process.env.ASAAS_TEST_API_KEY;
    delete process.env.ASAAS_TEST_BASE_URL;
  }
});
