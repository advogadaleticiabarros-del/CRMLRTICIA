// tests/visaoCliente.test.mjs — visão completa do cliente (busca na página inicial)
import { test } from 'node:test';
import assert from 'node:assert';
import { relacoes, resumoFinanceiro, alertas, linhaDoTempo, termoDeBusca, processosDaBase } from '../dist/services/visaoCliente.js';

test('relacoes: dativo, parceria e próprio ao mesmo tempo; dativo recusado não conta', () => {
  const r = relacoes({
    dativos: [{ id: 1, case_id: 10, comarca: 'Vitória', status: 'em_andamento' }, { id: 2, case_id: null, comarca: 'Serra', status: 'recusada' }],
    casos: [{ id: 10 }, { id: 11, partner_id: 3, partner_name: 'Infinity' }, { id: 12 }],
  });
  assert.deepStrictEqual(r.map((x) => x.tipo), ['dativo', 'parceria', 'proprio']);
  assert.match(r[0].detalhe, /1 nomeação.*Vitória/);
  assert.doesNotMatch(r[0].detalhe, /Serra/);
  assert.match(r[1].detalhe, /Infinity/);
  assert.match(r[2].detalhe, /1 caso/, 'o caso 10 é do dativo, não próprio');
});

test('relacoes: processo monitorado sem caso é próprio; o de parceria ou de dativo não', () => {
  const r = relacoes({
    dativos: [{ id: 1, legal_process_id: 7, status: 'em_andamento' }],
    casos: [{ id: 11, partner_id: 3, partner_name: 'Infinity' }],
    processos: [{ id: 5, case_id: null }, { id: 6, case_id: 11 }, { id: 7, case_id: null }],
  });
  assert.deepStrictEqual(r.map((x) => x.tipo), ['dativo', 'parceria', 'proprio']);
  assert.match(r[2].detalhe, /^1 processo\(s\) sem caso cadastrado/);
  assert.deepStrictEqual(relacoes({ dativos: [], casos: [], processos: [{ id: 9, case_id: null }] }).map((x) => x.tipo), ['proprio']);
});

test('relacoes: cliente sem caso nenhum não ganha rótulo', () => {
  assert.deepStrictEqual(relacoes({ dativos: [], casos: [] }), []);
  assert.strictEqual(relacoes({ isDative: 1, dativos: [], casos: [] })[0].tipo, 'dativo');
});

test('resumoFinanceiro: a receber, vencido, recebido, acordos, repasses, dativo e parceiro', () => {
  const r = resumoFinanceiro({
    parcelas: [
      { valor: 300, status: 'pago', due_date: '2026-09-10' },
      { valor: 300, status: 'pendente', due_date: '2026-10-10' },
      { valor: 300, status: 'pendente', due_date: '2026-11-10' },
      { valor: 999, status: 'cancelado', due_date: '2026-08-10' },
    ],
    receitas: [{ valor: 1000, saldo_pendente: 400, total_recebido: 600, status: 'parcial', data_vencimento: '2026-10-01' }, { valor: 50, total_recebido: 0, status: 'cancelado', data_vencimento: '2026-10-01' }],
    acordos: [{ total_agreement_value: 10000, honorarium_value: 3000, status: 'Ativo' }, { total_agreement_value: 5000, honorarium_value: 1500, status: 'Quitado' }],
    repassesCliente: [{ valor_liquido: 3500, status: 'repassado' }, { valor_liquido: 3500, status: 'pendente' }],
    pagamentosDativo: [{ value: 800, status: 'previsto' }, { value: 600, status: 'recebido' }],
    repassesParceiro: [{ valor: 200, status: 'pendente' }],
  }, '2026-10-18');
  assert.strictEqual(r.recebido, 900);
  assert.strictEqual(r.aReceber, 1000);
  assert.strictEqual(r.vencido, 700, 'a parcela de 10/10 e o saldo da receita de 01/10');
  assert.deepStrictEqual(r.acordos, { total: 15000, honorarios: 4500, ativos: 1 });
  assert.deepStrictEqual(r.repasseCliente, { pendente: 3500, repassado: 3500 });
  assert.deepStrictEqual(r.dativo, { aReceber: 800, recebido: 600 });
  assert.deepStrictEqual(r.parceiro, { pendente: 200, pago: 0 });
});

