// Fluxos completos das ações novas do assistente (08/10/2026), pela mesma
// interface que o webhook usa — banco, IA e envio simulados.
import { test } from 'node:test';
import assert from 'node:assert';
import { criarAssistente } from '../dist/services/assistenteWhatsapp.js';

const LETICIA = '5544991011402';
const CLIENTES = [
  { id: 1, name: 'FULANA DE TAL SOUZA' },
  { id: 2, name: 'JOSE LOURENCO RIBEIRO' },
  { id: 4, name: 'ANA PAULA DOS SANTOS MAIA TERRA' },
  { id: 5, name: 'ANA MARIA DA SILVA' },
];

function montar({ respostasIa = [], leituras = [], abertos = [], contas = [], docs = [], telefone = '5527900001111', existente = null } = {}) {
  const enviados = []; const pend = []; let seq = 0; const prompts = [];
  const feito = { compromissos: [], lembretes: [], tarefas: [], recebimentos: [], baixas: [], pagas: [], cadastros: [], mensagens: [], docsEnviados: [], lancados: [] };
  const repo = {
    async comandantes() { return [LETICIA]; },
    async pendencias(phone) { return pend.filter((p) => p.phone === phone && p.status === 'aberta').sort((a, b) => a.id - b.id); },
    async criarPendencia(p) { seq += 1; pend.push({ ...p, id: seq, status: 'aberta' }); return seq; },
    async fecharPendencia(id, status) { const a = pend.find((p) => p.id === id); for (const p of pend) if (p.id === id || (a?.grupo && p.grupo === a.grupo && p.status === 'aberta')) p.status = status; },
    async lancar(l) { feito.lancados.push(l); return 1; },
    async buscarProcessos() { return [{ cliente: 'JOSE LOURENCO RIBEIRO', numero: '50331184220254025001', area: 'consumidor', fase: 'inicial', status: 'ativo', titulo: null, tribunal: 'api_publica_trf2' }]; },
    async agenda() { return []; },
    async abertosDoCliente() { return abertos; },
    async nomeCliente(id) { return CLIENTES.find((c) => c.id === id)?.name || 'X'; },
    async baixar(item, opts) { feito.baixas.push({ ...item, ...opts }); return 'ok'; },
    async clientes() { return CLIENTES; },
    async historico() { return [{ deMim: false, texto: 'qual o processo da Fulana?' }]; },
    async processosDoCliente(id) { return id === 1 ? [{ cliente: 'FULANA DE TAL SOUZA', numero: null, area: null, fase: null, status: null, titulo: null, tribunal: null }] : []; },
    async dadosCliente(id) { return { name: CLIENTES.find((c) => c.id === id).name, phone: telefone, email: 'm@x.com', cpf_cnpj: '111.444.777-35', address: 'Rua A', birth_date: null, processos: 0 }; },
    async andamento() { return [{ processo: '50331184220254025001', cliente: 'JOSE LOURENCO RIBEIRO', movimentos: [{ data: '2025-10-22', titulo: 'Suspensão', resumo: 'Suspenso pela ADPF 1236' }] }]; },
    async documentosDoCliente() { return docs; },
    async enviarDocumento(phone, docId, legenda) { feito.docsEnviados.push({ phone, docId, legenda }); return true; },
    async resumoAReceber() { return { aReceber: 3200, qtd: 4, vencidoTotal: 800, vencidos: [{ cliente: 'Vinicius', descricao: '3/5', valor: 800, vencimento: '2026-09-05' }] }; },
    async contasAPagar() { return [{ descricao: 'Luz', valor: 312.4, vencimento: '2026-10-15', vencida: false }]; },
    async contasEmAberto() { return contas; },
    async pagarConta(id, data) { feito.pagas.push({ id, data }); return 'ok'; },
    async prazos() { return [{ data: '2026-10-09', descricao: 'Contestação', processo: null, cliente: 'Fulana' }]; },
    async registrarRecebimento(r) { feito.recebimentos.push(r); return 77; },
    async criarCompromisso(c) { feito.compromissos.push(c); return 55; },
    async criarLembrete(phone, quando, texto) { feito.lembretes.push({ phone, quando, texto }); return 9; },
    async criarTarefa(t) { feito.tarefas.push(t); return 33; },
    async clientePorCpfOuNome() { return existente; },
    async salvarCadastro(dados, existenteId, midias) { feito.cadastros.push({ dados, existenteId, midias }); if (!existenteId) existente = { id: 200, name: dados.nome }; return { id: existenteId || 200, criado: !existenteId }; },
    async enviarMensagemCliente(phone, texto) { feito.mensagens.push({ phone, texto }); return true; },
  };
  const ia = {
    async interpretar(p) { prompts.push(p); return respostasIa.length ? respostasIa.shift() : null; },
    async lerDocumento() { return leituras.length ? leituras.shift() : null; },
    async transcrever() { return null; },
  };
  const a = criarAssistente({ repo, ia, enviar: async (phone, texto) => { enviados.push({ phone, texto }); }, agora: () => new Date('2026-10-08T15:00:00Z') });
  const fala = (texto, extra = {}) => a.atenderComandante({ phone: LETICIA, texto, ...extra });
  return { a, fala, enviados, pend, prompts, feito, ultima: () => enviados[enviados.length - 1]?.texto };
}
const J = (o) => JSON.stringify(o);

