// Importa o COFRE DE PEÇAS do Obsidian para a tabela peca_modelos (produção).
// Lê as fichas .md (frontmatter YAML) + extrai o texto dos .docx vinculados.
// Uso: node scripts/import-pecas-obsidian.mjs "<caminho do cofre>" "<mysql url>"
// Idempotente: upsert por external_key (nome da ficha).
//
// O cofre pode ter uma pasta "Fichas/" direto na raiz (um vault só) OU várias
// subpastas de área, cada uma com sua própria "Fichas/" (ex.: "Trabalhista/Fichas",
// "Consumidor/Fichas") — o script detecta e varre todas.
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import mysql from 'mysql2/promise';

const cofre = process.argv[2];
const dbUrl = process.argv[3];
if (!cofre || !dbUrl) { console.error('Uso: node scripts/import-pecas-obsidian.mjs <cofre> <mysql-url>'); process.exit(1); }

// Frontmatter simples: chave: valor | chave: [a, b] | chave: "..."
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const kv = linha.match(/^([a-z_]+):\s*(.*)$/i);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["'[]+|["'\]]+$/g, '')).filter(Boolean);
    } else {
      v = v.replace(/^["']|["']$/g, '');
    }
    out[kv[1].toLowerCase()] = v;
  }
  return out;
}

const AREA_MAP = {
  'previdenciário': 'previdenciario', 'previdenciario': 'previdenciario',
  'trabalhista': 'trabalhista', 'consumidor': 'consumidor', 'bancário': 'consumidor',
  'família': 'familia', 'familia': 'familia', 'cível': 'civel', 'civel': 'civel',
  'execução': 'execucao', 'execucao': 'execucao',
  'extrajudicial': 'extrajudicial',
};

// Acha todas as pastas "Fichas" dentro do cofre. Cada uma vira um "vault"
// (a pasta-mãe da Fichas/ é onde os .docx citados no frontmatter ficam).
function acharVaults(raiz) {
  const direta = path.join(raiz, 'Fichas');
  if (fs.existsSync(direta)) return [raiz];
  const vaults = [];
  for (const entry of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(raiz, entry.name);
    if (fs.existsSync(path.join(sub, 'Fichas'))) vaults.push(sub);
  }
  return vaults;
}

const vaults = acharVaults(cofre);
if (!vaults.length) { console.error(`Nenhuma pasta "Fichas" encontrada em ${cofre} (nem direto, nem em subpastas de área).`); process.exit(1); }
console.log(`${vaults.length} área(s) encontrada(s): ${vaults.map((v) => path.basename(v)).join(', ')}`);

const conn = await mysql.createConnection(dbUrl);
let ok = 0, semDocx = 0;

for (const vault of vaults) {
  const fichasDir = path.join(vault, 'Fichas');
  const fichas = fs.readdirSync(fichasDir).filter((f) => f.endsWith('.md'));
  console.log(`\n— ${path.basename(vault)}: ${fichas.length} ficha(s)`);

  for (const ficha of fichas) {
    const md = fs.readFileSync(path.join(fichasDir, ficha), 'utf8');
    const fm = parseFrontmatter(md);
    const titulo = ficha.replace(/\.md$/, '');

    // Localiza o .docx citado no frontmatter (arquivo: "[[nome.docx]]")
    let conteudo = null;
    const docxName = String(fm.arquivo || '').replace(/[\[\]"]/g, '').trim();
    if (docxName) {
      const docxPath = path.join(vault, docxName);
      if (fs.existsSync(docxPath)) {
        try {
          const r = await mammoth.extractRawText({ path: docxPath });
          conteudo = r.value.replace(/\n{3,}/g, '\n\n').trim().slice(0, 120000);
        } catch (e) { console.warn(`  ⚠ falha ao ler ${docxName}: ${e.message}`); }
      } else { console.warn(`  ⚠ docx não encontrado: ${docxName}`); }
    }
    if (!conteudo) semDocx++;

    const teses = Array.isArray(fm.teses) ? fm.teses.map((t) => t.replace(/[\[\]]/g, '')).join('; ') : (fm.teses || null);
    const fund = Array.isArray(fm.fundamentos) ? fm.fundamentos.join('; ') : (fm.fundamentos || null);
    const area = AREA_MAP[String(fm.area || '').toLowerCase()] || null;

    await conn.query(
      `INSERT INTO peca_modelos (external_key, titulo, area, assunto, tipo, rito, tribunal, teses, fundamentos, conteudo, fonte)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'obsidian')
       ON DUPLICATE KEY UPDATE titulo=VALUES(titulo), area=VALUES(area), assunto=VALUES(assunto),
         tipo=VALUES(tipo), rito=VALUES(rito), teses=VALUES(teses), fundamentos=VALUES(fundamentos),
         conteudo=COALESCE(VALUES(conteudo), conteudo)`,
      [titulo, titulo, area, fm.assunto || null, fm.tipo || null, fm.rito || null, null, teses, fund, conteudo]
    );
    console.log(`  ✔ ${titulo}${conteudo ? ` (${Math.round(conteudo.length / 1000)}k chars do docx)` : ' (só ficha, sem docx)'}`);
    ok++;
  }
}

const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM peca_modelos');
console.log(`\nImportadas/atualizadas: ${ok} · sem docx: ${semDocx} · total no banco: ${n}`);
await conn.end();
