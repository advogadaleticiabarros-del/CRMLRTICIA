// tests/financeRemindersAsaasExcluido.test.mjs
// Achado I2 (parte 2): alertStuckPayments() roda a cada 6h e avisa quando um
// pagamento fica 'em_processamento' por 48h+. Isso é normal para boleto/cartão
// Asaas com vencimento futuro (não é "parado") — só pix_manual (confirmação
// manual da advogada) deve gerar esse alarme.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('alertStuckPayments exclui os métodos Asaas da consulta de pagamentos parados', () => {
  const src = fs.readFileSync(path.resolve('src/services/financeReminders.ts'), 'utf8');
  const m = src.match(/export async function alertStuckPayments[\s\S]*?\n\}/);
  assert.ok(m, 'alertStuckPayments não encontrada');
  assert.match(
    m[0],
    /method\s*=\s*'pix_manual'/,
    "a query precisa restringir a method = 'pix_manual' — boleto/cartão Asaas ficam em_processamento até o vencimento por definição, não é um pagamento parado"
  );
});
