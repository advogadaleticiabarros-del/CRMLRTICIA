import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * AUDITORIA DOS DASHBOARDS — contra o schema REAL.
 *
 * Três bugs reais motivaram este teste, e os três "pareciam funcionar":
 *   1. Processos  → `WHERE user_id = ?` numa tabela SEM essa coluna → erro 500
 *   2. Produção   → media `legal_pieces`, tabela onde NADA é inserido → zero eterno
 *   3. Rotinas    → a tabela `job_runs` nem existia (migrations paradas)
 *
 * Mostrar zero passa por "ainda não tem dado". Por isso ninguém reclama — e o
 * painel mente por meses. Este teste cruza cada query com o schema de verdade.
 */

const raiz = path.resolve('.');
const migDir = path.join(raiz, 'migrations');
const dashDir = path.join(raiz, 'src/routes/dashboards');

// ── 1. Monta o schema real a partir das migrations ─────────────────────────
function lerSchema() {
  const tabelas = new Map(); // nome -> Set(colunas)
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8')
      .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'); // tira comentários

    // CREATE TABLE [IF NOT EXISTS] nome ( ... )
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)\s*(?:ENGINE|;|$)/gi;
    let m;
    while ((m = re.exec(sql))) {
      const nome = m[1].toLowerCase();
      const corpo = m[2];
      const cols = tabelas.get(nome) || new Set();
      for (const linha of corpo.split(',')) {
        const c = linha.trim().match(/^[`"]?(\w+)[`"]?\s+(INT|BIGINT|VARCHAR|TEXT|LONGTEXT|DATETIME|TIMESTAMP|DATE|DECIMAL|ENUM|JSON|TINYINT|BOOLEAN|LONGBLOB|BLOB|FLOAT|DOUBLE)/i);
        if (c) cols.add(c[1].toLowerCase());
      }
      tabelas.set(nome, cols);
    }

    // ALTER TABLE nome ADD COLUMN a ..., ADD COLUMN b ...;
    // ⚠️ Um ALTER pode adicionar VÁRIAS colunas separadas por vírgula. A versão
    // anterior só pegava a PRIMEIRA — e por isso acusou falsamente que
    // `cases.production_assignee` e `detected_deadlines.ai_draft_id` não existiam.
    // `[^;]*` para no ';' OU no fim do arquivo — várias migrations (ex.: a 056,
    // do valor_causa) NÃO terminam com ponto e vírgula. Exigi-lo dava outro
    // falso positivo.
    const reAlter = /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?([^;]*)/gi;
    while ((m = reAlter.exec(sql))) {
      const t = m[1].toLowerCase();
      const corpo = m[2];
      if (!tabelas.has(t)) tabelas.set(t, new Set());
      for (const c of corpo.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi)) {
        tabelas.get(t).add(c[1].toLowerCase());
      }
    }
  }
  return tabelas;
}

