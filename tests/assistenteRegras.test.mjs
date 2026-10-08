// Assistente pessoal do CRM pelo WhatsApp (pedido de 08/10/2026): a Dra. Letícia
// (44 99101-1402) e a Jessica (27 98879-8093) mandam mensagem para o número do
// escritório e o CRM responde como assistente — lança boleto em Contas a Pagar,
// registra gasto, diz o número do processo de um cliente, mostra a agenda — e
// confere comprovante de cliente antes de dar baixa (sempre com "sim").
import { test } from 'node:test';
import assert from 'node:assert';
import {
  ehComandante, interpretarConfirmacao, parseAcao, parseLeituraDocumento, casarComprovante,
  destinatarioConfere, textoConfirmacao, formatarAgenda, formatarProcessos, parseNumerosComandantes,
} from '../dist/services/assistenteRegras.js';

const HOJE = '2026-10-08';

test('comandantes: reconhece o número com ou sem o 9º dígito e com/sem 55', () => {
  const lista = parseNumerosComandantes('5544991011402, 27988798093');
  assert.ok(ehComandante('5544991011402', lista));
  assert.ok(ehComandante('554491011402', lista), 'WhatsApp às vezes manda sem o 9');
  assert.ok(ehComandante('5527988798093', lista));
  assert.ok(!ehComandante('5527995151402', lista), 'o próprio número do escritório não comanda');
  assert.ok(!ehComandante('5544991011403', lista));
  assert.ok(!ehComandante('', lista));
});

test('confirmação: sim/não, com número opcional', () => {
  assert.deepStrictEqual(interpretarConfirmacao('Sim'), { resposta: 'sim', indice: null });
  assert.deepStrictEqual(interpretarConfirmacao('pode lançar'), { resposta: 'sim', indice: null });
  assert.deepStrictEqual(interpretarConfirmacao('ok 👍'), { resposta: 'sim', indice: null });
  assert.deepStrictEqual(interpretarConfirmacao('sim 2'), { resposta: 'sim', indice: 2 });
  assert.deepStrictEqual(interpretarConfirmacao('Não'), { resposta: 'nao', indice: null });
  assert.deepStrictEqual(interpretarConfirmacao('cancela'), { resposta: 'nao', indice: null });
  assert.strictEqual(interpretarConfirmacao('simone ligou'), null);
  assert.strictEqual(interpretarConfirmacao('qual o processo da Mailza?'), null);
  assert.strictEqual(interpretarConfirmacao('não, é pessoal'), null, 'correção vai pra IA, não é só "não"');
});

test('parseAcao: conta a pagar com dados completos', () => {
  const a = parseAcao(JSON.stringify({ acao: 'conta_pagar', descricao: 'Conta de luz EDP', valor: '312,40', data: '2026-10-15', categoria: 'moradia', escopo: 'pessoal' }), HOJE);
  assert.deepStrictEqual(a, { tipo: 'conta_pagar', descricao: 'Conta de luz EDP', valor: 312.4, data: '2026-10-15', categoria: 'moradia', escopo: 'pessoal', codigo: null });
});

test('parseAcao: gasto sem data usa hoje; categoria inválida cai no padrão do escopo', () => {
  const a = parseAcao(JSON.stringify({ acao: 'gasto', descricao: 'Uber para o fórum', valor: 38.5, categoria: 'xyz', escopo: 'empresa' }), HOJE);
  assert.deepStrictEqual(a, { tipo: 'gasto', descricao: 'Uber para o fórum', valor: 38.5, data: HOJE, categoria: 'empresa', escopo: 'empresa', codigo: null });
  const p = parseAcao(JSON.stringify({ acao: 'gasto', descricao: 'Farmácia', valor: 50, escopo: 'pessoal' }), HOJE);
  assert.strictEqual(p.categoria, 'pessoal');
});

test('parseAcao: lançamento sem valor vira pergunta', () => {
  const a = parseAcao(JSON.stringify({ acao: 'conta_pagar', descricao: 'Boleto condomínio', valor: null }), HOJE);
  assert.strictEqual(a.tipo, 'responder');
  assert.match(a.texto, /valor/i);
});

