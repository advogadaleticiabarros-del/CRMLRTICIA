// tests/fechamentoRpvParceria.test.mjs — Fechamento de caso de parceria com RPV
// (pedido da Jessica, 13/11/2026): a Dra. saca o RPV, a parceira paga a cliente e
// manda recibo + vídeo-depoimento. O caso fica finalizado com o repasse à parceria,
// o valor da cliente, o valor da parceria e o que entra no caixa do escritório.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  calcularDivisaoRpv, conferirDivisaoRpv, situacaoFechamento, registrarFechamentoRpv, ErroFechamento,
} from '../dist/services/fechamentoRpvParceria.js';

test('divisão padrão da Infinity Law: 30% de honorários, metade para cada', () => {
  const d = calcularDivisaoRpv({ valorSacado: 10000, honorariosPercentual: 30, parceiraPercentual: 50 });
  assert.deepStrictEqual(d, {
    valorSacado: 10000, valorCliente: 7000, honorarios: 3000,
    valorParceira: 1500, valorEscritorio: 1500, valorRepasse: 8500,
  });
});

test('centavos: as partes somam exatamente o valor sacado', () => {
  const d = calcularDivisaoRpv({ valorSacado: 12887.97, honorariosPercentual: 30, parceiraPercentual: 50 });
  const soma = Math.round((d.valorCliente + d.valorParceira + d.valorEscritorio) * 100) / 100;
  assert.strictEqual(soma, 12887.97);
  assert.strictEqual(d.valorRepasse, Math.round((d.valorCliente + d.valorParceira) * 100) / 100);
  assert.strictEqual(d.valorCliente, 9021.58);
});

test('valor real pago à cliente e à parceria substitui o cálculo', () => {
  const d = calcularDivisaoRpv({ valorSacado: 10000, honorariosPercentual: 30, parceiraPercentual: 50, valorCliente: 6800, valorParceira: 1700 });
  assert.strictEqual(d.honorarios, 3200);
  assert.strictEqual(d.valorParceira, 1700);
  assert.strictEqual(d.valorEscritorio, 1500);
  assert.strictEqual(d.valorRepasse, 8500);
});

test('só a cliente informada: a parceria segue o percentual sobre os honorários', () => {
  const d = calcularDivisaoRpv({ valorSacado: 10000, honorariosPercentual: 30, parceiraPercentual: 50, valorCliente: 7200 });
  assert.strictEqual(d.honorarios, 2800);
  assert.strictEqual(d.valorParceira, 1400);
  assert.strictEqual(d.valorEscritorio, 1400);
});

test('conferência recusa valores impossíveis', () => {
  assert.ok(conferirDivisaoRpv(calcularDivisaoRpv({ valorSacado: 0, honorariosPercentual: 30, parceiraPercentual: 50 })).length);
  assert.ok(conferirDivisaoRpv(calcularDivisaoRpv({ valorSacado: 1000, honorariosPercentual: 30, parceiraPercentual: 50, valorCliente: 1200 }))
    .some((e) => /cliente/i.test(e)));
  assert.ok(conferirDivisaoRpv(calcularDivisaoRpv({ valorSacado: 1000, honorariosPercentual: 30, parceiraPercentual: 50, valorParceira: 400 }))
    .some((e) => /parceria/i.test(e)));
  assert.deepStrictEqual(conferirDivisaoRpv(calcularDivisaoRpv({ valorSacado: 1000, honorariosPercentual: 30, parceiraPercentual: 50 })), []);
});

test('situação: mostra o que falta (recibo, vídeo)', () => {
  assert.deepStrictEqual(situacaoFechamento({ recibo_document_id: null, video_document_id: null }), { completo: false, faltam: ['recibo', 'vídeo-depoimento'] });
  assert.deepStrictEqual(situacaoFechamento({ recibo_document_id: 5, video_document_id: null }), { completo: false, faltam: ['vídeo-depoimento'] });
  assert.deepStrictEqual(situacaoFechamento({ recibo_document_id: 5, video_document_id: 6 }), { completo: true, faltam: [] });
});

