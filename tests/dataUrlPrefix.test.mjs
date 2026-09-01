// tests/dataUrlPrefix.test.mjs
// Regressão: áudio gravado no navegador (mimeType tipo "audio/webm;codecs=opus")
// salvava com poucos bytes de lixo — a regex antiga /^data:[^;]+;base64,/ não
// batia quando o mime tinha mais de um segmento (";codecs=opus" antes de
// ";base64,"), então o prefixo "data:...;base64," inteiro virava lixo
// decodificado como base64. PDF/imagem (mime simples, sem ";") não pegavam
// esse bug — só arquivos com mime composto, como áudio do MediaRecorder.
// Ver src/utils/dataUrl.ts.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/utils/dataUrl.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { stripDataUrlPrefix } = await import('../dist/utils/dataUrl.js');

test('stripDataUrlPrefix: mime simples (imagem/PDF) — caso que sempre funcionou', () => {
  const b64 = Buffer.from('conteudo de teste').toString('base64');
  assert.strictEqual(stripDataUrlPrefix(`data:image/png;base64,${b64}`), b64);
  assert.strictEqual(stripDataUrlPrefix(`data:application/pdf;base64,${b64}`), b64);
});

test('stripDataUrlPrefix: mime composto com parâmetro (áudio gravado no navegador) — o bug real', () => {
  const b64 = Buffer.from('audio de teste, bytes reais aqui').toString('base64');
  const dataUrl = `data:audio/webm;codecs=opus;base64,${b64}`;
  assert.strictEqual(stripDataUrlPrefix(dataUrl), b64, 'deve tirar TODO o prefixo até a vírgula, não só até o primeiro ";"');

  // Prova de que o buffer decodificado bate com o conteúdo original —
  // é exatamente essa checagem que faltava e deixou o bug passar.
  const decoded = Buffer.from(stripDataUrlPrefix(dataUrl), 'base64');
  assert.strictEqual(decoded.toString(), 'audio de teste, bytes reais aqui');
});

test('stripDataUrlPrefix: string sem prefixo "data:" (já veio só o base64) — não mexe', () => {
  const b64 = Buffer.from('sem prefixo').toString('base64');
  assert.strictEqual(stripDataUrlPrefix(b64), b64);
});

test('stripDataUrlPrefix: entrada vazia/undefined devolve string vazia, não lança', () => {
  assert.strictEqual(stripDataUrlPrefix(''), '');
  assert.strictEqual(stripDataUrlPrefix(undefined), '');
});
