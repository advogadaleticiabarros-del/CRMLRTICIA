// tests/restoreFluxo.test.mjs
// Incidente 11/10/2026: a prova de restauração falhou com "Cannot create a
// string longer than 0x1fffffe8 characters" — o dump (656 MB de SQL) era
// descomprimido inteiro num único texto, e o Node só aceita ~512 MB.
// A restauração agora lê o dump em fluxo, comando por comando.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

process.env.JWT_SECRET = 'x'.repeat(32);
const { DivisorSql } = await import('../dist/utils/divisorSql.js');
const { dividirStatements } = await import('../dist/config/migrations.js');
const { executarDumpEmFluxo } = await import('../dist/services/restoreFluxo.js');

/** Cópia fiel do divisor ANTIGO das migrations (até 12/10/2026) — referência de comportamento. */
function dividirAntigo(sql) {
  const out = []; let atual = ''; let aspas = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]; const prox = sql[i + 1];
    if (aspas) { atual += c; if (c === '\\') { if (prox !== undefined) { atual += prox; i++; } continue; } if (c === aspas) aspas = null; continue; }
    if (c === '-' && prox === '-') { while (i < sql.length && sql[i] !== '\n') i++; atual += '\n'; continue; }
    if (c === '/' && prox === '*') { i += 2; while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { aspas = c; atual += c; continue; }
    if (c === ';') { const s = atual.trim(); if (s) out.push(s); atual = ''; continue; }
    atual += c;
  }
  const resto = atual.trim(); if (resto) out.push(resto);
  return out;
}

/** Divide o texto em pedaços de `tam` caracteres e passa pelo divisor em fluxo. */
function emPedacos(sql, tam) {
  const d = new DivisorSql();
  const out = [];
  for (let i = 0; i < sql.length; i += tam) out.push(...d.push(sql.slice(i, i + tam)));
  out.push(...d.finalizar());
  return out;
}

const CASOS_DIFICEIS = [
  `CREATE TABLE t (\n  a INT,\n  teses TEXT NULL,   -- separadas por ';'\n  b INT\n);`,
  `INSERT INTO t (txt) VALUES ('a; b');`,
  `INSERT INTO t (txt) VALUES ('traco -- duplo');`,
  `-- só um comentário\nSELECT 1;`,
  `ALTER TABLE a ADD COLUMN x INT;\nALTER TABLE b ADD COLUMN y INT;`,
  `INSERT INTO t VALUES ('it\\'s; ok', "aspas \\" duplas; aqui", \`col;una\`);`,
  `/* bloco ; com ponto e vírgula */ SELECT 2; /*/ ainda comentário */ SELECT 3;`,
  `SELECT 4 - 1; SELECT 5 / 1; SELECT '\\\\'; SELECT 6`,
  `INSERT INTO m (data) VALUES (X'${'AB01'.repeat(5000)}');\nINSERT INTO c (nome) VALUES ('José; Conceição — ação');`,
  `SELECT 1; -- comentário no fim sem quebra de linha`,
  `SELECT 1; /* comentário de bloco sem fechar`,
];

test('em fluxo, qualquer tamanho de pedaço dá o MESMO resultado que o texto inteiro', () => {
  for (const sql of CASOS_DIFICEIS) {
    const inteiro = dividirAntigo(sql);
    assert.deepEqual(dividirStatements(sql), inteiro, `migrations mudou de comportamento em: ${sql.slice(0, 60)}`);
    for (const tam of [1, 2, 3, 5, 7, 64, 1000]) {
      assert.deepEqual(emPedacos(sql, tam), inteiro, `pedaços de ${tam} em: ${sql.slice(0, 60)}`);
    }
  }
});

