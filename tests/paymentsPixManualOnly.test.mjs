// tests/paymentsPixManualOnly.test.mjs
// Achado I2: cobranças Asaas (boleto/cartão) entram em 'em_processamento'
// automaticamente no aceite da proposta, sem o cliente ter declarado nada no
// portal — não devem poluir a fila "Pagamentos a confirmar" (essa fila é só
// para o fluxo pix_manual, onde o cliente clica "já paguei" e a advogada
// confirma manualmente). Cobranças Asaas são confirmadas sozinhas pelo webhook.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('GET /api/payments só devolve method = pix_manual', () => {
  const src = fs.readFileSync(path.resolve('src/routes/payments.ts'), 'utf8');
  const m = src.match(/router\.get\('\/'[\s\S]*?\n\}\);/);
  assert.ok(m, "rota GET /api/payments não encontrada");
  assert.match(
    m[0],
    /p\.method\s*=\s*'pix_manual'/,
    'a listagem precisa filtrar method = pix_manual — cobranças Asaas não pedem confirmação manual'
  );
});