test('parseAcao: conta a pagar sem vencimento vira pergunta', () => {
  const a = parseAcao(JSON.stringify({ acao: 'conta_pagar', descricao: 'Boleto', valor: 100 }), HOJE);
  assert.strictEqual(a.tipo, 'responder');
  assert.match(a.texto, /vencimento/i);
});

test('parseAcao: consulta de processo e de agenda', () => {
  assert.deepStrictEqual(parseAcao('{"acao":"processo","busca":"Mailza"}', HOJE), { tipo: 'processo', busca: 'Mailza' });
  assert.deepStrictEqual(parseAcao('{"acao":"agenda","data_inicio":"2026-10-09","data_fim":"2026-10-09"}', HOJE), { tipo: 'agenda', de: '2026-10-09', ate: '2026-10-09' });
  assert.deepStrictEqual(parseAcao('{"acao":"agenda"}', HOJE), { tipo: 'agenda', de: HOJE, ate: HOJE });
  // intervalo invertido é corrigido; mais de 31 dias é limitado
  assert.deepStrictEqual(parseAcao('{"acao":"agenda","data_inicio":"2026-10-20","data_fim":"2026-10-10"}', HOJE), { tipo: 'agenda', de: '2026-10-10', ate: '2026-10-20' });
  assert.deepStrictEqual(parseAcao('{"acao":"agenda","data_inicio":"2026-10-01","data_fim":"2026-12-31"}', HOJE), { tipo: 'agenda', de: '2026-10-01', ate: '2026-10-31' });
});

test('parseAcao: JSON quebrado ou ação desconhecida → null', () => {
  assert.strictEqual(parseAcao('não sei', HOJE), null);
  assert.strictEqual(parseAcao('{"acao":"apagar_tudo"}', HOJE), null);
});

test('parseAcao: aceita JSON dentro de bloco de código', () => {
  assert.deepStrictEqual(parseAcao('```json\n{"acao":"responder","texto":"Oi!"}\n```', HOJE), { tipo: 'responder', texto: 'Oi!' });
});

test('leitura de documento: boleto e comprovante', () => {
  const b = parseLeituraDocumento('{"tipo":"boleto","beneficiario":"EDP ESPIRITO SANTO","valor":"R$ 1.312,40","vencimento":"15/10/2026","linha_digitavel":"8364 0000"}');
  assert.deepStrictEqual(b, { tipo: 'boleto', descricao: null, beneficiario: 'EDP ESPIRITO SANTO', valor: 1312.4, vencimento: '2026-10-15', data_pagamento: null, linha_digitavel: '8364 0000', destinatario_nome: null, destinatario_chave: null });
  const c = parseLeituraDocumento('{"tipo":"comprovante","valor":"250,00","data_pagamento":"2026-10-07","destinatario_nome":"LETICIA ELIAS BARROS","destinatario_chave":"***.510.707-**"}');
  assert.strictEqual(c.tipo, 'comprovante');
  assert.strictEqual(c.valor, 250);
  assert.strictEqual(c.data_pagamento, '2026-10-07');
  assert.strictEqual(parseLeituraDocumento('lixo'), null);
});

test('destinatário do comprovante: confere com a Dra. Letícia', () => {
  assert.strictEqual(destinatarioConfere({ destinatario_nome: 'LETICIA ELIAS BARROS', destinatario_chave: null }), true);
  assert.strictEqual(destinatarioConfere({ destinatario_nome: 'Letícia E Barros', destinatario_chave: null }), true);
  assert.strictEqual(destinatarioConfere({ destinatario_nome: null, destinatario_chave: '134.510.707-23' }), true);
  assert.strictEqual(destinatarioConfere({ destinatario_nome: null, destinatario_chave: 'financeiro.advleticiabarros@gmail.com' }), true);
  assert.strictEqual(destinatarioConfere({ destinatario_nome: 'JOÃO DA SILVA', destinatario_chave: null }), false);
  assert.strictEqual(destinatarioConfere({ destinatario_nome: null, destinatario_chave: null }), null);
});

