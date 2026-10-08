// Ações novas do assistente do WhatsApp (08/10/2026 — "pode colocar todos"):
// financeiro, dados do cliente, andamento, documentos, prazos, compromisso,
// lembrete, tarefa, recebimento, pagar conta, cadastro e mensagem ao cliente.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseAcao, interpretarConfirmacao, textoConfirmacao, promptAssistente, mesclarCadastro,
  formatarAReceber, formatarContasVencer, formatarPrazos, formatarClienteDados, formatarAndamento,
} from '../dist/services/assistenteRegras.js';

const HOJE = '2026-10-08';
const P = (o) => parseAcao(JSON.stringify(o), HOJE);

test('confirmação entende erros comuns ("sin", "simm", "nn", "naum", "pode sim")', () => {
  for (const s of ['sin', 'simm', 'Si', 'ss', 'pode sim', 'pode ser', 'claro', 'isso mesmo', 'manda ver', 'confirmar']) {
    assert.strictEqual(interpretarConfirmacao(s)?.resposta, 'sim', s);
  }
  for (const n of ['nn', 'naum', 'nao quero', 'não precisa', 'cancelar 2']) {
    assert.strictEqual(interpretarConfirmacao(n)?.resposta, 'nao', n);
  }
  assert.strictEqual(interpretarConfirmacao('cancelar 2').indice, 2);
});

test('a receber: padrão é o mês atual; "atrasados" liga o filtro', () => {
  assert.deepStrictEqual(P({ acao: 'a_receber' }), { tipo: 'a_receber', de: '2026-10-01', ate: '2026-10-31', atrasados: false });
  assert.deepStrictEqual(P({ acao: 'a_receber', atrasados: true }), { tipo: 'a_receber', de: '2026-10-01', ate: '2026-10-31', atrasados: true });
  assert.deepStrictEqual(P({ acao: 'a_receber', data_inicio: '2026-11-01', data_fim: '2026-11-30' }).de, '2026-11-01');
});

test('contas a vencer e prazos: padrão hoje + 7 dias', () => {
  assert.deepStrictEqual(P({ acao: 'contas_vencer' }), { tipo: 'contas_vencer', de: HOJE, ate: '2026-10-15' });
  assert.deepStrictEqual(P({ acao: 'prazos' }), { tipo: 'prazos', de: HOJE, ate: '2026-10-15' });
});

test('consultas por cliente exigem a busca', () => {
  assert.deepStrictEqual(P({ acao: 'cliente_dados', busca: 'Mailza' }), { tipo: 'cliente_dados', busca: 'Mailza' });
  assert.deepStrictEqual(P({ acao: 'andamento', busca: 'José Lourenço' }), { tipo: 'andamento', busca: 'José Lourenço' });
  assert.deepStrictEqual(P({ acao: 'enviar_documento', busca: 'Mailza', documento: 'procuração' }), { tipo: 'enviar_documento', busca: 'Mailza', documento: 'procuração' });
  assert.strictEqual(P({ acao: 'cliente_dados' }).tipo, 'responder');
});

test('compromisso: precisa de data e hora; duração padrão 1h', () => {
  assert.deepStrictEqual(P({ acao: 'compromisso', titulo: 'Reunião com Mailza', data: '2026-10-09', hora: '14:00', evento: 'reuniao', busca: 'Mailza' }),
    { tipo: 'compromisso', titulo: 'Reunião com Mailza', data: '2026-10-09', hora: '14:00', duracao: 60, evento: 'reuniao', local: null, busca: 'Mailza' });
  assert.match(P({ acao: 'compromisso', titulo: 'Reunião', data: '2026-10-09' }).texto, /horário/i);
  assert.strictEqual(P({ acao: 'compromisso', titulo: 'X', data: '2026-10-09', hora: '9h' }).hora, '09:00');
  assert.strictEqual(P({ acao: 'compromisso', titulo: 'X', data: '2026-10-09', hora: '14:30', evento: 'festa' }).evento, 'compromisso');
});

test('lembrete: hora obrigatória, data padrão hoje', () => {
  assert.deepStrictEqual(P({ acao: 'lembrete', texto: 'ligar para o perito', hora: '09:00', data: '2026-10-09' }), { tipo: 'lembrete', texto: 'ligar para o perito', data: '2026-10-09', hora: '09:00' });
  assert.strictEqual(P({ acao: 'lembrete', texto: 'x', hora: '16:00' }).data, HOJE);
  assert.match(P({ acao: 'lembrete', texto: 'x' }).texto, /horário/i);
});

test('tarefa: título obrigatório; prioridade válida', () => {
  assert.deepStrictEqual(P({ acao: 'tarefa', titulo: 'Protocolar réplica da Rachel', data: '2026-10-15', prioridade: 'alta', busca: 'Rachel' }),
    { tipo: 'tarefa', titulo: 'Protocolar réplica da Rachel', data: '2026-10-15', prioridade: 'alta', busca: 'Rachel', descricao: null });
  assert.strictEqual(P({ acao: 'tarefa', titulo: 'X', prioridade: 'urgentissima' }).prioridade, 'media');
});

