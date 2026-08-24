// tests/dashboardComercialFunil.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/dashboards/comercial.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { calcularFunilConversao } = await import('../dist/routes/dashboards/comercial.js');

test('calcula taxa de conversão etapa-a-etapa a partir do volume corrente', () => {
  const leadsPorStatus = [
    { status: 'triagem', total: 40 },
    { status: 'atendimento_inicial', total: 28 },
    { status: 'reuniao', total: 19 },
    { status: 'documentacao_pendente', total: 15 },
    { status: 'proposta', total: 12 },
    { status: 'proposta_em_analise', total: 8 },
    { status: 'contrato_assinado', total: 5 },
  ];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas.length, 7);
  assert.equal(r.etapas[0].status, 'triagem');
  assert.equal(r.etapas[0].volume, 40);
  assert.equal(r.etapas[0].taxa_conversao, null, 'primeira etapa não tem "anterior", taxa é null');
  assert.equal(r.etapas[1].status, 'atendimento_inicial');
  assert.equal(r.etapas[1].volume, 28);
  assert.equal(r.etapas[1].taxa_conversao, 70, '28/40 = 70.0%');
  assert.equal(r.etapas[2].taxa_conversao, 67.9, '19/28 arredondado pra 1 casa decimal');
});

test('etapa com volume anterior zero não gera divisão por zero (taxa fica null)', () => {
  const leadsPorStatus = [
    { status: 'triagem', total: 0 },
    { status: 'atendimento_inicial', total: 0 },
  ];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas[1].taxa_conversao, null);
});

test('etapa ausente do leads_por_status conta como volume 0, não quebra', () => {
  const leadsPorStatus = [{ status: 'triagem', total: 10 }];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas.length, 7);
  assert.equal(r.etapas[1].volume, 0, 'atendimento_inicial ausente vira 0');
  assert.equal(r.etapas[1].taxa_conversao, 0, '0/10 = 0%, não null (volume anterior existe e é > 0)');
});

test('separa os 4 status de desfecho do funil de etapas ativas', () => {
  const leadsPorStatus = [
    { status: 'triagem', total: 10 },
    { status: 'perdida', total: 3 },
    { status: 'fechada', total: 2 },
    { status: 'convertido', total: 1 },
    { status: 'newsletter', total: 50 },
  ];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas.length, 7, 'nenhum desfecho entra na lista de etapas ativas');
  assert.ok(!r.etapas.some((e) => ['perdida', 'fechada', 'convertido', 'newsletter'].includes(e.status)));
  assert.deepEqual(r.desfechos, { fechados: 3, perdidos: 3, newsletter: 50 }, 'fechada+convertido somam em "fechados"');
});

test('desfechos ausentes do leads_por_status contam como 0, não undefined', () => {
  const leadsPorStatus = [{ status: 'triagem', total: 10 }];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.deepEqual(r.desfechos, { fechados: 0, perdidos: 0, newsletter: 0 });
});