// ── Orquestração com banco falso ────────────────────────────────────────────
function repoFalso({ caso, fechamento = null, pendentes = { receitaId: null, repasseId: null } } = {}) {
  const chamadas = { receitas: [], repasses: [], fechamentos: [], encerrar: [], linha: [] };
  let seq = 100;
  return {
    chamadas,
    buscarCaso: async () => caso,
    buscarFechamento: async () => fechamento,
    buscarPendentesDoResultado: async () => pendentes,
    salvarReceita: async (r) => { chamadas.receitas.push(r); return r.id ?? ++seq; },
    salvarRepasse: async (r) => { chamadas.repasses.push(r); return r.id ?? ++seq; },
    salvarFechamento: async (f) => { chamadas.fechamentos.push(f); return f.id ?? ++seq; },
    encerrarCaso: async (e) => { chamadas.encerrar.push(e); },
    registrarLinhaDoTempo: async (l) => { chamadas.linha.push(l); },
  };
}
const CASO = {
  id: 7, client_id: 3, client_name: 'Maria Teste', case_number: '5000001-11.2025.4.02.5001',
  partner_id: 1, partner_name: 'Parceira Teste', success_fee_percent: 30, partner_split_percent: 50,
};

test('registra: receita do honorário, repasse da parceria, fechamento e caso encerrado', async () => {
  const repo = repoFalso({ caso: CASO });
  const out = await registrarFechamentoRpv(repo, { caseId: 7, userId: 2, valorSacado: 10000, dataSaque: '2026-11-10', dataRepasse: '2026-11-11' });
  assert.strictEqual(out.divisao.valorEscritorio, 1500);
  const [rec] = repo.chamadas.receitas;
  assert.strictEqual(rec.valor, 3000);
  assert.strictEqual(rec.data, '2026-11-10');
  assert.match(rec.descricao, /5000001-11\.2025\.4\.02\.5001/);
  const [rep] = repo.chamadas.repasses;
  assert.strictEqual(rep.valor, 1500);
  assert.strictEqual(rep.parceiro, 'Parceira Teste');
  assert.strictEqual(rep.data, '2026-11-11');
  assert.match(rep.descricao, /8\.500,00/); // transferência total aparece na descrição
  const [f] = repo.chamadas.fechamentos;
  assert.strictEqual(f.valorCliente, 7000);
  assert.strictEqual(f.valorRepasse, 8500);
  assert.deepStrictEqual(repo.chamadas.encerrar, [{ caseId: 7, valorObtido: 10000, data: '2026-11-10' }]);
  assert.strictEqual(repo.chamadas.linha.length, 1);
});

test('reaproveita a receita e o repasse pendentes do "Êxito" já lançado (não duplica)', async () => {
  const repo = repoFalso({ caso: CASO, pendentes: { receitaId: 40, repasseId: 41 } });
  await registrarFechamentoRpv(repo, { caseId: 7, userId: 2, valorSacado: 10000 });
  assert.strictEqual(repo.chamadas.receitas[0].id, 40);
  assert.strictEqual(repo.chamadas.repasses[0].id, 41);
});

test('salvar de novo atualiza o mesmo fechamento e os mesmos lançamentos', async () => {
  const repo = repoFalso({ caso: CASO, fechamento: { id: 9, receita_id: 50, repasse_id: 51 } });
  await registrarFechamentoRpv(repo, { caseId: 7, userId: 2, valorSacado: 9000 });
  assert.strictEqual(repo.chamadas.receitas[0].id, 50);
  assert.strictEqual(repo.chamadas.repasses[0].id, 51);
  assert.strictEqual(repo.chamadas.fechamentos[0].id, 9);
});

test('percentuais vêm do acordo da parceria quando não informados', async () => {
  const repo = repoFalso({ caso: { ...CASO, success_fee_percent: 20, partner_split_percent: 40 } });
  const out = await registrarFechamentoRpv(repo, { caseId: 7, userId: 2, valorSacado: 10000 });
  assert.strictEqual(out.divisao.honorarios, 2000);
  assert.strictEqual(out.divisao.valorParceira, 800);
});

test('caso sem parceria ou valores inválidos: recusa sem gravar nada', async () => {
  const semParceria = repoFalso({ caso: { ...CASO, partner_id: null } });
  await assert.rejects(registrarFechamentoRpv(semParceria, { caseId: 7, userId: 2, valorSacado: 1000 }),
    (e) => e instanceof ErroFechamento && e.status === 404);
  const invalido = repoFalso({ caso: CASO });
  await assert.rejects(registrarFechamentoRpv(invalido, { caseId: 7, userId: 2, valorSacado: 1000, valorCliente: 5000 }),
    (e) => e instanceof ErroFechamento && e.status === 400);
  assert.strictEqual(invalido.chamadas.receitas.length + invalido.chamadas.fechamentos.length, 0);
});
