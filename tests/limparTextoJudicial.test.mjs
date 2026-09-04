// tests/limparTextoJudicial.test.mjs
// O texto de publicações (DJEN) e e-mails de monitoramento às vezes chega
// como HTML bruto — tags inteiras (<html><table><tr><td>...) e entidades não
// decodificadas (&aacute;, &ccedil;, &ordm;...) direto no `description` da
// movimentação, vazando pra tela, pro resumo da IA e pro WhatsApp (pedido:
// "estão com carácteres estranhos, sem formatação, bagunçados").
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/textCleanup.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { limparTextoJudicial } = await import('../dist/services/textCleanup.js');

test('texto simples sem HTML/entidades fica igual (só trim)', () => {
  assert.equal(limparTextoJudicial('  Petição juntada aos autos.  '), 'Petição juntada aos autos.');
});
test('null/undefined/vazio devolve string vazia', () => {
  assert.equal(limparTextoJudicial(null), '');
  assert.equal(limparTextoJudicial(undefined), '');
  assert.equal(limparTextoJudicial(''), '');
});
test('entidades nomeadas comuns em português são decodificadas', () => {
  assert.equal(limparTextoJudicial('Art. 3&ordm; CC'), 'Art. 3º CC');
  assert.equal(limparTextoJudicial('gera&ccedil;&atilde;o'), 'geração');
  assert.equal(limparTextoJudicial('dispon&iacute;vel'), 'disponível');
  assert.equal(limparTextoJudicial('Esta &eacute; uma mensagem autom&aacute;tica'), 'Esta é uma mensagem automática');
});
test('entidades genéricas (&amp; &quot; &#39;) são decodificadas', () => {
  assert.equal(limparTextoJudicial('A &amp; B'), 'A & B');
  assert.equal(limparTextoJudicial('&quot;citação&quot;'), '"citação"');
  assert.equal(limparTextoJudicial('&#39;ok&#39;'), "'ok'");
});
test('entidades numéricas decimais e hexadecimais são decodificadas', () => {
  assert.equal(limparTextoJudicial('&#231;'), 'ç');
  assert.equal(limparTextoJudicial('&#x27;'), "'");
});
test('tags HTML viram espaço, texto sobrevive sem colar palavras', () => {
  assert.equal(
    limparTextoJudicial('<table><tr><td>AUTOR</td><td>: WENDEL LEIVINO DIAS</td></tr></table>'),
    'AUTOR : WENDEL LEIVINO DIAS'
  );
});
test('remove documento HTML inteiro (head/style vazios) e sobra só o texto', () => {
  const bruto = '<html><head><meta><style></style></head><body><article><header><div></div></header><section><b>Intimação</b></section></article></body></html>';
  assert.equal(limparTextoJudicial(bruto), 'Intimação');
});
test('espaços múltiplos (sobra de tags removidas) colapsam em um só', () => {
  assert.equal(limparTextoJudicial('A   <br>   B'), 'A B');
});