const abertos = [
  { fonte: 'contrato', id: 11, descricao: '1/5 — Honorários', valor: 250, vencimento: '2026-10-10' },
  { fonte: 'contrato', id: 12, descricao: '2/5 — Honorários', valor: 250, vencimento: '2026-11-10' },
  { fonte: 'parcela', id: 7, descricao: '1ª parcela', valor: 400, vencimento: '2026-10-05' },
];

test('casar comprovante: mesmo valor, vencimento mais próximo da data do pagamento', () => {
  assert.strictEqual(casarComprovante({ valor: 250, data: '2026-10-07' }, abertos).id, 11);
  assert.strictEqual(casarComprovante({ valor: 250, data: '2026-11-08' }, abertos).id, 12);
  assert.strictEqual(casarComprovante({ valor: 400.004, data: '2026-10-07' }, abertos).id, 7);
  assert.strictEqual(casarComprovante({ valor: 300, data: '2026-10-07' }, abertos), null);
  assert.strictEqual(casarComprovante({ valor: null, data: '2026-10-07' }, abertos), null);
});

test('texto de confirmação mostra tudo o que será gravado', () => {
  const t = textoConfirmacao({ tipo: 'conta_pagar', descricao: 'Conta de luz', valor: 312.4, data: '2026-10-15', categoria: 'moradia', escopo: 'pessoal', codigo: null });
  assert.match(t, /Contas a Pagar/);
  assert.match(t, /R\$ 312,40/);
  assert.match(t, /15\/10\/2026/);
  assert.match(t, /Moradia/);
  assert.match(t, /pessoal/i);
  assert.match(t, /\*sim\*.*\*não\*/);
  const g = textoConfirmacao({ tipo: 'gasto', descricao: 'Uber', valor: 38.5, data: '2026-10-08', categoria: 'transporte', escopo: 'empresa', codigo: null });
  assert.match(g, /gasto/i);
  assert.match(g, /escritório/i);
});

test('agenda formatada por dia; vazio diz que não há nada', () => {
  const t = formatarAgenda([
    { data: '2026-10-09', hora: '14:00', tipo: 'audiencia', titulo: 'Audiência Mailza', local: '3ª Vara do Trabalho' },
    { data: '2026-10-09', hora: null, tipo: 'prazo', titulo: 'Contestação — proc. 123', local: null },
  ], '2026-10-09', '2026-10-09');
  assert.match(t, /09\/10/);
  assert.match(t, /14:00.*Audiência Mailza/);
  assert.match(t, /3ª Vara do Trabalho/);
  assert.match(t, /Contestação/);
  assert.match(formatarAgenda([], '2026-10-09', '2026-10-09'), /nada/i);
});

test('processos formatados com número, área e fase; vazio sugere conferir o nome', () => {
  const t = formatarProcessos([{ cliente: 'MAILZA DOS SANTOS COSTA', numero: '0000123-45.2026.5.17.0001', area: 'trabalhista', fase: 'inicial', status: 'ativo', titulo: 'Reclamação trabalhista', tribunal: 'TRT17' }], 'Mailza');
  assert.match(t, /MAILZA/);
  assert.match(t, /0000123-45\.2026\.5\.17\.0001/);
  assert.match(t, /trabalhista/i);
  assert.match(formatarProcessos([], 'Fulano'), /Não encontrei.*Fulano/);
});

test('processo: número CNJ com máscara e tribunal legível (sem "api_publica_")', () => {
  const t = formatarProcessos([{ cliente: 'JOSE LOURENCO RIBEIRO', numero: '50331184220254025001', area: 'consumidor', fase: 'inicial', status: 'ativo', titulo: null, tribunal: 'api_publica_trf2' }], '5033118');
  assert.match(t, /5033118-42\.2025\.4\.02\.5001/);
  assert.match(t, /TRF2/);
  assert.doesNotMatch(t, /api_publica/);
});

test('processo: cliente cadastrado sem processo não parece "nome errado"', () => {
  const t = formatarProcessos([{ cliente: 'MAILZA DOS SANTOS COSTA', numero: null, area: null, fase: null, status: null, titulo: null, tribunal: null }], 'Mailza');
  assert.match(t, /MAILZA/);
  assert.match(t, /nenhum processo cadastrado/i);
  assert.doesNotMatch(t, /Não encontrei/);
});