test('nome escrito errado acha o cliente; a conversa recente vai junto para a IA', async () => {
  const t = montar({ respostasIa: [J({ acao: 'cliente_dados', busca: 'fulanna' })] });
  await t.fala('me passa o telefone da fulanna');
  assert.match(t.ultima(), /FULANA[\s\S]*\(27\) 90000-1111/);
  assert.match(t.prompts[0], /Conversa recente[\s\S]*qual o processo da Fulana/);
});

test('nome ambíguo: pergunta qual, sem chutar', async () => {
  const t = montar({ respostasIa: [J({ acao: 'cliente_dados', busca: 'ana' })] });
  await t.fala('telefone da ana');
  assert.match(t.ultima(), /mais de um[\s\S]*ANA PAULA[\s\S]*ANA MARIA/);
});

test('processo por nome usa a ficha do cliente; por número busca direto', async () => {
  const t = montar({ respostasIa: [J({ acao: 'processo', busca: 'fulana' }), J({ acao: 'processo', busca: '5033118-42' })] });
  await t.fala('processo da fulana');
  assert.match(t.ultima(), /FULANA[\s\S]*nenhum processo cadastrado/);
  await t.fala('de quem é o 5033118-42?');
  assert.match(t.ultima(), /5033118-42\.2025\.4\.02\.5001 · TRF2/);
});

test('andamento, prazos, a receber e contas a vencer respondem na hora', async () => {
  const t = montar({ respostasIa: [J({ acao: 'andamento', busca: '5033118' }), J({ acao: 'prazos' }), J({ acao: 'a_receber' }), J({ acao: 'contas_vencer' })] });
  await t.fala('o que aconteceu no 5033118?'); assert.match(t.ultima(), /ADPF 1236/);
  await t.fala('prazos da semana'); assert.match(t.ultima(), /Contestação/);
  await t.fala('quanto tenho pra receber'); assert.match(t.ultima(), /R\$ 3\.200,00[\s\S]*Vinicius/);
  await t.fala('contas que vencem'); assert.match(t.ultima(), /Luz/);
  assert.strictEqual(t.pend.length, 0);
});

test('enviar documento: acha pela palavra (com erro) e manda o arquivo aqui', async () => {
  const docs = [{ id: 31, name: 'Procuração — Fulana', type: 'gerado', created_at: '2026-10-01' }, { id: 32, name: 'RG', type: 'anexo', created_at: '2026-10-01' }];
  const t = montar({ respostasIa: [J({ acao: 'enviar_documento', busca: 'fulana', documento: 'procurasao' }), J({ acao: 'enviar_documento', busca: 'fulana', documento: 'sentença' })], docs });
  await t.fala('me manda a procurasao da fulana');
  assert.deepStrictEqual(t.feito.docsEnviados.map((d) => d.docId), [31]);
  assert.strictEqual(t.feito.docsEnviados[0].phone, LETICIA);
  await t.fala('e a sentença?');
  assert.match(t.ultima(), /Não achei[\s\S]*Procuração — Fulana[\s\S]*RG/);
});