test('recebimento: cliente e valor obrigatórios; forma normalizada', () => {
  assert.deepStrictEqual(P({ acao: 'recebimento', busca: 'Fulana', valor: '500', forma: 'dinheiro' }),
    { tipo: 'recebimento', busca: 'Fulana', valor: 500, data: HOJE, forma: 'Dinheiro', descricao: 'Pagamento recebido' });
  assert.strictEqual(P({ acao: 'recebimento', busca: 'Fulana', valor: 500, forma: 'pix' }).forma, 'PIX');
  assert.match(P({ acao: 'recebimento', busca: 'Fulana' }).texto, /valor/i);
  assert.strictEqual(P({ acao: 'recebimento', busca: 'Fulana', valor: 500, data: '2026-10-20' }).data, HOJE, 'recebimento não pode ser no futuro');
});

test('pagar conta: descrição ou valor', () => {
  assert.deepStrictEqual(P({ acao: 'pagar_conta', descricao: 'conta de luz' }), { tipo: 'pagar_conta', descricao: 'conta de luz', valor: null, data: HOJE });
  assert.strictEqual(P({ acao: 'pagar_conta' }).tipo, 'responder');
});

test('cadastro de cliente: nome ou CPF obrigatório; CPF formatado', () => {
  const c = P({ acao: 'cadastro_cliente', nome: 'Maria da Silva', cpf: '12345678909', nascimento: '10/05/1980', telefone: '27 99999-1234' });
  assert.strictEqual(c.tipo, 'cadastro_cliente');
  assert.strictEqual(c.dados.nome, 'Maria da Silva');
  assert.strictEqual(c.dados.cpf, '123.456.789-09');
  assert.strictEqual(c.dados.nascimento, '1980-05-10');
  assert.strictEqual(c.dados.telefone, '27999991234');
  assert.strictEqual(P({ acao: 'cadastro_cliente' }).tipo, 'responder');
});

test('mesclar cadastro: completa o que falta, não apaga o que já tinha', () => {
  const a = { nome: 'Maria da Silva', cpf: '123.456.789-09', rg: null, nascimento: null, endereco: null, email: null, telefone: null, estado_civil: null, profissao: null, nacionalidade: null };
  const b = { nome: 'MARIA DA SILVA', cpf: null, rg: '1.234.567', nascimento: '1980-05-10', endereco: 'Rua X, 10', email: null, telefone: null, estado_civil: null, profissao: null, nacionalidade: null };
  assert.deepStrictEqual(mesclarCadastro(a, b), { ...a, rg: '1.234.567', nascimento: '1980-05-10', endereco: 'Rua X, 10' });
});

test('mensagem ao cliente: precisa de cliente e texto', () => {
  assert.deepStrictEqual(P({ acao: 'mensagem_cliente', busca: 'Mailza', texto: 'Olá, Mailza! Sua audiência é dia 10 às 14h.' }),
    { tipo: 'mensagem_cliente', busca: 'Mailza', texto: 'Olá, Mailza! Sua audiência é dia 10 às 14h.' });
  assert.strictEqual(P({ acao: 'mensagem_cliente', busca: 'Mailza' }).tipo, 'responder');
});

