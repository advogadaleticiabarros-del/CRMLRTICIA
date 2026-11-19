// tests/painelTv.test.mjs — tela da TV: resumo do WhatsApp (modo discreto) e tela /tv
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { nomeDiscreto, resumirWhatsapp } from '../dist/services/painelTv.js';

const AGORA = new Date('2026-11-19T15:00:00Z');
const min = (n) => new Date(AGORA.getTime() - n * 60000);
const conversa = (o) => ({ phone: '5527900000000', nome: 'Maria da Silva Souza', ultimaEm: min(10), ultimaDeMim: false, naoLidas: 1, previa: 'Bom dia, doutora, tenho uma dúvida', arquivada: false, ...o });
const base = (conversas, o = {}) => ({ conectado: true, ultimaRecebidaEm: min(5), recebidasHoje: 12, enviadasHoje: 8, rascunhosPendentes: 2, conversas, ...o });

test('nomeDiscreto: primeiro nome e inicial do último; sem nome vira "Contato" e nunca mostra o telefone', () => {
  assert.strictEqual(nomeDiscreto('Maria da Silva Souza'), 'Maria S.');
  assert.strictEqual(nomeDiscreto('  joão  '), 'João');
  assert.strictEqual(nomeDiscreto(null), 'Contato');
  assert.strictEqual(nomeDiscreto('5527999998888'), 'Contato');
});

test('aguardando: só conversas cuja última mensagem é do contato, nas últimas 72h, a mais antiga primeiro', () => {
  const r = resumirWhatsapp(base([
    conversa({ phone: 'a', nome: 'Ana Lima', ultimaEm: min(30) }),
    conversa({ phone: 'b', nome: 'Bruno Reis', ultimaEm: min(200) }),
    conversa({ phone: 'c', nome: 'Carla Melo', ultimaDeMim: true }),
    conversa({ phone: 'd', nome: 'Davi Nunes', ultimaEm: min(73 * 60) }),
    conversa({ phone: 'e', nome: 'Elisa Prado', arquivada: true }),
  ]), AGORA, { discreto: true });
  assert.deepStrictEqual(r.aguardando.map((x) => x.nome), ['Bruno R.', 'Ana L.']);
  assert.strictEqual(r.totalAguardando, 2);
  assert.strictEqual(r.maiorEsperaMin, 200);
  assert.strictEqual(r.aguardando[0].esperaMin, 200);
});

test('modo discreto não manda a prévia nem o telefone; modo completo manda nome inteiro e prévia curta', () => {
  const longa = 'x'.repeat(300);
  const d = resumirWhatsapp(base([conversa({ previa: longa })]), AGORA, { discreto: true });
  assert.strictEqual(d.aguardando[0].previa, null);
  assert.ok(!JSON.stringify(d).includes('5527900000000'));
  const c = resumirWhatsapp(base([conversa({ previa: longa })]), AGORA, { discreto: false });
  assert.strictEqual(c.aguardando[0].nome, 'Maria da Silva Souza');
  assert.ok(c.aguardando[0].previa.length <= 91);
  assert.ok(!JSON.stringify(c).includes('5527900000000'));
});

test('recentes: últimas conversas de qualquer lado, mais nova primeiro, no máximo 8', () => {
  const lista = Array.from({ length: 12 }, (_, i) => conversa({ phone: String(i), nome: `Pessoa ${String.fromCharCode(65 + i)}`, ultimaEm: min(i * 3), ultimaDeMim: i % 2 === 0 }));
  const r = resumirWhatsapp(base(lista.reverse()), AGORA, { discreto: true });
  assert.strictEqual(r.recentes.length, 8);
  assert.strictEqual(r.recentes[0].nome, 'Pessoa A.');
  assert.strictEqual(r.recentes[0].deMim, true);
});

test('alerta: desconectado ou sem mensagem recebida há mais de 6h em horário comercial', () => {
  assert.strictEqual(resumirWhatsapp(base([], { conectado: false }), AGORA, { discreto: true }).alerta, 'O WhatsApp do escritório está desconectado');
  assert.match(resumirWhatsapp(base([], { ultimaRecebidaEm: min(7 * 60) }), AGORA, { discreto: true }).alerta, /Nenhuma mensagem recebida há 7h/);
  // 15h UTC = 12h em Brasília; 3h de silêncio não é alerta
  assert.strictEqual(resumirWhatsapp(base([], { ultimaRecebidaEm: min(180) }), AGORA, { discreto: true }).alerta, null);
  // de madrugada (5h UTC = 2h em Brasília) o silêncio é normal
  const madrugada = new Date('2026-11-19T05:00:00Z');
  assert.strictEqual(resumirWhatsapp(base([], { ultimaRecebidaEm: new Date('2026-11-18T20:00:00Z') }), madrugada, { discreto: true }).alerta, null);
});

test('números do dia passam inteiros', () => {
  const r = resumirWhatsapp(base([]), AGORA, { discreto: true });
  assert.strictEqual(r.recebidasHoje, 12);
  assert.strictEqual(r.enviadasHoje, 8);
  assert.strictEqual(r.rascunhosPendentes, 2);
  assert.strictEqual(r.conectado, true);
});

// ── Tela da TV (public/tv.html + public/tv.js) ─────────────────────────────
const tvJs = fs.readFileSync(path.resolve('public/tv.js'), 'utf8');
const tvHtml = fs.readFileSync(path.resolve('public/tv.html'), 'utf8');

test('tv.js é JavaScript válido e sem sintaxe nova demais para navegador de TV', () => {
  assert.doesNotThrow(() => new vm.Script(tvJs));
  assert.ok(!/\?\.|\?\?/.test(tvJs.replace(/'[^'\n]*'|"[^"\n]*"/g, '')), 'evite ?. e ?? (TVs antigas)');
});

test('controle remoto: setas, OK, voltar (TVs LG/Samsung), números e menu', () => {
  for (const tecla of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', '461', '10009', 'Escape']) assert.ok(tvJs.includes(tecla), tecla);
  assert.match(tvJs, /abrirMenu/);
  assert.match(tvJs, /\/api\/escritorio/);
  assert.match(tvJs, /\/api\/hoje/);
  assert.match(tvJs, /\/api\/tv\/whatsapp/);
});

test('entrar pela TV: o login do CRM volta sozinho para /tv', () => {
  const app = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  assert.match(tvJs, /gravar\('tv_voltar', '1'\)/);
  const showApp = app.slice(app.indexOf('function showApp()'), app.indexOf('function showApp()') + 400);
  assert.match(showApp, /tv_voltar[\s\S]*removeItem\('tv_voltar'\)[\s\S]*location\.href = '\/tv'/);
});

test('tv.html carrega tv.js e usa o token do CRM', () => {
  assert.match(tvHtml, /<script src="\/tv\.js/);
  assert.match(tvJs, /crm_token/);
  assert.match(tvJs, /X-Renew-Token/);
});