// Pedido (08/10/2026): "Só peça confirmação em lançamentos de financeiros,
// fora isso não precisa pedir". Agenda, lembrete, tarefa, cadastro e recado
// a cliente são feitos na hora; o financeiro continua com "sim".
test('compromisso: cria na hora (sem "sim"), ligado ao cliente', async () => {
  const t = montar({ respostasIa: [J({ acao: 'compromisso', titulo: 'Reunião com Fulana', data: '2026-10-09', hora: '14h', evento: 'reuniao', busca: 'fulana' })] });
  await t.fala('marca reuniao com a fulana amanha 14h');
  assert.strictEqual(t.feito.compromissos.length, 1);
  assert.strictEqual(t.feito.compromissos[0].clientId, 1);
  assert.strictEqual(t.feito.compromissos[0].hora, '14:00');
  assert.match(t.ultima(), /✅ Marcado na agenda[\s\S]*sexta, 09\/10\/2026 às 14:00[\s\S]*FULANA/);
  assert.strictEqual(t.pend.length, 0, 'não abre pendência');
});

test('compromisso ou lembrete no passado: avisa', async () => {
  const t = montar({ respostasIa: [J({ acao: 'lembrete', texto: 'ligar', data: '2026-10-08', hora: '08:00' })] });
  await t.fala('me lembra de ligar às 8h');
  assert.match(t.ultima(), /já passou/);
  assert.strictEqual(t.pend.length, 0);
});

test('lembrete: agenda na hora, para quem pediu', async () => {
  const t = montar({ respostasIa: [J({ acao: 'lembrete', texto: 'ligar para o perito', data: '2026-10-09', hora: '09:00' })] });
  await t.fala('me lembra amanha 9h de ligar pro perito');
  assert.deepStrictEqual(t.feito.lembretes, [{ phone: LETICIA, quando: '2026-10-09T09:00', texto: 'ligar para o perito' }]);
  assert.match(t.ultima(), /✅[\s\S]*09\/10\/2026 às 09:00/);
  assert.strictEqual(t.pend.length, 0);
});

test('tarefa com cliente: cria na hora', async () => {
  const t = montar({ respostasIa: [J({ acao: 'tarefa', titulo: 'Protocolar réplica', data: '2026-10-15', prioridade: 'alta', busca: 'jose lorenço' })] });
  await t.fala('cria tarefa protocolar replica do jose lorenço ate dia 15, urgente');
  assert.strictEqual(t.feito.tarefas[0].clientId, 2);
  assert.strictEqual(t.feito.tarefas[0].prioridade, 'alta');
  assert.match(t.ultima(), /✅ Tarefa criada/);
  assert.strictEqual(t.pend.length, 0);
});

test('recebimento que bate com parcela em aberto vira baixa da parcela', async () => {
  const abertos = [{ fonte: 'contrato', id: 11, descricao: '1/5 — Honorários', valor: 250, vencimento: '2026-10-10' }];
  const t = montar({ respostasIa: [J({ acao: 'recebimento', busca: 'fulana', valor: 250, forma: 'dinheiro' })], abertos });
  await t.fala('recebi 250 da fulana em dinheiro');
  assert.match(t.ultima(), /1\/5 — Honorários[\s\S]*Dar baixa/);
  await t.fala('sim');
  assert.deepStrictEqual(t.feito.baixas.map((b) => b.id), [11]);
  assert.strictEqual(t.feito.recebimentos.length, 0);
});

test('recebimento sem parcela correspondente vira recebimento avulso', async () => {
  const t = montar({ respostasIa: [J({ acao: 'recebimento', busca: 'fulana', valor: 500, forma: 'pix', descricao: 'consulta' })] });
  await t.fala('a fulana me pagou 500 de consulta');
  assert.match(t.ultima(), /Recebimento de cliente[\s\S]*FULANA[\s\S]*R\$ 500,00/);
  await t.fala('sim');
  assert.deepStrictEqual(t.feito.recebimentos[0], { clientId: 1, valor: 500, data: '2026-10-08', forma: 'PIX', descricao: 'consulta' });
});

