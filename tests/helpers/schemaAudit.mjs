// Mecanismo genérico de auditoria de queries SQL contra o schema real
// (extraído de tests/dashboards.test.mjs para ser reaproveitado por outros
// testes que auditam arquivos fora de src/routes/dashboards — ex.:
// tests/briefingDataBlocks.test.mjs).
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve('.');
const migDir = path.join(raiz, 'migrations');

// ── Monta o schema real a partir das migrations ─────────────────────────
export function lerSchema() {
  const tabelas = new Map(); // nome -> Set(colunas)
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  for (const f of files) {
    // `\r` sai primeiro: com CRLF, o `.` da regex não casa com \r e o strip falha.
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8')
      .replace(/\r/g, '')
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

// ── Tabelas em que o código realmente ESCREVE (detecta tabela morta) ────
export function tabelasComEscrita() {
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

// ── Extrai as tabelas que um arquivo consulta (FROM/JOIN) ───────────────
export function tabelasDoArquivo(src) {
  const t = new Set();
  for (const m of src.matchAll(/\b(?:FROM|JOIN)\s+[`"]?(\w+)[`"]?/gi)) {
    const n = m[1].toLowerCase();
    if (['select', 'dual', 'information_schema'].includes(n)) continue;
    t.add(n);
  }
  return t;
}

// Tabelas de sistema/derivadas que não vêm das migrations, ou aliases de
// uma letra só que o parser de FROM/JOIN pode confundir com nome de tabela.
export const IGNORAR = new Set(['information_schema', 'tables', 'u', 'c', 'cl', 'j', 'f']);

// Palavras-chave/funções SQL que não são nomes de coluna — usadas ao checar
// referências de coluna SEM prefixo de alias (ex.: `COALESCE(area, ...)`).
const SQL_PALAVRAS_RESERVADAS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'as', 'on', 'join', 'left', 'inner',
  'right', 'outer', 'group', 'order', 'by', 'limit', 'asc', 'desc', 'in', 'is', 'like', 'between',
  'coalesce', 'sum', 'count', 'avg', 'min', 'max', 'now', 'curdate', 'date', 'datediff', 'date_sub',
  'date_add', 'interval', 'day', 'days', 'hour', 'month', 'year', 'convert_tz', 'time_format', 'field',
  'distinct', 'case', 'when', 'then', 'else', 'end', 'true', 'false', 'exists', 'union', 'all',
]);

/**
 * Audita um conjunto de arquivos-fonte (caminhos absolutos) contra o schema
 * real. Retorna as 3 listas de erro que dashboards.test.mjs valida:
 *   - tabelasInexistentes: consulta a tabela que não existe nas migrations
 *   - tabelasMortas: mede tabela onde nenhum código insere/atualiza
 *   - colunasInexistentes: alias.coluna ou WHERE user_id que não existe na tabela
 */
export function auditarArquivos(arquivos, { schema = lerSchema(), escritas = tabelasComEscrita() } = {}) {
  const tabelasInexistentes = [];
  const tabelasMortas = [];
  const colunasInexistentes = [];

  for (const filePath of arquivos) {
    const f = path.basename(filePath);
    const src = fs.readFileSync(filePath, 'utf8');

    for (const t of tabelasDoArquivo(src)) {
      if (IGNORAR.has(t)) continue;
      if (!schema.has(t)) {
        tabelasInexistentes.push(`${f}: consulta a tabela "${t}", que NÃO existe nas migrations`);
        continue;
      }
      if (!escritas.has(t)) {
        tabelasMortas.push(`${f}: mede "${t}", mas NENHUM código insere/atualiza essa tabela — o painel vai mostrar zero para sempre`);
      }
    }

    // Blocos de SQL ancorados em ".query(" — usados pela checagem de coluna
    // SEM prefixo/alias abaixo. Mais precisos que o scan genérico de
    // crases usado pelas checagens de alias.coluna (que tolera falso-match
    // porque só dispara quando o alias capturado bate com uma tabela real),
    // porque aqui um falso-positivo de fronteira de bloco vira erro de teste.
    const blocosQuery = [];
    // Âncora ampla: qualquer chamada de função com um literal de SQL como
    // argumento — cobre tanto `db.query(\`...\`)` direto quanto wrappers
    // locais como `const one = (sql) => db.query(sql); one(\`...\`)`, comuns
    // em morningBriefingService.ts.
    for (const m of src.matchAll(/\w+\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*[,)]/g)) {
      const lit = m[1];
      const conteudo = lit.slice(1, -1);
      if (!/^\s*SELECT\b/i.test(conteudo)) continue;
      if (/\bFROM\b/i.test(conteudo)) blocosQuery.push(conteudo);

      // Uma query pode empilhar VÁRIAS subqueries escalares num só literal
      // (ex.: `SELECT (SELECT ... FROM installments WHERE ...) + (SELECT ...
      // FROM parcelas WHERE ...) AS total`). Tratadas como bloco único, elas
      // têm mais de uma tabela e a checagem sem alias é pulada por segurança
      // — mas cada `(SELECT ... FROM tabela WHERE ...)` sozinha É de uma
      // tabela só, então também auditamos cada subquery parentizada à parte
      // (parênteses balanceados, para não cortar em `IN ('a','b')`).
      for (const abre of [...conteudo.matchAll(/\(\s*SELECT\b/gi)].map((mm) => mm.index)) {
        let depth = 1, i = abre + 1;
        while (i < conteudo.length && depth > 0) {
          if (conteudo[i] === '(') depth++;
          else if (conteudo[i] === ')') depth--;
          i++;
        }
        if (depth === 0) blocosQuery.push(conteudo.slice(abre, i));
      }
    }

    // pega blocos de SQL (template literals com FROM)
    for (const bruto of src.match(/`[^`]*\bFROM\b[^`]*`/gi) || []) {
      // Remove os comentários SQL ANTES de analisar (CRLF-safe).
      const bloco = bruto
        .replace(/\r/g, '')
        .split('\n')
        .map((l) => l.replace(/--.*$/, ''))
        .join('\n');
      // mapeia alias -> tabela  (FROM cases c / JOIN clients cl ON ...)
      const alias = new Map();
      for (const m of bloco.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)\b/gi)) {
        const [, tab, al] = m;
        if (['on', 'where', 'group', 'order', 'set', 'left', 'inner', 'join'].includes(al.toLowerCase())) continue;
        alias.set(al.toLowerCase(), tab.toLowerCase());
      }
      // tabela única sem alias
      const unica = [...tabelasDoArquivo(bloco)].filter((t) => schema.has(t));

      // referências alias.coluna
      for (const m of bloco.matchAll(/\b(\w+)\.(\w+)\b/g)) {
        const [, a, col] = m;
        const tab = alias.get(a.toLowerCase());
        if (!tab || !schema.has(tab)) continue;
        if (!schema.get(tab).has(col.toLowerCase())) {
          colunasInexistentes.push(`${f}: usa "${a}.${col}", mas a tabela "${tab}" não tem a coluna "${col}"`);
        }
      }

      // WHERE user_id numa tabela única que não tem user_id
      if (unica.length === 1 && /\bWHERE\b[\s\S]*\buser_id\s*=/i.test(bloco)) {
        const t = unica[0];
        if (!schema.get(t).has('user_id')) {
          colunasInexistentes.push(`${f}: filtra por "user_id" em "${t}", que NÃO tem essa coluna`);
        }
      }
    }

    // Referências de coluna SEM alias/prefixo (ex.: `FROM leads` seguido de
    // `SELECT ... COALESCE(area, ...) ... FROM leads`) — usa os blocos
    // precisos ancorados em ".query(" (blocosQuery), não o scan genérico de
    // crases: aqui um falso-match de fronteira de bloco vira erro de teste,
    // então precisamos ter certeza de que o literal capturado É a query real.
    // Só dá pra checar com segurança quando o bloco tem exatamente UMA
    // tabela do schema e nenhum alias foi declarado para ela (senão a coluna
    // pode pertencer a qualquer uma das tabelas do JOIN).
    for (const bloco of blocosQuery) {
      const alias = new Map();
      for (const m of bloco.matchAll(/\b(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)\b/gi)) {
        const [, tab, al] = m;
        if (['on', 'where', 'group', 'order', 'set', 'left', 'inner', 'join'].includes(al.toLowerCase())) continue;
        alias.set(al.toLowerCase(), tab.toLowerCase());
      }
      const unica = [...tabelasDoArquivo(bloco)].filter((t) => schema.has(t));
      const semAlias = unica.length === 1 && ![...alias.values()].includes(unica[0]);
      if (!semAlias) continue;

      const t = unica[0];
      const cols = schema.get(t);
      // Estratégia direta: dentro de COALESCE(col, ...) / WHERE col <op>, sem
      // qualquer prefixo de alias, captura identificadores soltos e verifica
      // se pertencem à tabela única do bloco.
      for (const m of bloco.matchAll(/\bCOALESCE\s*\(\s*([a-zA-Z_]\w*)\s*,/gi)) {
        const ident = m[1].toLowerCase();
        if (SQL_PALAVRAS_RESERVADAS.has(ident)) continue;
        if (!cols.has(ident)) {
          colunasInexistentes.push(`${f}: usa a coluna "${ident}" (sem prefixo) da tabela "${t}", que NÃO tem essa coluna`);
        }
      }
      for (const m of bloco.matchAll(/\bWHERE\b([\s\S]*?)(?:GROUP BY|ORDER BY|$)/gi)) {
        for (const cm of m[1].matchAll(/\b([a-zA-Z_]\w*)\s*(?:=(?!=)|<=|>=|<|>|\bIS\s+NOT\s+NULL\b|\bIS\s+NULL\b|\bIN\s*\()/gi)) {
          const ident = cm[1].toLowerCase();
          if (SQL_PALAVRAS_RESERVADAS.has(ident)) continue;
          if (ident === t) continue;
          if (!cols.has(ident)) {
            colunasInexistentes.push(`${f}: filtra por "${ident}" (sem prefixo) em "${t}", que NÃO tem essa coluna`);
          }
        }
      }
    }
  }

  return {
    tabelasInexistentes: [...new Set(tabelasInexistentes)],
    tabelasMortas: [...new Set(tabelasMortas)],
    colunasInexistentes: [...new Set(colunasInexistentes)],
  };
}