test('em fluxo, todas as migrations reais dão o mesmo resultado que o texto inteiro', () => {
  const dir = path.resolve('migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const inteiro = dividirAntigo(sql);
    assert.deepEqual(dividirStatements(sql), inteiro, `${f}: migrations mudou de comportamento`);
    for (const tam of [1, 13, 4096]) assert.deepEqual(emPedacos(sql, tam), inteiro, `${f} em pedaços de ${tam}`);
  }
});

test('casos antigos do divisor continuam iguais (comentário inline, ; em string)', () => {
  assert.deepEqual(dividirStatements(CASOS_DIFICEIS[0]).length, 1);
  assert.ok(!dividirStatements(CASOS_DIFICEIS[0])[0].includes('separadas'));
  assert.deepEqual(dividirStatements(`-- só um comentário\nSELECT 1;`), ['SELECT 1']);
  assert.deepEqual(dividirStatements(CASOS_DIFICEIS[6]), ['SELECT 2', 'SELECT 3']);
});

test('divisor recusa um comando maior que o limite, com mensagem clara', () => {
  const d = new DivisorSql(100);
  assert.throws(() => d.push(`INSERT INTO m VALUES (X'${'A'.repeat(200)}');`), /maior que o limite/);
});

test('executarDumpEmFluxo restaura um dump gzip comando por comando, com acentos e binário em hex', async () => {
  // dump com vários registros binários grandes (como a mídia do WhatsApp)
  const linhas = ['CREATE TABLE `clients` (`id` int, `nome` varchar(50));'];
  for (let i = 0; i < 40; i++) linhas.push(`INSERT INTO \`m\` VALUES (${i}, X'${'0F'.repeat(50_000)}');`);
  linhas.push("INSERT INTO `clients` VALUES (1, 'Conceição; ação');");
  const sql = linhas.join('\n');
  const gz = zlib.gzipSync(Buffer.from(sql, 'utf8'));

  const executados = [];
  const r = await executarDumpEmFluxo(gz, async (s) => { executados.push(s); });
  assert.deepEqual(executados, dividirStatements(sql));
  assert.equal(r.comandos, 42);
  assert.equal(r.temCreateTable, true);
  assert.equal(executados.at(-1), "INSERT INTO `clients` VALUES (1, 'Conceição; ação')");
});

test('executarDumpEmFluxo avisa quando um comando passa do limite do MySQL', async () => {
  const gz = zlib.gzipSync(Buffer.from(`CREATE TABLE a (x int);\nINSERT INTO a VALUES (X'${'AB'.repeat(1000)}');`));
  await assert.rejects(executarDumpEmFluxo(gz, async () => {}, 500), /maior que o limite/);
});

test('executarDumpEmFluxo reconhece o CREATE TABLE no formato REAL da lib mysqldump (cabeçalho com #)', async () => {
  // Formato exato gravado pela lib (node_modules/mysqldump): 3 linhas "# ..." antes de cada tabela.
  // A 1ª versão da correção exigia o comando COMEÇANDO com CREATE TABLE e deu falso
  // "Dump sem CREATE TABLE" na prova real de 12/10/2026.
  const sql = [
    '# ------------------------------------------------------------',
    '# SCHEMA DUMP FOR TABLE: clients',
    '# ------------------------------------------------------------',
    '',
    'CREATE TABLE IF NOT EXISTS `clients` (`id` int);',
    '',
    '# ------------------------------------------------------------',
    '# DATA DUMP FOR TABLE: clients',
    '# ------------------------------------------------------------',
    '',
    "INSERT INTO `clients` (`id`) VALUES (1);",
  ].join('\n');
  const r = await executarDumpEmFluxo(zlib.gzipSync(Buffer.from(sql)), async () => {});
  assert.equal(r.temCreateTable, true);
  assert.equal(r.comandos, 2);
});

test('executarDumpEmFluxo acusa dump sem CREATE TABLE', async () => {
  const r = await executarDumpEmFluxo(zlib.gzipSync(Buffer.from('SELECT 1;')), async () => {});
  assert.equal(r.temCreateTable, false);
});