test('alertas: prazo vencido e próximo, parcela vencida, repasse pendente, audiência', () => {
  const a = alertas({
    prazos: [
      { description: 'Réplica', deadline_date: '2026-10-15', status: 'pendente' },
      { description: 'Recurso', deadline_date: '2026-10-19', status: 'pendente' },
      { description: 'Manifestação', deadline_date: '2026-10-24', status: 'pendente' },
      { description: 'Antigo', deadline_date: '2026-10-01', status: 'cumprido' },
      { description: 'Longe', deadline_date: '2026-12-01', status: 'pendente' },
    ],
    parcelas: [{ valor: 300, status: 'pendente', due_date: '2026-10-10' }],
    repassesCliente: [{ valor_liquido: 3500, status: 'pendente' }],
    audiencias: [{ titulo: 'Audiência de instrução', data: '2026-10-20 14:00:00' }],
  }, '2026-10-18');
  const textos = a.map((x) => x.texto).join(' | ');
  assert.match(textos, /Prazo vencido em 15\/10\/2026: Réplica/);
  assert.match(textos, /Prazo em 1 dia\(s\).*Recurso/);
  assert.match(textos, /Prazo em 6 dia\(s\).*Manifestação/);
  assert.doesNotMatch(textos, /Antigo|Longe/);
  assert.match(textos, /1 parcela\(s\) vencida\(s\), total R\$ 300,00/);
  assert.match(textos, /Repasse ao cliente pendente: R\$ 3\.500,00/);
  assert.match(textos, /Audiência de instrução em 2 dia\(s\)/);
  assert.strictEqual(a[0].nivel, 'urgente', 'urgentes primeiro');
});

test('linhaDoTempo: junta tudo e ordena do mais novo para o mais antigo', () => {
  const l = linhaDoTempo({
    movimentacoes: [{ data: '2026-10-01', description: 'Juntada de petição', process_number: '0001234-56.2026.5.17.0001' }],
    prazos: [{ deadline_date: '2026-10-20', description: 'Recurso', status: 'pendente' }],
    audiencias: [{ data: '2026-09-15 10:00:00', titulo: 'Audiência inicial' }],
    pagamentos: [{ data: '2026-10-05', texto: 'Parcela 1 paga: R$ 300,00' }],
    registros: [{ created_at: '2026-08-01T10:00:00Z', description: 'Cliente cadastrado' }],
  });
  assert.deepStrictEqual(l.map((x) => x.tipo), ['prazo', 'pagamento', 'movimentacao', 'audiencia', 'registro']);
  assert.strictEqual(l[2].ref, '0001234-56.2026.5.17.0001');
  assert.strictEqual(linhaDoTempo({ movimentacoes: [], prazos: [], audiencias: [], pagamentos: [], registros: [{ created_at: null, description: 'x' }] }).length, 0);
});

test('termoDeBusca: separa os dígitos para CPF, telefone e número de processo', () => {
  assert.deepStrictEqual(termoDeBusca(' 0001234-56.2026 '), { texto: '0001234-56.2026', digitos: '0001234562026' });
  assert.strictEqual(termoDeBusca('Maria').digitos, '');
});

test('processosDaBase: um item por processo, sem repetir caso e processo do mesmo número', () => {
  const r = processosDaBase({
    casos: [
      { id: 10, title: 'Reclamação trabalhista', case_number: '0001234-56.2026.5.17.0001', legal_area: 'trabalhista', status: 'ativo' },
      { id: 11, title: 'BPC/LOAS', case_number: null, legal_area: 'previdenciario', status: 'ativo' },
    ],
    processos: [
      { id: 1, case_id: 10, process_number: '0001234-56.2026.5.17.0001', court_alias: 'TRT17', judicial_area: 'trabalhista', status: 'ativo' },
      { id: 2, case_id: 11, process_number: '5000001-11.2026.4.02.5001', court_alias: 'TRF2', judicial_area: 'previdenciario', status: 'ativo' },
      { id: 3, case_id: null, process_number: '00012345620265170001', court_alias: 'TRT17', status: 'ativo' },
      { id: 4, case_id: null, process_number: '0700000-00.2025.8.08.0024', court_alias: 'TJES', judicial_area: 'civel', status: 'arquivado' },
    ],
    dativos: [
      { id: 7, case_id: null, legal_process_id: null, process_number: '0009999-00.2026.8.08.0024', area: 'familia', assunto: 'Alimentos', comarca: 'Vitória', status: 'em_andamento' },
      { id: 8, case_id: null, legal_process_id: 4, process_number: '0700000-00.2025.8.08.0024', area: 'civel', comarca: 'Vitória', status: 'em_andamento' },
    ],
  });
  assert.deepStrictEqual(r.map((x) => x.numero), [
    '0001234-56.2026.5.17.0001', '5000001-11.2026.4.02.5001', '0700000-00.2025.8.08.0024', '0009999-00.2026.8.08.0024',
  ]);
  assert.strictEqual(r[0].titulo, 'Reclamação trabalhista');
  assert.strictEqual(r[1].titulo, 'BPC/LOAS', 'o caso sem número herda o número do processo ligado a ele');
  assert.strictEqual(r[3].origem, 'dativo');
  assert.match(r[3].titulo, /Dativo.*Alimentos/);
  assert.deepStrictEqual(processosDaBase({ casos: [], processos: [], dativos: [] }), []);
});
