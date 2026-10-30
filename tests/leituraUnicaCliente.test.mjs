// tests/leituraUnicaCliente.test.mjs — leitura única dos documentos do cliente (pedido da
// Jessica, 30/10/2026: "os documentos de todos os processos do Valmiro são os mesmos, leia
// uma vez só, faça tudo que precisa, para depois apresentar o resultado nas outras peças").
import { test } from 'node:test';
import assert from 'node:assert';
import { lerUmaVez, chaveLeituraCliente, refDoConteudo } from '../dist/services/leituraUnica.js';
import { produzirPeticao, levantarContratos } from '../dist/services/esteiraPeca.js';

// ── peças: memória de leitura ────────────────────────────────────────────────

function cacheEmMemoria() {
  const m = new Map();
  return { m, buscar: async (ref) => m.get(ref) ?? null, guardar: async (ref, _fonte, texto) => { m.set(ref, texto); } };
}

test('lerUmaVez: o mesmo arquivo é lido pela IA uma vez; a 2ª vem da memória', async () => {
  const cache = cacheEmMemoria();
  let leituras = 0;
  const ler = async () => { leituras++; return 'TEXTO DO EXTRATO'; };
  const ref = refDoConteudo('texto', Buffer.from('%PDF-1 extrato'));
  assert.strictEqual(await lerUmaVez(cache, ref, 'extrato.pdf', ler), 'TEXTO DO EXTRATO');
  assert.strictEqual(await lerUmaVez(cache, ref, 'extrato (cópia).pdf', ler), 'TEXTO DO EXTRATO');
  assert.strictEqual(leituras, 1);
});

test('lerUmaVez: leitura que falhou não fica guardada (tenta de novo depois)', async () => {
  const cache = cacheEmMemoria();
  let n = 0;
  const ref = refDoConteudo('texto', 'abc');
  assert.strictEqual(await lerUmaVez(cache, ref, 'a.pdf', async () => { n++; return null; }), null);
  assert.strictEqual(await lerUmaVez(cache, ref, 'a.pdf', async () => { n++; return 'ok'; }), 'ok');
  assert.strictEqual(n, 2);
});

test('refDoConteudo: cabe na coluna ref (60) e muda com o conteúdo', () => {
  const a = refDoConteudo('texto', Buffer.from('um')), b = refDoConteudo('texto', Buffer.from('dois'));
  assert.ok(a.length <= 60 && a.startsWith('texto:'));
  assert.notStrictEqual(a, b);
});

test('chaveLeituraCliente: documentos iguais dão a mesma chave, em qualquer ordem e com qualquer nome', () => {
  const a = chaveLeituraCliente(7, [{ nome: 'extrato (caso #110)', texto: 'HISCON' }, { nome: 'rg', texto: 'RG' }]);
  const b = chaveLeituraCliente(7, [{ nome: 'rg (caso #111)', texto: 'RG' }, { nome: 'Extrato', texto: 'HISCON' }]);
  assert.strictEqual(a, b);
  assert.ok(a.length <= 60);
  assert.notStrictEqual(a, chaveLeituraCliente(8, [{ nome: 'x', texto: 'HISCON' }, { nome: 'y', texto: 'RG' }]), 'outro cliente, outra chave');
});

test('chaveLeituraCliente: conversa nova não obriga a ler de novo; documento novo, sim', () => {
  const base = [{ nome: 'hiscon', texto: 'HISCON' }, { nome: 'Conversa do WhatsApp com o cliente', texto: 'oi', muda: true }];
  const k = chaveLeituraCliente(7, base);
  assert.strictEqual(k, chaveLeituraCliente(7, [base[0], { ...base[1], texto: 'oi\ntudo bem?' }]));
  assert.notStrictEqual(k, chaveLeituraCliente(7, [...base, { nome: 'fatura', texto: 'FATURA' }]));
});

// ── esteira: uma leitura para todas as peças do cliente ─────────────────────

const FICHA_6_BANCOS = JSON.stringify({
  reus: [{ nome: 'Itaú Consignado S.A.' }, { nome: 'BANCO PAN S.A.' }],
  contratos: [
    { numero: 'ITA-1', tipo: 'emprestimo_consignado', banco: 'Itaú Consignado S.A.', parcela: 50, fonte: 'hiscon' },
    { numero: 'PAN-1', tipo: 'emprestimo_consignado', banco: 'BANCO PAN S.A.', parcela: 80, fonte: 'hiscon' },
  ],
  descontos: [
    { competencia: '2023-01', valor: 50, contrato: 'ITA-1', fonte: 'hiscre' },
    { competencia: '2023-01', valor: 80, contrato: 'PAN-1', fonte: 'hiscre' },
  ],
});

const BANCO = { 110: 'Banco Itaú S.A.', 111: 'Banco Pan S.A.' };

