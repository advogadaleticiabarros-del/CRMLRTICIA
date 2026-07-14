import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.JWT_SECRET = 'x'.repeat(32);
const { dividirStatements } = await import('../dist/config/migrations.js');

// ── O bug que derrubou a migration 068 em produção ──────────────────────────
test('comentário INLINE com ; não corta o comando ao meio (bug da 068)', () => {
  const sql = `CREATE TABLE t (
  a INT,
  teses TEXT NULL,   -- separadas por ';'
  b INT
);`;
  const st = dividirStatements(sql);
  assert.equal(st.length, 1, 'era para ser UM comando, não dois pedaços quebrados');
  assert.ok(st[0].includes('CREATE TABLE'));
  assert.ok(st[0].includes('b INT'), 'o final do comando não pode ser perdido');
  assert.ok(!st[0].includes('separadas'), 'o comentário deve ser removido');
});

test('; DENTRO de string não é tratado como fim de comando', () => {
  const sql = `INSERT INTO t (txt) VALUES ('a; b');`;
  const st = dividirStatements(sql);
  assert.equal(st.length, 1);
  assert.ok(st[0].includes("'a; b'"), 'a string precisa chegar inteira ao banco');
});

test('-- DENTRO de string não vira comentário', () => {
  const sql = `INSERT INTO t (txt) VALUES ('traco -- duplo');`;
  const st = dividirStatements(sql);
  assert.equal(st.length, 1);
  assert.ok(st[0].includes('traco -- duplo'), 'não pode cortar o conteúdo do texto');
});

test('comentário de linha inteira é removido', () => {
  const st = dividirStatements(`-- só um comentário\nSELECT 1;`);
  assert.equal(st.length, 1);
  assert.equal(st[0], 'SELECT 1');
});

test('vários comandos são separados corretamente', () => {
  const st = dividirStatements(`ALTER TABLE a ADD COLUMN x INT;\nALTER TABLE b ADD COLUMN y INT;`);
  assert.equal(st.length, 2);
});

// ── Prova real: roda contra TODAS as migrations do projeto ──────────────────
test('as 70+ migrations reais são divididas sem perder comandos', () => {
  const dir = path.resolve('migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length > 60, 'deve haver dezenas de migrations');

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const st = dividirStatements(sql);

    for (const s of st) {
      // Nenhum comando pode sobrar vazio ou virar só um resto de comentário
      assert.ok(s.length > 3, `${f}: gerou um comando vazio/truncado: "${s}"`);
      // Um CREATE TABLE tem que estar FECHADO — era isso que quebrava na 068
      if (/^CREATE TABLE/i.test(s)) {
        const abre = (s.match(/\(/g) || []).length;
        const fecha = (s.match(/\)/g) || []).length;
        assert.equal(abre, fecha, `${f}: CREATE TABLE com parênteses desbalanceados — comando cortado ao meio!`);
      }
    }
  }
});
