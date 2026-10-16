// e2e/essencial.spec.mjs — o essencial do CRM pelo navegador, como a Dra. usa.
// Falha se: o login não entra, alguma tela principal dá erro de JavaScript ou
// resposta 5xx, ou não dá para cadastrar um cliente.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL || 'ci@teste.local';
const SENHA = process.env.ADMIN_PASSWORD || 'Ci-Teste-123456';

/** Guarda erros de JavaScript e respostas 5xx da página. */
function vigiar(page) {
  const erros = [];
  page.on('pageerror', (e) => erros.push(`JavaScript: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) erros.push(`${r.status()} em ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  return erros;
}

async function entrar(page) {
  await page.goto('/');
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(SENHA);
  await page.locator('#login-form').evaluate((f) => f.requestSubmit());
  await expect(page.locator('#app-view')).toBeVisible({ timeout: 20_000 });
}

test('login: senha errada não entra; senha certa entra', async ({ page }) => {
  await page.goto('/');
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill('senha-errada-123');
  await page.locator('#login-form').evaluate((f) => f.requestSubmit());
  await expect(page.locator('#login-error')).not.toBeEmpty();
  await expect(page.locator('#app-view')).toBeHidden();
  await entrar(page);
});

const TELAS = ['hoje', 'dashboard', 'clients', 'leads', 'cases', 'propostas', 'agenda', 'financeiro', 'escritorio'];

test('telas principais carregam de verdade, sem erro de JavaScript nem 5xx', async ({ page }) => {
  const erros = vigiar(page);
  await entrar(page);
  for (const tela of TELAS) {
    // Marca a tela anterior para não confundir o conteúdo velho com o novo.
    await page.evaluate(() => { const p = document.querySelector('#page'); if (p) p.innerHTML = ''; });
    await page.evaluate((t) => { location.hash = '#' + t; }, tela);
    // Tela que carregou tem título (.page-header h2); se a tela falha, o router
    // troca tudo por <div class="empty">mensagem</div> e não há título.
    await expect(page.locator('#page .page-header h2').first(), `tela ${tela} não carregou`).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#page .spinner'), `tela ${tela} ficou carregando`).toHaveCount(0, { timeout: 20_000 });
  }
  expect(erros, erros.join('\n')).toEqual([]);
});

test('cadastrar um cliente pela tela e ele aparecer na lista', async ({ page }) => {
  const erros = vigiar(page);
  await entrar(page);
  await page.evaluate(() => { location.hash = '#clients'; });
  await page.locator('#new-client').click();
  const nome = `Cliente Teste E2E ${Date.now()}`;
  await page.locator('#modal-body [name=name]').fill(nome);
  await page.locator('#modal-body [name=email]').fill('cliente.e2e@teste.local');
  await page.locator('#modal-body form').evaluate((f) => f.requestSubmit());
  await expect(page.locator('#toast')).toContainText('Cliente cadastrado', { timeout: 15_000 });
  await page.evaluate(() => { location.hash = '#dashboard'; });
  await page.evaluate(() => { location.hash = '#clients'; });
  await expect(page.locator('main.content')).toContainText(nome, { timeout: 15_000 });
  expect(erros, erros.join('\n')).toEqual([]);
});