// ── 2. Tabelas em que o código realmente ESCREVE (detecta tabela morta) ────
function tabelasComEscrita() {
  const escritas = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/INSERT\s+INTO\s+[`"]?(\w+)[`"]?/gi)) escritas.add(m[1].toLowerCase());
      for (const m of src.matchAll(/UPDATE\s+[`"]?(\w+)[`"]?\s+SET/gi)) escritas.add(m[1].toLowerCase());
    }
  };
  walk(path.join(raiz, 'src'));
  return escritas;
}

// ── 3. Extrai as tabelas que cada dashboard consulta ───────────────────────
function tabelasDoArquivo(src) {
  const t = new Set();
  for (const m of src.matchAll(/\b(?:FROM|JOIN)\s+[`"]?(\w+)[`"]?/gi)) {
    const n = m[1].toLowerCase();
    if (['select', 'dual', 'information_schema'].includes(n)) continue;
    t.add(n);
  }
  return t;
}

const SCHEMA = lerSchema();
const ESCRITAS = tabelasComEscrita();
const DASHBOARDS = fs.readdirSync(dashDir).filter((f) => f.endsWith('.ts'));

// Tabelas de sistema/derivadas que não vêm das migrations
const IGNORAR = new Set(['information_schema', 'tables', 'u', 'c', 'cl', 'j', 'f']);

test('a auditoria conseguiu ler o schema real', () => {
  assert.ok(SCHEMA.size > 30, `esperava dezenas de tabelas, achei ${SCHEMA.size}`);
  assert.ok(DASHBOARDS.length >= 5, `esperava vários dashboards, achei ${DASHBOARDS.length}`);
});

test('todo dashboard consulta apenas tabelas que EXISTEM no banco', () => {
  const erros = [];
  for (const f of DASHBOARDS) {
    const src = fs.readFileSync(path.join(dashDir, f), 'utf8');
    for (const t of tabelasDoArquivo(src)) {
      if (IGNORAR.has(t)) continue;
      if (!SCHEMA.has(t)) erros.push(`${f}: consulta a tabela "${t}", que NÃO existe nas migrations`);
    }
  }
  assert.deepEqual(erros, [], '\n  ' + erros.join('\n  '));
});

test('nenhum dashboard mede uma tabela MORTA (onde o código nunca escreve)', () => {
  // Foi este o bug do dashboard de Produção: media `legal_pieces`, onde nada
  // é inserido → mostrava zero para sempre, com a esteira cheia.
  const erros = [];
  for (const f of DASHBOARDS) {
    const src = fs.readFileSync(path.join(dashDir, f), 'utf8');
    for (const t of tabelasDoArquivo(src)) {
      if (IGNORAR.has(t) || !SCHEMA.has(t)) continue;
      if (!ESCRITAS.has(t)) {
        erros.push(`${f}: mede "${t}", mas NENHUM código insere/atualiza essa tabela — o painel vai mostrar zero para sempre`);
      }
    }
  }
  assert.deepEqual(erros, [], '\n  ' + erros.join('\n  '));
});

test('nenhum dashboard filtra por uma coluna que NÃO existe na tabela', () => {
  // Foi este o bug do dashboard de Processos: `WHERE user_id = ?` em
  // legal_processes, que não tem essa coluna → erro 500.
  const erros = [];
  for (const f of DASHBOARDS) {
    const src = fs.readFileSync(path.join(dashDir, f), 'utf8');

    // pega blocos de SQL (template literals com FROM)
    for (const bloco of src.match(/`[^`]*\bFROM\b[^`]*`/gi) || []) {
      // mapeia alias -> tabela  (FROM cases c / JOIN clients cl ON ...)
      const alias = new Map();
      for (const m of bloco.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)\b/gi)) {
        const [, tab, al] = m;
        if (['on', 'where', 'group', 'order', 'set', 'left', 'inner', 'join'].includes(al.toLowerCase())) continue;
        alias.set(al.toLowerCase(), tab.toLowerCase());
      }
      // tabela única sem alias
      const unica = [...tabelasDoArquivo(bloco)].filter((t) => SCHEMA.has(t));

      // referências alias.coluna
      for (const m of bloco.matchAll(/\b(\w+)\.(\w+)\b/g)) {
        const [, a, col] = m;
        const tab = alias.get(a.toLowerCase());
        if (!tab || !SCHEMA.has(tab)) continue;
        if (!SCHEMA.get(tab).has(col.toLowerCase())) {
          erros.push(`${f}: usa "${a}.${col}", mas a tabela "${tab}" não tem a coluna "${col}"`);
        }
      }

      // WHERE user_id numa tabela única que não tem user_id
      if (unica.length === 1 && /\bWHERE\b[\s\S]*\buser_id\s*=/i.test(bloco)) {
        const t = unica[0];
        if (!SCHEMA.get(t).has('user_id')) {
          erros.push(`${f}: filtra por "user_id" em "${t}", que NÃO tem essa coluna`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(erros)], [], '\n  ' + [...new Set(erros)].join('\n  '));
});
