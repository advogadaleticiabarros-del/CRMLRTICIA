// Ponte do escritório para o TJES — 18/11/2026.
// O TJES (atrás do firewall da Amazon) bloqueia o IP da VPS com 403, mas aceita
// a rede do escritório. A consulta ao TJES sai pelo computador do escritório:
// o servidor põe o pedido numa fila em memória, o computador busca, envia ao
// tribunal e devolve a resposta. Dados abaixo FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mni-ponte-'));
execSync(`npx tsc src/services/mni/cliente.ts src/services/mni/sistemas.ts src/services/mni/ponteEscritorio.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const imp = async (f) => (await import(pathToFileURL(path.join(out, f)).href)).default;
const { criarPonte } = await imp('ponteEscritorio.js');
const cli = await imp('cliente.js');
const sis = await imp('sistemas.js');
const local = await import(pathToFileURL(path.resolve('scripts/ponte-escritorio/ponte.mjs')).href);

const URL_TJES = 'https://pje.tjes.jus.br/pje/intercomunicacao';
const init = (body = '<x/>') => ({ method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' }, body });

function relogio(inicio = 1_000_000) {
  let t = inicio;
  return { agora: () => t, avancar: (ms) => { t += ms; } };
}

test('sem o computador do escritório conectado, falha na hora com mensagem clara', async () => {
  const p = criarPonte();
  await assert.rejects(p.fetch(URL_TJES, init()), (e) => {
    assert.match(e.message, /computador do escritório/i);
    assert.equal(e.name, 'ErroRespostaMni');
    return true;
  });
  assert.equal(p.situacao().conectada, false);
  assert.equal(p.situacao().ultimoContato, null);
});

test('pedido vai para o computador do escritório e a resposta volta para quem pediu', async () => {
  const p = criarPonte();
  const espera = p.aguardarPedidos(5_000); // computador conectado, aguardando
  assert.equal(p.situacao().conectada, true);
  const resposta = p.fetch(URL_TJES, init('<consulta/>'));
  const pedidos = await espera;
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].url, URL_TJES);
  assert.equal(pedidos[0].corpo, '<consulta/>');
  assert.equal(pedidos[0].cabecalhos.SOAPAction, '""');
  assert.equal(p.responder(pedidos[0].id, { status: 200, corpo: '<ok/>' }), true);
  const r = await resposta;
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<ok/>');
  // resposta já entregue: não aceita de novo
  assert.equal(p.responder(pedidos[0].id, { status: 200, corpo: '<de novo/>' }), false);
});

test('pedido já entregue não é entregue de novo; o próximo pedido sai na próxima busca', async () => {
  const p = criarPonte();
  const e1 = p.aguardarPedidos(5_000);
  const r1 = p.fetch(URL_TJES, init('<a/>'));
  const [ped1] = await e1;
  const e2 = p.aguardarPedidos(5_000);
  const r2 = p.fetch(URL_TJES, init('<b/>'));
  const lista2 = await e2;
  assert.deepEqual(lista2.map((x) => x.corpo), ['<b/>']);
  p.responder(ped1.id, { status: 200, corpo: '1' });
  p.responder(lista2[0].id, { status: 200, corpo: '2' });
  assert.equal(await (await r1).text(), '1');
  assert.equal(await (await r2).text(), '2');
});

test('busca sem pedido devolve lista vazia ao fim da espera e conta como contato', async () => {
  const rel = relogio();
  const p = criarPonte({ agora: rel.agora });
  assert.deepEqual(await p.aguardarPedidos(20), []);
  assert.equal(p.situacao().conectada, true);
  rel.avancar(10 * 60_000); // 10 min sem buscar: desligado
  assert.equal(p.situacao().conectada, false);
  await assert.rejects(p.fetch(URL_TJES, init()), /computador do escritório/i);
});

test('sem resposta dentro do prazo, o pedido falha e sai da fila', async () => {
  const p = criarPonte({ prazoRespostaMs: 30 });
  const espera = p.aguardarPedidos(5_000);
  const r = p.fetch(URL_TJES, init());
  const [ped] = await espera;
  await assert.rejects(r, /não respondeu|tempo/i);
  assert.equal(p.responder(ped.id, { status: 200, corpo: 'tarde' }), false);
});

test('erro de rede no escritório volta como erro do tribunal (não como login recusado)', async () => {
  const p = criarPonte();
  const espera = p.aguardarPedidos(5_000);
  const r = p.fetch(URL_TJES, init());
  const [ped] = await espera;
  p.responder(ped.id, { erro: 'getaddrinfo ENOTFOUND pje.tjes.jus.br' });
  await assert.rejects(r, (e) => { assert.equal(e.name, 'ErroRespostaMni'); assert.match(e.message, /ENOTFOUND/); return true; });
});

test('cliente MNI funciona pela ponte (login recusado continua sendo login recusado)', async () => {
  const p = criarPonte();
  const c = cli.criarClienteMni({ url: URL_TJES, fetch: p.fetch });
  const espera = p.aguardarPedidos(5_000);
  const r = c.avisosPendentes({ cpf: '00000000000', senha: 'x' });
  const [ped] = await espera;
  assert.match(ped.corpo, /consultarAvisosPendentes/);
  p.responder(ped.id, { status: 200, corpo: '<soap:Envelope xmlns:soap="s"><soap:Body><r><sucesso>false</sucesso><mensagem>Usuário ou senha inválidos</mensagem></r></soap:Body></soap:Envelope>' });
  await assert.rejects(r, (e) => e instanceof cli.ErroLoginMni);
});

test('TJES passa pelo escritório; eproc continua direto da VPS', () => {
  const via = Object.fromEntries(sis.SISTEMAS_MNI.map((s) => [s.id, !!s.viaEscritorio]));
  assert.deepEqual(via, { tjes_pje1g: true, tjes_pje2g: true, eproc_jfes: false });
});

// ── Programa do computador do escritório ───────────────────────────────────

test('escritório só encaminha para os endereços oficiais do TJES (não vira proxy aberto)', () => {
  assert.equal(local.urlPermitida('https://pje.tjes.jus.br/pje/intercomunicacao'), true);
  assert.equal(local.urlPermitida('https://pje.tjes.jus.br/pje2g/intercomunicacao'), true);
  assert.equal(local.urlPermitida('http://pje.tjes.jus.br/pje/intercomunicacao'), false);
  assert.equal(local.urlPermitida('https://pje.tjes.jus.br.evil.com/pje/intercomunicacao'), false);
  assert.equal(local.urlPermitida('https://pje.tjes.jus.br/pje/outra-coisa'), false);
  assert.equal(local.urlPermitida('https://192.168.0.1/'), false);
  assert.equal(local.urlPermitida('nada'), false);
});

test('escritório atende o pedido: envia ao tribunal e devolve status e corpo', async () => {
  const chamadas = [];
  const fakeFetch = async (u, i) => { chamadas.push({ u, i }); return { status: 200, text: async () => '<resp/>' }; };
  const r = await local.atenderPedido({ id: 'a1', url: URL_TJES, corpo: '<q/>', cabecalhos: { SOAPAction: '""', Cookie: 'x', 'Content-Type': 'text/xml; charset=utf-8' } }, fakeFetch);
  assert.deepEqual(r, { status: 200, corpo: '<resp/>' });
  assert.equal(chamadas[0].i.method, 'POST');
  assert.equal(chamadas[0].i.body, '<q/>');
  assert.equal(chamadas[0].i.headers.Cookie, undefined, 'só repassa Content-Type e SOAPAction');
});

test('escritório recusa endereço fora da lista sem chamar a rede', async () => {
  let chamou = false;
  const r = await local.atenderPedido({ id: 'a2', url: 'https://exemplo.com/x', corpo: '', cabecalhos: {} }, async () => { chamou = true; });
  assert.equal(chamou, false);
  assert.match(r.erro, /não permitido/i);
});

test('escritório transforma falha de rede em erro (sem derrubar o programa)', async () => {
  const r = await local.atenderPedido({ id: 'a3', url: URL_TJES, corpo: '', cabecalhos: {} }, async () => { throw new Error('ECONNRESET'); });
  assert.match(r.erro, /ECONNRESET/);
});
