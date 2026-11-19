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
  assert.match(tvJs, /\/api\/tv\/escritorio/);
  assert.match(tvJs, /\/api\/tv\/hoje/);
  assert.match(tvJs, /\/api\/tv\/agente\//);
  assert.match(tvJs, /\/api\/tv\/whatsapp/);
});

test('entrar no CRM pelo celular para liberar a TV: volta sozinho para /tv/liberar', () => {
  const app = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const lib = fs.readFileSync(path.resolve('public/tv-liberar.js'), 'utf8');
  assert.match(lib, /'tv_voltar', '\/tv\/liberar'/);
  const showApp = app.slice(app.indexOf('function showApp()'), app.indexOf('function showApp()') + 700);
  assert.match(showApp, /tv_voltar[\s\S]*removeItem\('tv_voltar'\)[\s\S]*location\.href = destino/);
  // só volta para /tv ou /tv/liberar (nunca para outro site)
  const re = new RegExp(showApp.match(/if \(\/(\^.*\$)\/\.test\(destino\)\)/)[1]);
  for (const ok of ['/tv', '/tv/liberar', '/tv/liberar?codigo=123456']) assert.ok(re.test(ok), ok);
  for (const ruim of ['https://exemplo.com', '//exemplo.com', '/tv/../admin', '/tvx', '/tv/liberar?codigo=1&x=//a']) assert.ok(!re.test(ruim), ruim);
});

