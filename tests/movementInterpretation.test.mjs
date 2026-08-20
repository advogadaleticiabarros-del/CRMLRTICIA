// tests/movementInterpretation.test.mjs
// Testa o parser da resposta da IA isoladamente — não faz chamada de rede.
// A chamada real a aiComplete() é coberta por teste manual (documentado no
// PR), já que depende de GROQ_API_KEY em ambiente.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/aiAssistant.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { parseMovementAiResponse } = await import('../dist/services/aiAssistant.js');

test('parseia resposta bem formada da IA', () => {
  const texto = `RESUMO: Juízo determinou apresentação dos cálculos em 8 dias.
AÇÃO: preparar liquidação no PJe-Calc
PRAZO INTERNO: 25/08/2026
PRIORIDADE: Alta`;
  const r = parseMovementAiResponse(texto);
  assert.equal(r.resumo, 'Juízo determinou apresentação dos cálculos em 8 dias.');
  assert.equal(r.acao, 'preparar liquidação no PJe-Calc');
  assert.equal(r.prazo_interno, '25/08/2026');
  assert.equal(r.prioridade, 'Alta');
});

test('prioridade fora do vocabulário esperado cai para Baixa (nunca quebra)', () => {
  const texto = `RESUMO: teste
AÇÃO: nenhuma
PRAZO INTERNO: sem prazo
PRIORIDADE: Urgentíssimo`;
  assert.equal(parseMovementAiResponse(texto).prioridade, 'Baixa');
});

test('resposta sem os marcadores esperados devolve valores vazios, sem lançar', () => {
  const r = parseMovementAiResponse('texto solto sem formato nenhum');
  assert.equal(r.resumo, '');
  assert.equal(r.prioridade, 'Baixa');
});