test('pagar conta: acha a conta com erro de digitação e marca como paga', async () => {
  const contas = [{ id: 10, descricao: 'Conta de luz EDP', valor: 312.4, vencimento: '2026-10-15' }, { id: 11, descricao: 'Internet Vivo', valor: 120, vencimento: '2026-10-20' }];
  const t = montar({ respostasIa: [J({ acao: 'pagar_conta', descricao: 'conta de lus' })], contas });
  await t.fala('paguei a conta de lus');
  assert.match(t.ultima(), /Marcar como paga[\s\S]*Conta de luz EDP/);
  await t.fala('sim');
  assert.deepStrictEqual(t.feito.pagas, [{ id: 10, data: '2026-10-08' }]);
});

test('cadastro na hora: RG cria a ficha e o comprovante enviado depois completa a MESMA', async () => {
  const t = montar({ respostasIa: [
    J({ acao: 'cadastro_cliente', nome: 'Maria da Silva', cpf: '12345678909', rg: '1.234.567', nascimento: '1980-05-10' }),
    J({ acao: 'cadastro_cliente', nome: 'Maria da Silva', endereco: 'Rua X, 10 - Vitória/ES' }),
  ], leituras: ['{"tipo":"outro"}', '{"tipo":"outro"}'] });
  await t.fala('cadastra essa cliente', { midia: { mime: 'image/jpeg', data: Buffer.from('rg') }, mediaId: 501 });
  assert.strictEqual(t.feito.cadastros.length, 1);
  assert.strictEqual(t.feito.cadastros[0].existenteId, null);
  assert.deepStrictEqual(t.feito.cadastros[0].midias, [501]);
  assert.match(t.ultima(), /✅ Ficha criada[\s\S]*123\.456\.789-09/);
  await t.fala('', { midia: { mime: 'image/jpeg', data: Buffer.from('comp') }, mediaId: 502 });
  assert.strictEqual(t.feito.cadastros.length, 2);
  assert.strictEqual(t.feito.cadastros[1].existenteId, 200, 'completa a ficha criada, não duplica');
  assert.deepStrictEqual(t.feito.cadastros[1].midias, [502]);
  assert.match(t.ultima(), /✅ Ficha completada/);
  assert.strictEqual(t.pend.length, 0);
});

test('cadastro de quem já tem ficha: completa na hora, não duplica', async () => {
  const t = montar({ respostasIa: [J({ acao: 'cadastro_cliente', nome: 'Fulana de Tal Souza', email: 'novo@x.com' })], existente: { id: 1, name: 'FULANA DE TAL SOUZA' } });
  await t.fala('atualiza o email da fulana: novo@x.com');
  assert.strictEqual(t.feito.cadastros[0].existenteId, 1);
  assert.match(t.ultima(), /completada/);
});

test('mensagem ao cliente: envia na hora e mostra o que foi enviado', async () => {
  const t = montar({ respostasIa: [J({ acao: 'mensagem_cliente', busca: 'fulana', texto: 'Olá, Fulana! Sua audiência é dia 10 às 14h. — Dra. Letícia Barros' })] });
  await t.fala('avisa a fulana que a audiencia é dia 10 as 14h');
  assert.deepStrictEqual(t.feito.mensagens, [{ phone: '5527900001111', texto: 'Olá, Fulana! Sua audiência é dia 10 às 14h. — Dra. Letícia Barros' }]);
  assert.match(t.ultima(), /✅ Enviado para FULANA[\s\S]*Sua audiência é dia 10/);
  assert.strictEqual(t.pend.length, 0);
});

test('mensagem ao cliente sem telefone cadastrado: avisa', async () => {
  const t = montar({ respostasIa: [J({ acao: 'mensagem_cliente', busca: 'fulana', texto: 'Oi' })], telefone: null });
  await t.fala('manda oi pra fulana');
  assert.match(t.ultima(), /não tem telefone/i);
  assert.strictEqual(t.pend.length, 0);
});

test('financeiro continua pedindo "sim": recebimento, pagar conta e lançamentos', async () => {
  const t = montar({ respostasIa: [J({ acao: 'gasto', descricao: 'Uber', valor: 30 })] });
  await t.fala('gastei 30 de uber');
  assert.match(t.ultima(), /Confirma\?/);
  assert.strictEqual(t.feito.lancados.length, 0);
  assert.strictEqual(t.pend.length, 1);
});