test('textos de confirmação mostram exatamente o que vai acontecer', () => {
  assert.match(textoConfirmacao({ tipo: 'compromisso', titulo: 'Reunião com Mailza', data: '2026-10-09', hora: '14:00', duracao: 60, evento: 'reuniao', local: null, cliente: 'MAILZA DOS SANTOS COSTA' }),
    /Agenda[\s\S]*Reunião com Mailza[\s\S]*sexta, 09\/10\/2026 às 14:00[\s\S]*MAILZA[\s\S]*\*sim\*/);
  assert.match(textoConfirmacao({ tipo: 'lembrete', texto: 'ligar para o perito', data: '2026-10-09', hora: '09:00' }), /Lembrete[\s\S]*ligar para o perito[\s\S]*09\/10\/2026 às 09:00/);
  assert.match(textoConfirmacao({ tipo: 'tarefa', titulo: 'Protocolar réplica', data: '2026-10-15', prioridade: 'alta', cliente: 'Rachel', descricao: null }), /Tarefa[\s\S]*Protocolar réplica[\s\S]*15\/10\/2026[\s\S]*alta/);
  assert.match(textoConfirmacao({ tipo: 'recebimento', cliente: 'FULANA', valor: 500, data: HOJE, forma: 'Dinheiro', descricao: 'Pagamento recebido' }), /Recebimento[\s\S]*FULANA[\s\S]*R\$ 500,00[\s\S]*Dinheiro/);
  assert.match(textoConfirmacao({ tipo: 'pagar_conta', id: 10, descricao: 'Conta de luz EDP', valor: 312.4, vencimento: '2026-10-15', data: HOJE }), /Marcar como paga[\s\S]*Conta de luz EDP[\s\S]*R\$ 312,40/);
  assert.match(textoConfirmacao({ tipo: 'mensagem_cliente', cliente: 'MAILZA', telefone: '5527988216960', texto: 'Olá!' }), /Enviar para[\s\S]*MAILZA[\s\S]*"Olá!"/);
  const cad = textoConfirmacao({ tipo: 'cadastro_cliente', dados: { nome: 'Maria', cpf: '123.456.789-09', rg: null, nascimento: '1980-05-10', endereco: null, email: null, telefone: null, estado_civil: null, profissao: null, nacionalidade: null }, existente: { id: 5, name: 'MARIA' }, midias: [1, 2] });
  assert.match(cad, /Já existe a ficha[\s\S]*MARIA[\s\S]*completar/i);
  assert.match(cad, /2 documento/);
  assert.match(textoConfirmacao({ tipo: 'cadastro_cliente', dados: { nome: 'Maria', cpf: null, rg: null, nascimento: null, endereco: null, email: null, telefone: null, estado_civil: null, profissao: null, nacionalidade: null }, existente: null, midias: [] }), /Nova ficha/);
});

test('prompt: avisa que pode ter erro de digitação e leva a conversa recente', () => {
  const p = promptAssistente({ hoje: HOJE, diaSemana: 'quinta-feira', mensagem: 'e o telefone dela?', historico: [{ deMim: false, texto: 'qual o processo da Mailza?' }, { deMim: true, texto: '👤 MAILZA DOS SANTOS COSTA' }] });
  assert.match(p, /erros de digitação/i);
  assert.match(p, /Conversa recente[\s\S]*Mailza[\s\S]*MAILZA/);
  for (const a of ['a_receber', 'contas_vencer', 'cliente_dados', 'andamento', 'enviar_documento', 'prazos', 'compromisso', 'lembrete', 'tarefa', 'recebimento', 'pagar_conta', 'cadastro_cliente', 'mensagem_cliente']) {
    assert.ok(p.includes(`"${a}"`), a);
  }
});

test('formatar a receber: sua parte, vencidos e lista', () => {
  const t = formatarAReceber({ de: '2026-10-01', ate: '2026-10-31', atrasados: false, aReceber: 3200, qtd: 4, vencidoTotal: 800, vencidos: [{ cliente: 'Vinicius', descricao: '3/5', valor: 800, vencimento: '2026-09-05' }] });
  assert.match(t, /01\/10 a 31\/10[\s\S]*R\$ 3\.200,00[\s\S]*Vencido[\s\S]*R\$ 800,00[\s\S]*Vinicius/);
  assert.match(formatarAReceber({ de: '2026-10-01', ate: '2026-10-31', atrasados: true, aReceber: 0, qtd: 0, vencidoTotal: 0, vencidos: [] }), /Ninguém em atraso/);
});

test('formatar contas a vencer, prazos, dados do cliente e andamento', () => {
  assert.match(formatarContasVencer([{ descricao: 'Luz', valor: 312.4, vencimento: '2026-10-15', vencida: false }], HOJE, '2026-10-15'), /15\/10 — Luz — R\$ 312,40/);
  assert.match(formatarContasVencer([], HOJE, '2026-10-15'), /Nenhuma conta/);
  assert.match(formatarPrazos([{ data: '2026-10-09', descricao: 'Contestação', processo: '0001', cliente: 'Mailza' }], HOJE, '2026-10-15'), /09\/10[\s\S]*Contestação[\s\S]*Mailza/);
  const d = formatarClienteDados({ name: 'MAILZA DOS SANTOS COSTA', phone: '27988216960', email: 'm@x.com', cpf_cnpj: '627.009.015-68', address: 'Rua A', birth_date: '1980-09-27', processos: 0 });
  assert.match(d, /MAILZA[\s\S]*\(27\) 98821-6960[\s\S]*627\.009\.015-68[\s\S]*Rua A[\s\S]*27\/09\/1980/);
  assert.doesNotMatch(d, /senha/i);
  const a = formatarAndamento([{ processo: '50331184220254025001', cliente: 'JOSE', movimentos: [{ data: '2025-10-22', titulo: 'Suspensão', resumo: 'Suspenso pela ADPF 1236' }] }]);
  assert.match(a, /5033118-42\.2025\.4\.02\.5001[\s\S]*22\/10\/2025[\s\S]*Suspenso pela ADPF 1236/);
  assert.match(formatarAndamento([{ processo: '1', cliente: 'X', movimentos: [] }]), /sem movimentação/i);
});
