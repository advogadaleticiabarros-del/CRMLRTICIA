// Calcula o embedding (vetor de significado, OpenAI) de cada peça do cofre
// que ainda não tem um — parte da Fase 3 (matching por significado) do
// roteiro de evolução. Idempotente: só processa embedding IS NULL.
// Uso: node scripts/backfill-peca-embeddings.mjs "<mysql url>"
// Requer OPENAI_API_KEY no ambiente (ex.: rodar com `node --env-file=.env ...`
// ou exportar a variável antes).
import mysql from 'mysql2/promise';

const dbUrl = process.argv[2];
const apiKey = process.env.OPENAI_API_KEY;
if (!dbUrl) { console.error('Uso: node scripts/backfill-peca-embeddings.mjs <mysql-url>'); process.exit(1); }
if (!apiKey) { console.error('OPENAI_API_KEY não encontrada no ambiente.'); process.exit(1); }

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const BATCH_SIZE = 20; // a API de embeddings aceita várias entradas por chamada

async function embedBatch(textos) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: textos }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `Erro OpenAI (HTTP ${r.status})`);
  // A API devolve na mesma ordem da entrada.
  return d.data.map((item) => item.embedding);
}

const conn = await mysql.createConnection(dbUrl);
const [rows] = await conn.query(
  'SELECT id, titulo, assunto, teses, fundamentos FROM peca_modelos WHERE embedding IS NULL'
);
console.log(`${rows.length} peça(s) sem embedding.`);

let ok = 0;
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const lote = rows.slice(i, i + BATCH_SIZE);
  const textos = lote.map((r) => [r.titulo, r.assunto, r.teses, r.fundamentos].filter(Boolean).join('\n').slice(0, 8000));
  try {
    const embeddings = await embedBatch(textos);
    for (let j = 0; j < lote.length; j++) {
      await conn.query('UPDATE peca_modelos SET embedding = ?, embedded_at = NOW() WHERE id = ?', [JSON.stringify(embeddings[j]), lote[j].id]);
      ok++;
    }
    console.log(`  ✔ lote ${Math.floor(i / BATCH_SIZE) + 1} (${lote.length} peças)`);
  } catch (e) {
    console.error(`  ⚠ falha no lote ${Math.floor(i / BATCH_SIZE) + 1}: ${e.message}`);
  }
}

console.log(`\nEmbeddings calculados: ${ok}/${rows.length}`);
await conn.end();