test('tv.html carrega tv.js; a TV entra pela chave dela (código), sem login', () => {
  assert.match(tvHtml, /<script src="\/tv\.js/);
  assert.match(tvJs, /X-TV-Chave/);
  assert.match(tvJs, /\/api\/public\/tv\/parear/);
  assert.match(tvJs, /\/api\/public\/tv\/situacao/);
  assert.match(tvJs, /gravar\('tv_chave'/);
  assert.ok(!/data-acao="login"/.test(tvHtml + tvJs), 'sem botão de login na TV');
});

// ── Avisos com som (19/11/2026: "efeitos sonoros para coisas de atenção") ──
import { montarAvisos } from '../dist/services/painelTv.js';

const vazio = { protocolados: [], conversasEsperando: [], rascunhos: [], prazosNovos: 0, errosRotina: [], audiencias: [] };
const nomesAgentes = { livia: 'Dra. Lívia', prazos: 'Dra. Paula', fabio: 'Dr. Fábio' };

test('avisos: nada novo, nenhum aviso', () => {
  assert.deepStrictEqual(montarAvisos(vazio, nomesAgentes), []);
});

test('avisos: processo protocolado comemora, com área e nome discreto', () => {
  const [a] = montarAvisos({ ...vazio, protocolados: [{ nome: 'Maria da Silva', area: 'trabalhista' }] }, nomesAgentes);
  assert.strictEqual(a.tipo, 'protocolo');
  assert.strictEqual(a.som, 'festa');
  assert.match(a.texto, /Maria S\./);
  assert.match(a.texto, /trabalhista/i);
  assert.ok(!a.texto.includes('Silva'));
});

test('avisos: mensagem urgente para aprovar chama a Dra. com o nome do agente', () => {
  const av = montarAvisos({ ...vazio, rascunhos: [{ agente: 'livia', nome: 'João Pedro Reis', urgente: true }, { agente: 'livia', nome: 'Ana Lima', urgente: false }, { agente: 'livia', nome: 'Bia Melo', urgente: false }] }, nomesAgentes);
  assert.strictEqual(av[0].tipo, 'urgente');
  assert.strictEqual(av[0].som, 'chamado');
  assert.match(av[0].texto, /Dra\. Lívia/);
  assert.match(av[0].texto, /João R\./);
  const comum = av.find((x) => x.tipo === 'aprovacao');
  assert.match(comum.titulo, /Dra\. Lívia pede aprovação de 2 mensagens/);
  assert.strictEqual(comum.som, 'chamado');
});

test('avisos: conversas que passaram de 30 min sem resposta, agrupadas', () => {
  const um = montarAvisos({ ...vazio, conversasEsperando: [{ nome: 'Carla Souza' }] }, nomesAgentes);
  assert.strictEqual(um[0].tipo, 'conversa');
  assert.strictEqual(um[0].som, 'ping');
  assert.match(um[0].titulo, /Carla S\. espera resposta há 30 min/);
  const tres = montarAvisos({ ...vazio, conversasEsperando: [{ nome: 'A B' }, { nome: 'C D' }, { nome: null }] }, nomesAgentes);
  assert.strictEqual(tres.length, 1);
  assert.match(tres[0].titulo, /3 conversas esperando resposta há 30 min/);
});

test('avisos: prazos novos, erro de rotina (um por agente) e audiência em 30 min', () => {
  const av = montarAvisos({
    ...vazio, prazosNovos: 2,
    errosRotina: [{ job: 'financeiro:vencidos' }, { job: 'financeiro:recorrentes' }, { job: 'rotina:desconhecida' }],
    audiencias: [{ inicio: new Date('2026-11-19T17:00:00Z') }],
  }, nomesAgentes, (job) => (job.startsWith('financeiro') ? 'fabio' : null));
  const prazo = av.find((x) => x.tipo === 'prazo');
  assert.match(prazo.titulo, /2 prazos novos para conferir/);
  const erros = av.filter((x) => x.tipo === 'erro');
  assert.strictEqual(erros.length, 2);
  assert.match(erros[0].titulo, /Dr\. Fábio/);
  assert.strictEqual(erros[0].som, 'alerta');
  const aud = av.find((x) => x.tipo === 'audiencia');
  assert.match(aud.titulo, /Audiência às 14:00/);
  assert.ok(!/título|title/i.test(JSON.stringify(aud)));
});

test('avisos: ordem de importância (urgente, audiência, erro, protocolo, conversa, aprovação, prazo)', () => {
  const av = montarAvisos({
    protocolados: [{ nome: 'X Y', area: 'civel' }], conversasEsperando: [{ nome: 'Z W' }],
    rascunhos: [{ agente: 'livia', nome: 'K L', urgente: true }, { agente: 'livia', nome: 'M N', urgente: false }],
    prazosNovos: 1, errosRotina: [{ job: 'financeiro:vencidos' }], audiencias: [{ inicio: new Date('2026-11-19T17:00:00Z') }],
  }, nomesAgentes, () => 'fabio');
  assert.deepStrictEqual(av.map((x) => x.tipo), ['urgente', 'audiencia', 'erro', 'protocolo', 'conversa', 'aprovacao', 'prazo']);
});

test('tv.js: sons pelo próprio navegador, tela cheia no primeiro toque e liga/desliga dos sons', () => {
  assert.match(tvJs, /AudioContext/);
  assert.match(tvJs, /\/api\/tv\/avisos/);
  assert.match(tvJs, /requestFullscreen/);
  assert.match(tvJs, /data-acao="sons"/);
});

test('páginas da TV saem com o script versionado (TV não roda tv.js velho do cache)', async () => {
  const app = fs.readFileSync(path.resolve('src/app.ts'), 'utf8');
  assert.match(app, /paginaTvVersionada\('tv\.html'\)/);
  assert.match(app, /paginaTvVersionada\('tv-liberar\.html'\)/);
  const { versionarIndexHtml } = await import('../dist/utils/versionarIndexHtml.js');
  assert.match(versionarIndexHtml(tvHtml, '123'), /src="\/tv\.js\?v=123"/);
  const lib = fs.readFileSync(path.resolve('public/tv-liberar.html'), 'utf8');
  assert.match(versionarIndexHtml(lib, '123'), /src="\/tv-liberar\.js\?v=123"/);
});
