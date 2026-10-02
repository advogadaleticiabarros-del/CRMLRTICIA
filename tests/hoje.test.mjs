// Tela "Hoje" (02/10/2026): uma lista só com o que precisa da advogada, cada
// item com o botão que resolve; vazia = dia em dia. Painel de saúde no topo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hoje-'));
execSync(`npx tsc src/services/hojeRegras.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'hojeRegras.js')).href)).default;

const vazio = {
  prazosUrgentes: 0, prazosAConfirmar: 0, prazosHoje: [], audienciasHoje: [], whatsappAguardando: [],
  acordosARegistrar: 0, propostasAbertas: 0, propostasSemAbrir: 0, leadsSemResposta: 0,
  parcelasAtrasadas: { qtd: 0, total: 0 }, repassesCliente: { qtd: 0, total: 0 },
  clientesAConferir: 0, processosDuplicados: 0, tarefasVencidas: 0,
};

test('dia em dia: nenhuma pendência', () => {
  assert.deepEqual(m.montarItens(vazio), []);
});

test('prazo de hoje e prazos urgentes a confirmar vêm primeiro', () => {
  const itens = m.montarItens({ ...vazio, acordosARegistrar: 2, prazosHoje: ['Contestação — 0001'], prazosUrgentes: 3, prazosAConfirmar: 10 });
  assert.equal(itens[0].nivel, 'critico');
  assert.match(itens[0].titulo, /Contestação/);
  assert.match(itens[1].titulo, /3 prazo/);
  assert.equal(itens[1].acao.href, '#prazos');
  assert.equal(itens.at(-1).id, 'acordos');
  assert.equal(itens.at(-1).acao.href, '#financeiro?tab=acordos');
});

test('WhatsApp: esperando 24h+ é crítico, menos é atenção', () => {
  const a = m.montarItens({ ...vazio, whatsappAguardando: [{ nome: 'Ana', horas: 30 }, { nome: 'Bia', horas: 3 }] });
  assert.equal(a[0].nivel, 'critico');
  assert.match(a[0].detalhe, /Ana/);
  const b = m.montarItens({ ...vazio, whatsappAguardando: [{ nome: 'Bia', horas: 3 }] });
  assert.equal(b[0].nivel, 'atencao');
});

test('itens textuais em português simples, com botão', () => {
  const itens = m.montarItens({ ...vazio, parcelasAtrasadas: { qtd: 2, total: 1500 }, clientesAConferir: 4, processosDuplicados: 1 });
  for (const i of itens) { assert.ok(i.acao.label); assert.ok(i.acao.href.startsWith('#')); }
  assert.ok(itens.some((i) => /1\.500,00/.test(i.titulo)));
});

test('saúde: vermelho quando cai, com o que fazer', () => {
  const s = m.montarSaude({ whatsapp: false, googleAgenda: false, gmailParceria: true, gmailTribunal: null, backupOk: true, tribunaisOk: true });
  const wa = s.find((x) => x.id === 'whatsapp');
  assert.equal(wa.ok, false);
  assert.match(wa.comoResolver, /QR/);
  assert.equal(s.find((x) => x.id === 'google').ok, false);
  assert.equal(s.find((x) => x.id === 'gmailTribunal'), undefined); // não configurado = não aparece
  assert.equal(m.tudoOk(s), false);
  assert.equal(m.tudoOk(m.montarSaude({ whatsapp: true, googleAgenda: true, gmailParceria: true, gmailTribunal: true, backupOk: true, tribunaisOk: true })), true);
});
