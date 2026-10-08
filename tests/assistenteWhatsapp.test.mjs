// Orquestrador do assistente pessoal do WhatsApp — testado pela mesma interface
// que o webhook usa (criarAssistente), com banco, IA e envio simulados.
import { test } from 'node:test';
import assert from 'node:assert';
import { criarAssistente } from '../dist/services/assistenteWhatsapp.js';

const LETICIA = '5544991011402';
const JESSICA = '5527988798093';

function montar({ respostasIa = [], leituras = [], transcricao = null, abertos = [] } = {}) {
  const enviados = [];
  const pend = []; let seq = 0;
  const lancados = []; const baixas = []; const prompts = [];
  let leiturasFeitas = 0;
  const repo = {
    async comandantes() { return [LETICIA, JESSICA]; },
    async pendencias(phone) { return pend.filter((p) => p.phone === phone && p.status === 'aberta').sort((a, b) => a.id - b.id); },
    async criarPendencia(p) { seq += 1; pend.push({ ...p, id: seq, status: 'aberta' }); return seq; },
    async fecharPendencia(id, status) {
      const alvo = pend.find((p) => p.id === id);
      for (const p of pend) if (p.id === id || (alvo?.grupo && p.grupo === alvo.grupo && p.status === 'aberta')) p.status = status;
    },
    async lancar(l, quem) { lancados.push({ ...l, quem }); return 900 + lancados.length; },
    async buscarProcessos() { return []; },
    async clientes() { return [{ id: 5, name: 'MAILZA DOS SANTOS COSTA' }]; },
    async historico() { return []; },
    async processosDoCliente() { return [{ cliente: 'MAILZA DOS SANTOS COSTA', numero: '00001234520265170001', area: 'trabalhista', fase: 'inicial', status: 'ativo', titulo: null, tribunal: 'TRT17' }]; },
    async agenda(de, ate) { return [{ data: de, hora: '14:00', tipo: 'audiencia', titulo: 'Audiência Mailza', local: null }]; },
    async abertosDoCliente() { return abertos; },
    async nomeCliente() { return 'MAILZA DOS SANTOS COSTA'; },
    async baixar(item, opts) { baixas.push({ ...item, ...opts }); return 'ok'; },
  };
  const ia = {
    async interpretar(prompt) { prompts.push(prompt); return respostasIa.length ? respostasIa.shift() : null; },
    async lerDocumento() { leiturasFeitas += 1; return leituras.length ? leituras.shift() : null; },
    async transcrever() { return transcricao; },
  };
  const a = criarAssistente({ repo, ia, enviar: async (phone, texto) => { enviados.push({ phone, texto }); }, agora: () => new Date('2026-10-08T15:00:00Z') });
  return { a, enviados, pend, lancados, baixas, prompts, leiturasFeitas: () => leiturasFeitas };
}

const GASTO = JSON.stringify({ acao: 'gasto', descricao: 'Uber para o fórum', valor: 38.5, categoria: 'transporte', escopo: 'empresa' });
const BOLETO = JSON.stringify({ acao: 'conta_pagar', descricao: 'Conta de luz EDP', valor: 312.4, data: '2026-10-15', categoria: 'moradia', escopo: 'pessoal' });

test('gasto: pede confirmação e só lança depois do "sim"', async () => {
  const t = montar({ respostasIa: [GASTO] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'gastei 38,50 de uber pro fórum' });
  assert.strictEqual(t.lancados.length, 0, 'nada gravado antes do sim');
  assert.match(t.enviados[0].texto, /Gasto[\s\S]*R\$ 38,50[\s\S]*Confirma/);
  assert.strictEqual(t.enviados[0].phone, LETICIA);
  await t.a.atenderComandante({ phone: LETICIA, texto: 'sim' });
  assert.strictEqual(t.lancados.length, 1);
  assert.strictEqual(t.lancados[0].valor, 38.5);
  assert.strictEqual(t.lancados[0].data, '2026-10-08', 'gasto sem data = hoje (Brasília)');
  assert.match(t.enviados[1].texto, /✅/);
  assert.strictEqual(t.pend.filter((p) => p.status === 'aberta').length, 0);
});

