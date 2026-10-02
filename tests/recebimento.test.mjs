// "Recebi um pagamento" (02/10/2026): lançar no financeiro algo que JÁ foi
// recebido, em um passo — pelo botão "+" ou pela conversa do WhatsApp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'receb-'));
execSync(`npx tsc src/services/recebimentoRegras.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'recebimentoRegras.js')).href)).default;

test('aceita valor em formato brasileiro e data de hoje por padrão', () => {
  const r = m.validarRecebimento({ client_id: 5, valor: '1.500,50', descricao: '' }, '2026-10-02');
  assert.equal(r.erro, null);
  assert.equal(r.dados.valor, 1500.5);
  assert.equal(r.dados.data, '2026-10-02');
  assert.equal(r.dados.descricao, 'Pagamento recebido');
});

test('recusa sem cliente, valor zero/negativo e data futura', () => {
  assert.match(m.validarRecebimento({ valor: '10' }, '2026-10-02').erro, /cliente/i);
  assert.match(m.validarRecebimento({ client_id: 1, valor: '0' }, '2026-10-02').erro, /valor/i);
  assert.match(m.validarRecebimento({ client_id: 1, valor: '-3' }, '2026-10-02').erro, /valor/i);
  assert.match(m.validarRecebimento({ client_id: 1, valor: '10', data: '2026-10-09' }, '2026-10-02').erro, /futur/i);
});

test('forma de pagamento só do vocabulário; desconhecida vira Outro', () => {
  assert.equal(m.validarRecebimento({ client_id: 1, valor: 10, forma: 'PIX' }, '2026-10-02').dados.forma, 'PIX');
  assert.equal(m.validarRecebimento({ client_id: 1, valor: 10, forma: 'bitcoin' }, '2026-10-02').dados.forma, 'Outro');
});
