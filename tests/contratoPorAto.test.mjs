// tests/contratoPorAto.test.mjs — contratação por ato (13/11/2026, Jessica:
// "às vezes pego demanda de clientes por Ato, que só sai contrato para o Ato + Procuração").
import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildTemplate, buildTemplatePorAto, ehContratacaoPorAto, AVISO_USO_IA,
} from '../dist/services/contractTemplates.js';

test('ehContratacaoPorAto: proposta só com "diligência / ato isolado" é por ato', () => {
  assert.equal(ehContratacaoPorAto({ modalidades: ['diligencia'], values: { diligencia: 500 } }), true);
});

test('ehContratacaoPorAto: com êxito, fixo ou parcelamento não é por ato', () => {
  assert.equal(ehContratacaoPorAto({ modalidades: ['diligencia', 'exito'], values: { diligencia: 500, exito: 30 } }), false);
  assert.equal(ehContratacaoPorAto({ modalidades: ['diligencia'], values: { diligencia: 500 }, parcelamento: { total: 3000 } }), false);
  assert.equal(ehContratacaoPorAto({ modalidades: [] }), false);
  assert.equal(ehContratacaoPorAto(null), false);
});

test('contrato por ato: objeto restrito ao ato, valor fixo, sem êxito', () => {
  const t = buildTemplatePorAto({
    party: { name: 'Fulana Teste', cpf: '000.000.000-00' },
    ato: 'audiência de instrução no processo nº 0000000-00.2026.5.17.0001, em 20/11/2026',
    value: 600, formaPagamento: 'à vista, por Pix',
  });
  assert.match(t, /^CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS PARA ATO ESPECÍFICO/);
  assert.match(t, /audiência de instrução no processo nº 0000000-00\.2026\.5\.17\.0001/);
  assert.match(t, /R\$ 600,00 \(seiscentos reais\)/);
  assert.match(t, /à vista, por Pix/);
  assert.match(t, /Não estão incluídos nos honorários previstos neste contrato outros atos/);
  assert.doesNotMatch(t, /êxito/i);
  assert.doesNotMatch(t, /hipossufici/i);
  assert.ok(t.includes(AVISO_USO_IA));
  assert.match(t, /Fulana Teste/);
});

test('contrato por ato sem o ato informado deixa o espaço para preencher', () => {
  const t = buildTemplatePorAto({ party: { name: 'Fulana Teste' } });
  assert.match(t, /\[DESCRIÇÃO DO ATO\]/);
  assert.match(t, /\[VALOR\]/);
});

test('buildTemplate usa a minuta por ato quando pedido, em qualquer área', () => {
  for (const area of ['trabalhista', 'familia', 'civel', 'consumidor']) {
    const t = buildTemplate({ clientName: 'Fulana Teste', area, porAto: true, ato: 'protocolo de petição', value: 300 });
    assert.match(t, /PARA ATO ESPECÍFICO/, area);
    assert.match(t, /protocolo de petição/, area);
  }
});

test('buildTemplate reconhece sozinho a proposta por ato e usa o valor e a descrição dela', () => {
  const t = buildTemplate({
    clientName: 'Fulana Teste', area: 'civel',
    honorarios: { modalidades: ['diligencia'], values: { diligencia: 450, diligencia_desc: 'cópia integral dos autos no fórum' } },
  });
  assert.match(t, /PARA ATO ESPECÍFICO/);
  assert.match(t, /cópia integral dos autos no fórum/);
  assert.match(t, /R\$ 450,00/);
});

test('porAto: false força a minuta completa mesmo com proposta por ato', () => {
  const t = buildTemplate({
    clientName: 'Fulana Teste', area: 'civel', porAto: false,
    honorarios: { modalidades: ['diligencia'], values: { diligencia: 450 } },
  });
  assert.doesNotMatch(t, /PARA ATO ESPECÍFICO/);
});

test('contrato por ato usa as cláusulas do contrato geral com o mesmo texto, menos a de acordos (êxito)', () => {
  const geral = buildTemplate({ party: { name: 'Fulana Teste' }, area: 'civel', value: 600 });
  const ato = buildTemplatePorAto({ party: { name: 'Fulana Teste' }, ato: 'audiência', value: 600 });
  const corpo = (txt, titulo) => {
    const i = txt.indexOf(titulo); assert.ok(i >= 0, titulo);
    const resto = txt.slice(i + titulo.length);
    const fim = resto.search(/\n\nCLÁUSULA /);
    return resto.slice(0, fim < 0 ? undefined : fim);
  };
  for (const t of ['DO INADIMPLEMENTO', 'DAS DESPESAS JUDICIAIS E ADMINISTRATIVAS', 'DAS OBRIGAÇÕES DA CONTRATANTE',
    'DAS ALTERAÇÕES E DA RESCISÃO', 'DA CESSÃO E TRANSFERÊNCIA', 'DA EXTENSÃO DAS OBRIGAÇÕES',
    'DA POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS', 'DO TÍTULO EXECUTIVO', 'DA NÃO RESPONSABILIZAÇÃO E DOS CANAIS OFICIAIS',
    'DA NATUREZA DA OBRIGAÇÃO', 'DO COMPARECIMENTO A ATOS PROCESSUAIS', 'DO FORO DE ELEIÇÃO']) {
    assert.equal(corpo(ato, t), corpo(geral, t), t);
  }
  assert.match(geral, /VEDAÇÃO A ACORDOS DESASSISTIDOS/);
  assert.doesNotMatch(ato, /VEDAÇÃO A ACORDOS/);
});