test('"não" cancela sem gravar', async () => {
  const t = montar({ respostasIa: [GASTO] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'gastei 38,50 de uber' });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'não' });
  assert.strictEqual(t.lancados.length, 0);
  assert.match(t.enviados[1].texto, /Cancelado/);
});

test('duas pendências: "sim" pergunta qual; "sim 2" lança a segunda', async () => {
  const t = montar({ respostasIa: [GASTO, BOLETO] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'gastei 38,50 de uber' });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'boleto de luz 312,40 vence dia 15' });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'sim' });
  assert.strictEqual(t.lancados.length, 0);
  assert.match(t.enviados[2].texto, /1\)[\s\S]*2\)[\s\S]*sim 1/);
  await t.a.atenderComandante({ phone: LETICIA, texto: 'sim 2' });
  assert.strictEqual(t.lancados.length, 1);
  assert.strictEqual(t.lancados[0].descricao, 'Conta de luz EDP');
});

test('correção ("é pessoal") substitui o lançamento pendente', async () => {
  const corrigido = JSON.stringify({ acao: 'gasto', descricao: 'Uber para o fórum', valor: 38.5, categoria: 'pessoal', escopo: 'pessoal', corrige: true });
  const t = montar({ respostasIa: [GASTO, corrigido] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'gastei 38,50 de uber' });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'não, é pessoal' });
  assert.match(t.prompts[1], /aguardando confirmação/, 'a IA recebe o lançamento pendente como contexto');
  const abertas = t.pend.filter((p) => p.status === 'aberta');
  assert.strictEqual(abertas.length, 1);
  assert.strictEqual(abertas[0].payload.escopo, 'pessoal');
  await t.a.atenderComandante({ phone: LETICIA, texto: 'sim' });
  assert.strictEqual(t.lancados[0].escopo, 'pessoal');
});

test('pendência de um número não é confirmada pelo outro', async () => {
  const t = montar({ respostasIa: [GASTO] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'gastei 38,50 de uber' });
  await t.a.atenderComandante({ phone: JESSICA, texto: 'sim' });
  assert.strictEqual(t.lancados.length, 0);
  assert.match(t.enviados[1].texto, /nada aguardando/i);
});

test('consulta de processo e de agenda respondem na hora', async () => {
  const t = montar({ respostasIa: ['{"acao":"processo","busca":"Mailza"}', '{"acao":"agenda","data_inicio":"2026-10-09","data_fim":"2026-10-09"}'] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'qual o processo da Mailza?' });
  assert.match(t.enviados[0].texto, /0000123-45\.2026\.5\.17\.0001/);
  await t.a.atenderComandante({ phone: LETICIA, texto: 'agenda de amanhã' });
  assert.match(t.enviados[1].texto, /Audiência Mailza/);
  assert.strictEqual(t.pend.length, 0, 'consulta não cria pendência');
});

test('o prompt leva a data de hoje em Brasília', async () => {
  const t = montar({ respostasIa: ['{"acao":"responder","texto":"Oi!"}'] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'oi' });
  assert.match(t.prompts[0], /quinta-feira, 2026-10-08/);
  assert.strictEqual(t.enviados[0].texto, 'Oi!');
});

test('áudio é transcrito e vira o pedido', async () => {
  const t = montar({ respostasIa: [GASTO], transcricao: 'gastei trinta e oito e cinquenta de uber' });
  await t.a.atenderComandante({ phone: LETICIA, texto: '', midia: { mime: 'audio/ogg', data: Buffer.from('x') } });
  assert.match(t.prompts[0], /trinta e oito e cinquenta/);
  assert.match(t.enviados[0].texto, /Confirma/);
});

test('foto de boleto sem texto: lê o documento e manda para a IA', async () => {
  const t = montar({ respostasIa: [BOLETO], leituras: ['{"tipo":"boleto","beneficiario":"EDP","valor":"312,40","vencimento":"15/10/2026"}'] });
  await t.a.atenderComandante({ phone: LETICIA, texto: '', midia: { mime: 'image/jpeg', data: Buffer.from('x') } });
  assert.match(t.prompts[0], /Documento enviado junto[\s\S]*EDP/);
  assert.match(t.enviados[0].texto, /Contas a Pagar[\s\S]*15\/10\/2026/);
});

