// Briefing matinal — blocos que faltavam (diagnóstico ago/2026): WhatsApp
// aguardando resposta, publicações não analisadas, falhas de consulta,
// parcelas atrasadas, repasses ao cliente, leads sem resposta 24h, saúde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bext-'));
execSync(`npx tsc src/services/briefingExtrasRender.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'briefingExtrasRender.js')).href)).default;

const vazio = {
  whatsappAguardando: [], docsRecebidos: 0, naoAnalisadas: [], falhasConsulta: [],
  parcelasAtrasadas: { qtd: 0, total: 0 }, repassesCliente: { qtd: 0, total: 0 },
  leadsSemResposta24h: [], saude: { rotinasComErro: [], backupOk: true },
};

test('dia sem nada → sem bloco', () => {
  assert.equal(m.extrasHtml(vazio), '');
  assert.equal(m.extrasWhatsapp(vazio), '');
});

test('WhatsApp aguardando e leads aparecem com nomes e horas', () => {
  const e = { ...vazio, whatsappAguardando: [{ nome: 'Ana', horas: 5 }], leadsSemResposta24h: ['João'] };
  const t = m.extrasWhatsapp(e);
  assert.match(t, /Ana.*5h/);
  assert.match(t, /João/);
  assert.match(m.extrasHtml(e), /Ana/);
});

test('parcelas atrasadas e repasses com valor', () => {
  const e = { ...vazio, parcelasAtrasadas: { qtd: 3, total: 1500 }, repassesCliente: { qtd: 1, total: 800.5 } };
  const t = m.extrasWhatsapp(e);
  assert.match(t, /3 parcela\(s\) atrasada\(s\).*1\.500,00/);
  assert.match(t, /repasse.*800,50/i);
});

test('saúde: rotina com erro e backup falhando aparecem; tudo ok não aparece', () => {
  const e = { ...vazio, saude: { rotinasComErro: ['backup:diario'], backupOk: false } };
  const t = m.extrasWhatsapp(e);
  assert.match(t, /backup:diario/);
  assert.match(t, /backup/i);
});

test('publicações não analisadas e falhas de consulta', () => {
  const e = { ...vazio, naoAnalisadas: ['0001'], falhasConsulta: ['0002'] };
  const t = m.extrasWhatsapp(e);
  assert.match(t, /não analisada.*0001/i);
  assert.match(t, /falh.*0002/i);
});

test('HTML escapa nomes', () => {
  const e = { ...vazio, whatsappAguardando: [{ nome: '<b>x</b>', horas: 3 }] };
  assert.doesNotMatch(m.extrasHtml(e), /<b>x<\/b>/);
});

test('contagem de itens críticos extras (WhatsApp 24h+, backup, parcelas)', () => {
  assert.equal(m.criticosExtras(vazio), 0);
  assert.equal(m.criticosExtras({ ...vazio, whatsappAguardando: [{ nome: 'A', horas: 30 }, { nome: 'B', horas: 3 }], saude: { rotinasComErro: [], backupOk: false } }), 2);
});
