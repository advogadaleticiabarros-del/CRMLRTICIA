// tests/dashboardComercialGastoMarketing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Regex não-gulosa `[\s\S]*?\}\);` pararia no primeiro `});` do handler (ex.: o
// `res.status(400).json({...});` de uma validação interna), cortando o corpo da
// rota antes da query real. Delimitamos pelo próximo `router.` ou fim do arquivo
// pra capturar o handler inteiro.
function extrairRota(src, metodo) {
  const start = src.indexOf(`router.${metodo}('/gasto-marketing'`);
  if (start === -1) return null;
  // `});` sem indentação = fecha o handler (a chamada router.METODO() em si),
  // não um `});` interno de res.status(...).json({...}) que vem indentado.
  const m = /\r?\n\}\);/.exec(src.slice(start));
  if (!m) return null;
  return src.slice(start, start + m.index + m[0].length);
}

test('rota POST /gasto-marketing valida canal contra CANAIS antes de gravar', () => {
  const src = fs.readFileSync(path.resolve('src/routes/dashboards/comercial.ts'), 'utf8');
  assert.match(src, /import\s*\{\s*CANAIS\s*\}\s*from\s*['"]\.\.\/\.\.\/services\/leadChannel['"]/, 'CANAIS precisa ser importado de leadChannel.ts');
  const bloco = extrairRota(src, 'post');
  assert.ok(bloco, 'rota POST /gasto-marketing não encontrada');
  assert.match(bloco, /CANAIS\.includes\(/, 'POST precisa validar canal contra CANAIS antes de gravar');
});

test('rota POST /gasto-marketing usa upsert (ON DUPLICATE KEY UPDATE), não INSERT simples', () => {
  const src = fs.readFileSync(path.resolve('src/routes/dashboards/comercial.ts'), 'utf8');
  const bloco = extrairRota(src, 'post');
  assert.ok(bloco, 'rota POST /gasto-marketing não encontrada');
  assert.match(bloco, /ON DUPLICATE KEY UPDATE/i, 'lançar de novo pro mesmo mês+canal precisa atualizar, não duplicar');
});

test('rota GET /gasto-marketing filtra por mes_referencia recebido na query', () => {
  const src = fs.readFileSync(path.resolve('src/routes/dashboards/comercial.ts'), 'utf8');
  const bloco = extrairRota(src, 'get');
  assert.ok(bloco, 'rota GET /gasto-marketing não encontrada');
  assert.match(bloco, /req\.query\.mes/, 'GET precisa ler o mês da query string');
  assert.match(bloco, /FROM gasto_marketing/i, 'GET precisa consultar a tabela gasto_marketing');
});