test('IA fora do ar: avisa em vez de ficar calado', async () => {
  const t = montar({ respostasIa: [] });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'gastei 10 reais' });
  assert.match(t.enviados[0].texto, /IA/);
});

const ABERTOS = [{ fonte: 'contrato', id: 11, descricao: '1/5 — Honorários', valor: 250, vencimento: '2026-10-10' }];
const COMPROVANTE_OK = '{"tipo":"comprovante","valor":"250,00","data_pagamento":"07/10/2026","destinatario_nome":"LETICIA ELIAS BARROS"}';

test('comprovante de cliente: pergunta às duas e a baixa só sai com o "sim" de uma', async () => {
  const t = montar({ leituras: [COMPROVANTE_OK], abertos: ABERTOS });
  await t.a.conferirComprovanteCliente({ clientId: 5, mediaId: 77, midia: { mime: 'image/jpeg', data: Buffer.from('x') } });
  assert.strictEqual(t.enviados.length, 2);
  assert.deepStrictEqual(t.enviados.map((e) => e.phone).sort(), [JESSICA, LETICIA].sort());
  assert.match(t.enviados[0].texto, /MAILZA[\s\S]*R\$ 250,00[\s\S]*✅[\s\S]*1\/5 — Honorários[\s\S]*Dar baixa\?/);
  assert.strictEqual(t.baixas.length, 0);
  await t.a.atenderComandante({ phone: JESSICA, texto: 'sim' });
  assert.strictEqual(t.baixas.length, 1);
  assert.deepStrictEqual({ fonte: t.baixas[0].fonte, id: t.baixas[0].id, valor: t.baixas[0].valor, data: t.baixas[0].data }, { fonte: 'contrato', id: 11, valor: 250, data: '2026-10-07' });
  assert.strictEqual(t.pend.filter((p) => p.status === 'aberta').length, 0, 'a pendência da outra fecha junto');
  await t.a.atenderComandante({ phone: LETICIA, texto: 'sim' });
  assert.strictEqual(t.baixas.length, 1, 'não baixa duas vezes');
});

test('comprovante: cliente sem nada em aberto não gasta IA', async () => {
  const t = montar({ leituras: [COMPROVANTE_OK], abertos: [] });
  await t.a.conferirComprovanteCliente({ clientId: 5, mediaId: 78, midia: { mime: 'image/jpeg', data: Buffer.from('x') } });
  assert.strictEqual(t.leiturasFeitas(), 0);
  assert.strictEqual(t.enviados.length, 0);
});

test('comprovante: foto que não é comprovante é ignorada', async () => {
  const t = montar({ leituras: ['{"tipo":"outro","descricao":"RG"}'], abertos: ABERTOS });
  await t.a.conferirComprovanteCliente({ clientId: 5, mediaId: 79, midia: { mime: 'image/jpeg', data: Buffer.from('x') } });
  assert.strictEqual(t.enviados.length, 0);
});

test('comprovante sem parcela de mesmo valor: avisa sem criar pendência', async () => {
  const t = montar({ leituras: ['{"tipo":"comprovante","valor":"300,00","data_pagamento":"07/10/2026","destinatario_nome":"LETICIA ELIAS BARROS"}'], abertos: ABERTOS });
  await t.a.conferirComprovanteCliente({ clientId: 5, mediaId: 80, midia: { mime: 'application/pdf', data: Buffer.from('x') } });
  assert.match(t.enviados[0].texto, /Não achei parcela em aberto com esse valor[\s\S]*1\/5 — Honorários/);
  assert.strictEqual(t.pend.length, 0);
});

test('comprovante pago para outra pessoa: alerta em destaque', async () => {
  const t = montar({ leituras: ['{"tipo":"comprovante","valor":"250,00","data_pagamento":"07/10/2026","destinatario_nome":"JOAO GOLPISTA"}'], abertos: ABERTOS });
  await t.a.conferirComprovanteCliente({ clientId: 5, mediaId: 81, midia: { mime: 'image/jpeg', data: Buffer.from('x') } });
  assert.match(t.enviados[0].texto, /❌[\s\S]*JOAO GOLPISTA/);
});
