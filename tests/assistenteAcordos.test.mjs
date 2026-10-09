// 09/10/2026 — "teve coisas que não obtive resposta" + "me informe sempre 2 dias
// antes, 1 dia antes e no dia que um acordo está para vencer".
// Falhas reais da conversa de 08/10: "qual o vencimento do próximo acordo?" virou
// lista de PRAZOS; "acordo do Huber" e "e dos acordos?" ficaram sem resposta
// (não existia consulta de acordo); "próximos recebimentos" pediu período em vez
// de responder; "número do processo do Luiz Felipe" repetiu a AGENDA anterior.
import { test } from 'node:test';
import assert from 'node:assert';
import { parseAcao, promptAssistente, formatarAcordos, montarAvisoAcordos, formatarAReceber } from '../dist/services/assistenteRegras.js';
import { criarAssistente } from '../dist/services/assistenteWhatsapp.js';

const HOJE = '2026-10-09';
const ITENS = [
  { agreementId: 8, cliente: 'HUBER JULIO VIANA PAULINO', empresa: 'MC COMERCIO DE VEICULOS LTDA', processo: '0001246-18.2026.5.17.0003', vencimento: '2026-10-15', parcela: '1ª parcela', valor: 1500 },
  { agreementId: 8, cliente: 'HUBER JULIO VIANA PAULINO', empresa: 'MC COMERCIO DE VEICULOS LTDA', processo: '0001246-18.2026.5.17.0003', vencimento: '2026-11-16', parcela: '2ª parcela', valor: 1500 },
  { agreementId: 7, cliente: 'WALESKA GERA LEAL WELSING', empresa: 'OLIVEIRA SAUDE VILA VELHA LTDA', processo: '0000082-24.2026.5.17.0001', vencimento: '2026-10-10', parcela: '1ª parcela', valor: 460.41 },
  { agreementId: 1, cliente: 'MAYKON DOUGLAS', empresa: 'M. A. M. MEDEIROS', processo: '0001850-10.2025.5.17.0004', vencimento: '2026-10-11', parcela: '3ª parcela', valor: 300 },
  { agreementId: 9, cliente: 'LUIZ FELIPE', empresa: 'FDGH SOARES', processo: '0001874-26.2025.5.17.0008', vencimento: '2026-10-09', parcela: '2ª parcela', valor: 660 },
  { agreementId: 4, cliente: 'FULANO ATRASADO', empresa: 'EMPRESA X', processo: null, vencimento: '2026-10-06', parcela: '1ª parcela', valor: 200 },
];

test('parse: consulta de acordos, com ou sem cliente', () => {
  assert.deepStrictEqual(parseAcao('{"acao":"acordos","busca":"Huber"}', HOJE), { tipo: 'acordos', busca: 'Huber' });
  assert.deepStrictEqual(parseAcao('{"acao":"acordos"}', HOJE), { tipo: 'acordos', busca: null });
});

test('formatar acordos: próximo vencimento por acordo, data, parcela e valor', () => {
  const t = formatarAcordos(ITENS, HOJE);
  assert.match(t, /HUBER[\s\S]*MC COMERCIO[\s\S]*15\/10[\s\S]*1ª parcela[\s\S]*R\$ 1\.500,00/);
  assert.match(t, /LUIZ FELIPE[\s\S]*hoje/i);
  assert.match(t, /FULANO ATRASADO[\s\S]*venceu/i);
  // o mais urgente aparece primeiro
  assert.ok(t.indexOf('FULANO') < t.indexOf('LUIZ FELIPE') && t.indexOf('LUIZ FELIPE') < t.indexOf('HUBER'));
  assert.match(formatarAcordos([], HOJE), /Nenhum acordo com parcela em aberto/);
});

test('aviso diário: hoje, amanhã, em 2 dias e os que venceram sem baixa', () => {
  const t = montarAvisoAcordos(ITENS, HOJE);
  assert.match(t, /\*Hoje \(09\/10\)\*[\s\S]*LUIZ FELIPE[\s\S]*R\$ 660,00/);
  assert.match(t, /\*Amanhã \(10\/10\)\*[\s\S]*WALESKA[\s\S]*R\$ 460,41/);
  assert.match(t, /\*Em 2 dias \(11\/10\)\*[\s\S]*MAYKON/);
  assert.match(t, /Venceu e ainda não foi baixado[\s\S]*FULANO ATRASADO[\s\S]*06\/10/);
  assert.doesNotMatch(t, /HUBER/, 'vencimento dia 15 não entra no aviso de hoje');
  assert.strictEqual(montarAvisoAcordos(ITENS.filter((i) => i.cliente === 'HUBER JULIO VIANA PAULINO'), HOJE), null, 'sem nada perto → não manda mensagem');
});

test('a receber lista os próximos recebimentos, não só o total', () => {
  const t = formatarAReceber({ de: '2026-10-09', ate: '2026-10-31', atrasados: false, aReceber: 1960, qtd: 2, vencidoTotal: 0, vencidos: [],
    proximos: [{ cliente: 'HUBER', descricao: 'Acordo 1ª parcela', valor: 1500, vencimento: '2026-10-15' }, { cliente: 'WALESKA', descricao: 'Acordo', valor: 460, vencimento: '2026-10-10' }] });
  assert.match(t, /Próximos[\s\S]*10\/10[\s\S]*WALESKA[\s\S]*15\/10[\s\S]*HUBER/);
});

test('prompt: pedido atual em destaque, sem repetir a resposta anterior, sem pedir período, com acordos', () => {
  const p = promptAssistente({ hoje: HOJE, diaSemana: 'sexta-feira', mensagem: 'Qual o número do processo do Luiz Felipe',
    historico: [{ deMim: false, texto: 'Qual a minha agenda de amanhã?' }, { deMim: true, texto: '📅 Agenda de sexta' }] });
  assert.match(p, /PEDIDO ATUAL/);
  assert.ok(p.lastIndexOf('Qual o número do processo do Luiz Felipe') > p.lastIndexOf('Agenda de sexta'), 'pedido atual vem por último');
  assert.match(p, /não repita/i);
  assert.match(p, /nunca pergunte o período/i);
  assert.match(p, /"acordos"/);
  assert.match(p, /Exemplos/);
});

test('orquestrador: "acordo do Huber" consulta os acordos do cliente', async () => {
  const pedidos = [];
  const repo = new Proxy({
    async pendencias() { return []; }, async historico() { return []; },
    async clientes() { return [{ id: 100, name: 'HUBER JULIO VIANA PAULINO' }]; },
    async acordos(clientId) { pedidos.push(clientId); return ITENS.filter((i) => i.agreementId === 8); },
  }, { get: (o, k) => o[k] || (async () => []) });
  const enviados = [];
  const a = criarAssistente({ repo, ia: { async interpretar() { return '{"acao":"acordos","busca":"huber"}'; }, async lerDocumento() { return null; }, async transcrever() { return null; } },
    enviar: async (_p, t) => { enviados.push(t); }, agora: () => new Date('2026-10-09T13:00:00Z') });
  await a.atenderComandante({ phone: '5544991011402', texto: 'Qual a data de pagamento do acordo do Huber?' });
  assert.deepStrictEqual(pedidos, [100]);
  assert.match(enviados[0], /HUBER[\s\S]*15\/10[\s\S]*16\/11/);
});
