// Novo contrato padrão da área trabalhista (07/10/2026): "Esse será nosso novo
// contrato". Substitui, para Reclamação Trabalhista (e gestante, que também é
// Justiça do Trabalho), a minuta genérica de 14 cláusulas — sai a multa de 20%
// do valor da causa por falta à audiência e a vedação absoluta de a cliente
// negociar; entram limite ao 1º grau, êxito sobre o proveito bruto, sucumbência
// sem abatimento, retenção com prestação de contas e rescisão pela Lei 8.906/94.
import { test } from 'node:test';
import assert from 'node:assert';
import { buildTemplate, reaisPorExtenso } from '../dist/services/contractTemplates.js';

const fulana = {
  name: 'FULANA DE TAL SOUZA', nacionalidade: 'brasileira', cpf: '111.444.777-35',
  endereco: 'RUA DAS FLORES, nº 416, Centro, Vitória/ES, CEP 29000-000',
  email: 'cliente.teste@example.com', phone: '(27) 90000-1111',
};
const honor = { modalidades: ['exito'], values: { exito: 30 }, taxa_calculos_pct: 2 };

test('trabalhista: usa a nova minuta de 22 cláusulas', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista', value: 250, honorarios: honor });
  assert.match(t, /^CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS/);
  assert.match(t, /CLÁUSULA PRIMEIRA - DO OBJETO E DA EXTENSÃO DOS SERVIÇOS/);
  assert.match(t, /CLÁUSULA VIGÉSIMA SEGUNDA - DO FORO/);
  assert.match(t, /Reclamação Trabalhista\*\*, perante a Justiça do Trabalho competente/);
  assert.match(t, /primeiro grau de jurisdição até a prolação da sentença/);
});

test('trabalhista: sem a multa de 20% do valor da causa e sem vedação absoluta de acordo', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista', value: 250, honorarios: honor });
  assert.doesNotMatch(t, /20% \(vinte por cento\) sobre o valor atualizado da causa/);
  assert.doesNotMatch(t, /Fica expressamente vedado à CONTRATANTE negociar/);
  assert.match(t, /R\$ 100,00 \(cem reais\)\*\* a título de ressarcimento/);
});

test('trabalhista: honorários iniciais, êxito e cálculos vêm da proposta', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista', value: 250, honorarios: honor });
  assert.match(t, /Honorários iniciais:\*\* R\$ 250,00 \(duzentos e cinquenta reais\)/);
  assert.match(t, /Honorários de êxito:\*\* 30% \(trinta por cento\) sobre o proveito econômico bruto/);
  assert.match(t, /\*\*2% \(dois por cento\) sobre o valor bruto do proveito econômico efetivamente apurado\*\*/);
  assert.match(t, /4\.1\.\*\* Os honorários iniciais de R\$ 250,00 serão pagos/);
  const t2 = buildTemplate({ party: fulana, area: 'trabalhista', value: 1500, honorarios: { modalidades: ['exito'], values: { exito: 25 }, taxa_calculos_pct: 3 } });
  assert.match(t2, /R\$ 1\.500,00 \(mil e quinhentos reais\)/);
  assert.match(t2, /25% \(vinte e cinco por cento\) sobre o proveito econômico bruto/);
  assert.match(t2, /3% \(três por cento\) sobre o valor bruto/);
});

test('trabalhista: entrada não paga é descontada ao final do processo junto com os honorários (pedido de 07/10/2026)', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista', value: 250, honorarios: honor });
  assert.match(t, /4\.2\.\*\* Caso os honorários iniciais não sejam pagos na forma do item 4\.1, o valor correspondente será descontado ao final do processo, juntamente com os honorários contratuais e de êxito/);
  assert.doesNotMatch(t, /Caso as partes ajustem expressamente que o valor será descontado/);
  // só na minuta trabalhista
  assert.doesNotMatch(buildTemplate({ party: fulana, area: 'civel', value: 250 }), /descontado ao final do processo, juntamente/);
});

test('trabalhista: sem valor definido usa o padrão do escritório (R$ 250,00, 30%, 2%)', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista' });
  assert.match(t, /Honorários iniciais:\*\* R\$ 250,00/);
  assert.match(t, /Honorários de êxito:\*\* 30% \(trinta por cento\)/);
  assert.match(t, /\*\*2% \(dois por cento\)/);
});

test('trabalhista: parcelamento da proposta entra na forma de pagamento dos honorários iniciais', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista', honorarios: { ...honor, parcelamento: { total: 600, entrada: 200, parcelas: 2, valor_parcela: 200, primeiro_vencimento: '2026-11-10' } } });
  assert.match(t, /Honorários iniciais:\*\* R\$ 600,00 \(seiscentos reais\)/);
  assert.match(t, /serão pagos da seguinte forma: entrada de R\$ 200,00, e 2 parcela\(s\) mensal\(is\) de R\$ 200,00, com primeiro vencimento em 10\/11\/2026/);
});

test('trabalhista: dados bancários sem campo de conta em branco', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista', value: 250 });
  assert.doesNotMatch(t, /\[N[ºo] DA CONTA/i);
  assert.match(t, /PIX CPF:\*\* 134\.510\.707-23/);
  assert.match(t, /alteração bancária será comunicada exclusivamente pelos canais oficiais/);
});

test('trabalhista: assinaturas — contratante (com CPF) e contratada (com OAB), cada uma com linha própria', () => {
  const t = buildTemplate({ party: fulana, area: 'trabalhista', value: 250 });
  const fim = t.slice(t.indexOf('Vitória/ES, [DATA].'));
  assert.match(fim, /_{20,}\nFULANA DE TAL SOUZA\nCONTRATANTE\nCPF nº 111.444.777-35/);
  assert.match(fim, /_{20,}\nLETÍCIA ELIAS BARROS\nCONTRATADA\nOAB\/ES 39\.948/);
  assert.ok(fim.indexOf('FULANA') < fim.indexOf('LETÍCIA'), 'contratante assina primeiro');
});

test('gestante (Justiça do Trabalho) também usa a nova minuta; cível continua com a antiga', () => {
  assert.match(buildTemplate({ party: fulana, area: 'gestante', value: 250 }), /CLÁUSULA VIGÉSIMA SEGUNDA - DO FORO/);
  const civel = buildTemplate({ party: fulana, area: 'civel', value: 250 });
  assert.doesNotMatch(civel, /CLÁUSULA VIGÉSIMA SEGUNDA/);
  assert.match(civel, /CLÁUSULA DÉCIMA QUARTA - DO FORO DE ELEIÇÃO/);
});

test('reaisPorExtenso', () => {
  assert.strictEqual(reaisPorExtenso(250), 'duzentos e cinquenta reais');
  assert.strictEqual(reaisPorExtenso(100), 'cem reais');
  assert.strictEqual(reaisPorExtenso(1), 'um real');
  assert.strictEqual(reaisPorExtenso(1500), 'mil e quinhentos reais');
  assert.strictEqual(reaisPorExtenso(2350.5), 'dois mil, trezentos e cinquenta reais e cinquenta centavos');
  assert.strictEqual(reaisPorExtenso(1000000), 'um milhão de reais');
  assert.strictEqual(reaisPorExtenso(0.99), 'noventa e nove centavos');
});
