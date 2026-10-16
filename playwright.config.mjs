// Teste de ponta a ponta (16/10/2026): um navegador de verdade entra no CRM e
// percorre as telas principais. Roda no CI (GitHub) com um banco descartável;
// o CRM sobe sem as rotinas automáticas (CRONS_DESLIGADOS=1).
import { defineConfig } from '@playwright/test';

const PORTA = process.env.PORT || '3001';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node dist/index.js',
    url: `http://127.0.0.1:${PORTA}/`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, CRONS_DESLIGADOS: '1', PORT: PORTA },
  },
});
