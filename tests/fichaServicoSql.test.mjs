// tests/fichaServicoSql.test.mjs — a ficha automática não pode quebrar na data de nascimento
// Produção (11/2026): "[ficha] falhou: Incorrect date value: '' for column 'birth_date'":
// NULLIF(birth_date, '') compara DATE com texto vazio e o MySQL estrito recusa o UPDATE inteiro.
import { test } from 'node:test';
import assert from 'node:assert';
import { preencherSeVazio } from '../dist/services/fichaServico.js';

test('preencherSeVazio: birth_date usa só COALESCE (nada de NULLIF com texto vazio)', () => {
  const sql = preencherSeVazio('birth_date');
  assert.strictEqual(sql, 'birth_date = COALESCE(birth_date, ?)');
  assert.doesNotMatch(sql, /NULLIF/);
});

test('preencherSeVazio: colunas de texto continuam tratando "" como vazio', () => {
  assert.strictEqual(preencherSeVazio('email'), "email = COALESCE(NULLIF(email, ''), ?)");
});
