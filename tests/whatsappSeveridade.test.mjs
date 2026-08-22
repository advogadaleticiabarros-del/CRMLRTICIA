// tests/whatsappSeveridade.test.mjs
// Mesmos limiares do Briefing Jurídico Matinal (briefingSeverity.ts) — ver spec
// docs/superpowers/specs/2026-08-21-whatsapp-conversas-redesign.md.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/whatsappSeveridade.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { severidadeConversa, etiquetaPendencia } = await import('../dist/services/whatsappSeveridade.js');

test('audiência hoje é crítica', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 0, parcela_vencendo_dias: null }), 'critica');
});
test('audiência em 2 dias é crítica', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 2, parcela_vencendo_dias: null }), 'critica');
});
test('audiência em 5 dias é atenção', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 5, parcela_vencendo_dias: null }), 'atencao');
});
test('audiência em 7 dias é atenção, em 8 dias é neutra', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 7, parcela_vencendo_dias: null }), 'atencao');
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 8, parcela_vencendo_dias: null }), 'neutra');
});
test('sem audiência nem parcela é neutra', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: null }), 'neutra');
});
test('parcela atrasada (negativa) é crítica mesmo sem audiência', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: -2 }), 'critica');
});
test('parcela vencendo hoje é crítica', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: 0 }), 'critica');
});
test('parcela em 3 dias é atenção, em 4 dias é neutra', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: 3 }), 'atencao');
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: 4 }), 'neutra');
});
test('o pior dos dois indicadores prevalece', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 8, parcela_vencendo_dias: 0 }), 'critica');
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 5, parcela_vencendo_dias: 4 }), 'atencao');
});

test('etiquetaPendencia mostra audiência quando ela é a mais urgente', () => {
  const e = etiquetaPendencia({ proxima_audiencia_dias: 2, parcela_vencendo_dias: 5 });
  assert.equal(e.icone, 'scale');
  assert.match(e.texto, /Audiência em 2 dias/);
});
test('etiquetaPendencia mostra parcela quando ela é a mais urgente', () => {
  const e = etiquetaPendencia({ proxima_audiencia_dias: 6, parcela_vencendo_dias: 0 });
  assert.equal(e.icone, 'banknote');
  assert.match(e.texto, /Parcela vence hoje/);
});
test('etiquetaPendencia é null quando neutra', () => {
  assert.equal(etiquetaPendencia({ proxima_audiencia_dias: null, parcela_vencendo_dias: null }), null);
});
test('etiquetaPendencia usa "hoje"/"atrasada" nos extremos', () => {
  assert.match(etiquetaPendencia({ proxima_audiencia_dias: 0, parcela_vencendo_dias: null }).texto, /Audiência hoje/);
  assert.match(etiquetaPendencia({ proxima_audiencia_dias: null, parcela_vencendo_dias: -1 }).texto, /Parcela atrasada/);
});
test('etiquetaPendencia: em empate de severidade, audiência prevalece sobre parcela', () => {
  // audiência hoje (crítica) + parcela hoje (crítica) — mesma severidade, audiência vence
  const e1 = etiquetaPendencia({ proxima_audiencia_dias: 0, parcela_vencendo_dias: 0 });
  assert.equal(e1.icone, 'scale');
  assert.match(e1.texto, /Audiência hoje/);
  // audiência em 5 dias (atenção) + parcela em 2 dias (atenção) — mesma severidade, audiência vence
  const e2 = etiquetaPendencia({ proxima_audiencia_dias: 5, parcela_vencendo_dias: 2 });
  assert.equal(e2.icone, 'scale');
  assert.match(e2.texto, /Audiência em 5 dias/);
});
