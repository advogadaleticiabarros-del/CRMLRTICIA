// tests/leadsAiQualification.test.mjs
// parseLeadQualification é o parser PURO (sem I/O) da resposta da IA
// pra qualificação automática de lead — mesmo padrão de tolerância a
// formato inesperado que parseMovementAiResponse já usa em produção
// (aiAssistant.ts:283-297). Ver
// docs/superpowers/specs/2026-08-25-qualificacao-ia-lead.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { parseLeadQualification } = await import('../dist/services/aiAssistant.js');

test('resposta bem formada: extrai os 3 campos corretamente', () => {
  const texto = `ÁREA: trabalhista
URGÊNCIA: Alta
FAIXA DE VALOR: Alto`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.legal_area, 'trabalhista');
  assert.strictEqual(r.ai_urgency, 'alta');
  assert.strictEqual(r.ai_value_range, 'alto');
});

test('legal_area fora das 7 chaves válidas vira null, não quebra', () => {
  const texto = `ÁREA: direito penal
URGÊNCIA: Média
FAIXA DE VALOR: Médio`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.legal_area, null, 'área inválida deveria virar null, não quebrar nem inventar valor');
  assert.strictEqual(r.ai_urgency, 'media');
  assert.strictEqual(r.ai_value_range, 'medio');
});

test('ai_urgency fora de alta/media/baixa cai no fallback conservador (baixa)', () => {
  const texto = `ÁREA: civel
URGÊNCIA: Urgentíssimo
FAIXA DE VALOR: Baixo`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.ai_urgency, 'baixa', 'valor fora do esperado deveria cair no default conservador, igual PRIORIDADE em parseMovementAiResponse');
});

test('ai_value_range fora de alto/medio/baixo cai em null (sem inventar faixa)', () => {
  const texto = `ÁREA: familia
URGÊNCIA: Baixa
FAIXA DE VALOR: Não sei dizer`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.ai_value_range, null);
});

test('texto vazio ou sem nenhum campo reconhecível: tudo null, não lança exceção', () => {
  assert.doesNotThrow(() => parseLeadQualification(''));
  const r = parseLeadQualification('texto qualquer sem os rótulos esperados');
  assert.strictEqual(r.legal_area, null);
  assert.strictEqual(r.ai_urgency, null);
  assert.strictEqual(r.ai_value_range, null);
});