function depsCliente(over = {}) {
  const chamadas = []; const registros = []; const cache = new Map();
  let documentos = [{ nome: 'hiscon.pdf', texto: 'HISCON DO CLIENTE' }, { nome: 'hiscre.pdf', texto: 'HISCRE DO CLIENTE' }];
  const deps = {
    caso: async (id) => ({ id, client_id: 7, legal_area: 'consumidor', production_stage: 'criacao_inicial', titulo: `empréstimo consignado — ${BANCO[id]}`, cliente: 'Fulano Teste', qualificacao: 'Nome: Fulano Teste', advogada: 'Dra. Teste', relato: 'relato', partes: [{ nome: BANCO[id] }], phone: null }),
    candidatosCorrelatos: async () => [],
    fontes: async (ids) => ids.flatMap((i) => documentos.map((d) => ({ nome: `${d.nome} (caso #${i})`, texto: d.texto }))),
    fontesDoCliente: async () => [...documentos, { nome: 'Conversa do WhatsApp com o cliente', texto: `mensagens ${chamadas.length}`, muda: true }],
    leituraGuardada: async (chave) => cache.get(chave) ?? null,
    guardarLeitura: async (chave, ficha) => { cache.set(chave, ficha); },
    acoesDoCliente: async () => [110, 111].map((id) => ({ id, titulo: `empréstimo consignado — ${BANCO[id]}`, reus: [{ nome: BANCO[id] }] })),
    contratosSalvos: async () => [],
    guardarContratos: async () => {},
    catalogo: async () => ({ guia: '', itens: [] }),
    modelos: async () => [], teses: async () => [],
    fundamentos: async () => '', regras: async () => [],
    ia: async (prompt, nivel) => {
      chamadas.push({ prompt, nivel });
      if (nivel === 'leitura') { await new Promise((r) => setTimeout(r, 5)); return { ok: true, text: FICHA_6_BANCOS }; }
      return { ok: true, text: 'PETIÇÃO' };
    },
    registrar: (agente, texto) => registros.push({ agente, texto }),
    ...over,
  };
  return { deps, chamadas, registros, cache, trocarDocumentos: (d) => { documentos = d; } };
}

const leituras = (chamadas) => chamadas.filter((c) => c.nivel === 'leitura').length;

test('duas peças do mesmo cliente: os documentos são lidos uma vez e cada peça fica só com o seu banco', async () => {
  const { deps, chamadas, registros } = depsCliente();
  const itau = await produzirPeticao(110, deps);
  const pan = await produzirPeticao(111, deps);
  assert.strictEqual(leituras(chamadas), 1, 'a 2ª peça reaproveita a leitura');
  assert.deepStrictEqual(itau.ficha.contratos.map((c) => c.numero), ['ITA-1']);
  assert.deepStrictEqual(pan.ficha.contratos.map((c) => c.numero), ['PAN-1']);
  assert.strictEqual(pan.calculo.indebito.total.descontado, 80);
  assert.strictEqual(itau.leituraReaproveitada, false);
  assert.strictEqual(pan.leituraReaproveitada, true);
  assert.ok(registros.some((r) => r.agente === 'analista' && /reaproveitou/i.test(r.texto)));
  // As duas redações continuam: cada peça tem a sua.
  assert.strictEqual(chamadas.filter((c) => c.nivel === 'redacao').length, 2);
});

test('a leitura única avisa a IA que serve a todas as ações do cliente', async () => {
  const { deps, chamadas } = depsCliente();
  await produzirPeticao(110, deps);
  const p = chamadas.find((c) => c.nivel === 'leitura').prompt;
  assert.match(p, /TODAS as ações/);
  assert.match(p, /Banco Itaú[\s\S]*Banco Pan/);
});

test('peças pedidas ao mesmo tempo esperam a mesma leitura (não leem em dobro)', async () => {
  const { deps, chamadas } = depsCliente();
  const [a, b] = await Promise.all([produzirPeticao(110, deps), produzirPeticao(111, deps)]);
  assert.strictEqual(a.ok && b.ok, true);
  assert.strictEqual(leituras(chamadas), 1);
});

test('documento novo no cliente: lê de novo; mensagem nova na conversa: não', async () => {
  const { deps, chamadas, trocarDocumentos } = depsCliente();
  await produzirPeticao(110, deps);
  await produzirPeticao(111, deps); // a conversa "mudou" (contador de chamadas), a leitura vale
  assert.strictEqual(leituras(chamadas), 1);
  trocarDocumentos([{ nome: 'hiscon.pdf', texto: 'HISCON DO CLIENTE' }, { nome: 'hiscre.pdf', texto: 'HISCRE DO CLIENTE' }, { nome: 'fatura.pdf', texto: 'FATURA' }]);
  await produzirPeticao(110, deps);
  assert.strictEqual(leituras(chamadas), 2);
});

test('"Ler os contratos" e depois a peça: uma leitura só', async () => {
  const { deps, chamadas } = depsCliente();
  const r = await levantarContratos(110, deps);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.contratos, 2);
  const p = await produzirPeticao(111, deps);
  assert.deepStrictEqual(p.ficha.contratos.map((c) => c.numero), ['PAN-1']);
  assert.strictEqual(leituras(chamadas), 1);
});

test('leitura que falhou não é guardada: a próxima peça tenta ler de novo', async () => {
  let n = 0;
  const { deps, chamadas, cache } = depsCliente();
  const ia = deps.ia;
  deps.ia = async (prompt, nivel) => (nivel === 'leitura' && n++ === 0 ? (chamadas.push({ prompt, nivel }), { ok: false, message: 'sem cota' }) : ia(prompt, nivel));
  const a = await produzirPeticao(110, deps);
  assert.ok(a.ficha.lacunas.some((l) => /falhou/.test(l)));
  assert.strictEqual(cache.size, 0);
  const b = await produzirPeticao(111, deps);
  assert.deepStrictEqual(b.ficha.contratos.map((c) => c.numero), ['PAN-1']);
  assert.strictEqual(leituras(chamadas), 2);
});

test('a redação de cada peça usa os documentos da própria peça', async () => {
  const { deps, chamadas } = depsCliente();
  await produzirPeticao(111, deps);
  const redacao = chamadas.find((c) => c.nivel === 'redacao').prompt;
  assert.match(redacao, /caso #111/);
  assert.ok(!/caso #110/.test(redacao));
});
