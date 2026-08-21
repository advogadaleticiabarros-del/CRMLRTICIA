// Bug real de produção: leads.state é VARCHAR(2) (sigla de UF), mas o campo
// "UF" no cadastro era um texto livre sem limite — digitar o nome completo do
// estado ("Espírito Santo") derrubava o INSERT com "Data too long for column
// 'state'", virando "Erro interno do servidor" pra usuária. Corrigido em dois
// pontos: maxlength=2 no campo (public/app.js) + truncagem no servidor aqui
// (defesa em profundidade, cobre qualquer outra origem futura do dado).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/leads.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { normalizeExtraVal } = await import('../dist/routes/leads.js');

test('state maior que 2 caracteres é truncado (nunca mais estoura o VARCHAR(2))', () => {
  assert.equal(normalizeExtraVal('state', 'Espírito Santo'), 'ES');
});

test('state normal (sigla) só normaliza pra maiúsculo', () => {
  assert.equal(normalizeExtraVal('state', 'es'), 'ES');
  assert.equal(normalizeExtraVal('state', 'SP'), 'SP');
});

test('estimated_value e close_probability continuam convertendo pra número', () => {
  assert.equal(normalizeExtraVal('estimated_value', '1500.50'), 1500.5);
  assert.equal(normalizeExtraVal('close_probability', '80'), 80);
});

test('outras colunas passam intocadas', () => {
  assert.equal(normalizeExtraVal('city', 'Vitória'), 'Vitória');
});
