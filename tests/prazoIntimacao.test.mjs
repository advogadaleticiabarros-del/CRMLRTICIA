// Prazo de cada intimação do DJEN (pedido da Dra., 13/11/2026: "por que não
// conseguimos contar os prazos direito... com prazo correto e me dando a data
// final?"). Casos reais do relatório Égide de 13/11/2026 + casos comuns.
import { test } from 'node:test';
import assert from 'node:assert';
import { analisarPrazoIntimacao, ritoDoProcesso } from '../dist/services/prazoIntimacao.js';
import { proximoDiaUtil, diaUtilAnterior } from '../dist/utils/prazoUtil.js';

test('publicação é o 1º dia útil após a disponibilização; feriado e fim de semana pulam', () => {
  assert.strictEqual(proximoDiaUtil('2026-11-13'), '2026-11-16'); // sexta → segunda
  assert.strictEqual(proximoDiaUtil('2026-11-19'), '2026-11-23'); // 20/11 Consciência Negra
  assert.strictEqual(diaUtilAnterior('2026-11-23'), '2026-11-19');
  // No recesso a publicação acontece normalmente (só a contagem fica suspensa).
  assert.strictEqual(proximoDiaUtil('2027-01-07'), '2027-01-08');
});

test('rito: Justiça do Trabalho pelo nº do processo, Juizado pelo órgão/classe, senão CPC', () => {
  assert.strictEqual(ritoDoProcesso({ numeroProcesso: '0001868-68.2024.5.17.0003' }), 'trabalho');
  assert.strictEqual(ritoDoProcesso({ numeroProcesso: '5018345-55.2026.4.02.5001', orgao: '3º Juizado Especial de Vitória' }), 'juizado');
  assert.strictEqual(ritoDoProcesso({ numeroProcesso: '5018345-55.2026.4.02.5001', classe: 'PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL' }), 'juizado');
  assert.strictEqual(ritoDoProcesso({ numeroProcesso: '5014269-85.2026.4.02.5001', orgao: '2ª Vara Federal Cível' }), 'cpc');
  assert.strictEqual(ritoDoProcesso({ tribunal: 'TRT17' }), 'trabalho');
});

test('Valci (JEF): sentença improcedente → recurso inominado, 10 dias úteis, termo 01/12 e protocolar até 30/11', () => {
  const a = analisarPrazoIntimacao({
    numeroProcesso: '5018345-55.2026.4.02.5001', tribunal: 'TRF2',
    orgao: '3º Juizado Especial de Vitória', classe: 'PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL',
    tipo: 'Intimação', texto: 'SENTENÇA. Ante o exposto, JULGO IMPROCEDENTE o pedido. Sem custas e honorários (art. 55 da Lei 9.099/95).',
    disponibilizacao: '2026-11-13',
  });
  assert.strictEqual(a.categoria, 'prazo');
  assert.strictEqual(a.rito, 'juizado');
  assert.strictEqual(a.ato, 'Recurso inominado');
  assert.strictEqual(a.dias, 10);
  assert.strictEqual(a.publicacao, '2026-11-16');
  assert.strictEqual(a.inicioContagem, '2026-11-17');
  assert.strictEqual(a.termoFinal, '2026-12-01');
  assert.strictEqual(a.protocolarAte, '2026-11-30');
  assert.strictEqual(a.prioridade, 'alta');
  assert.match(a.explicacao, /Consci[êe]ncia Negra/);
  assert.ok(a.alertas.some((t) => /embargos de declara/i.test(t)), 'avisa dos embargos de declaração (5 dias)');
});

test('sentença na Justiça do Trabalho → recurso ordinário, 8 dias úteis', () => {
  const a = analisarPrazoIntimacao({
    numeroProcesso: '0001234-11.2025.5.17.0001', tribunal: 'TRT17', orgao: '1ª Vara do Trabalho de Vitória',
    tipo: 'Intimação', texto: 'Isto posto, julgo PARCIALMENTE PROCEDENTES os pedidos formulados.',
    disponibilizacao: '2026-11-13',
  });
  assert.strictEqual(a.ato, 'Recurso ordinário');
  assert.strictEqual(a.dias, 8);
  assert.strictEqual(a.termoFinal, '2026-11-27'); // 17,18,19,23,24,25,26,27 (20/11 feriado)
});

test('sentença na Justiça comum → apelação, 15 dias úteis', () => {
  const a = analisarPrazoIntimacao({
    numeroProcesso: '5000001-11.2026.8.08.0024', tribunal: 'TJES', orgao: '2ª Vara Cível de Vitória',
    tipo: 'Intimação', texto: 'SENTENÇA ... julgo procedente o pedido inicial.', disponibilizacao: '2026-11-13',
  });
  assert.strictEqual(a.ato, 'Apelação');
  assert.strictEqual(a.dias, 15);
});

test('Martinele (TRT17): homologação da conta de liquidação → revisão humana, sem data inventada', () => {
  const a = analisarPrazoIntimacao({
    numeroProcesso: '0001868-68.2024.5.17.0003', tribunal: 'TRT17', orgao: '3ª Vara do Trabalho de Vitória',
    classe: 'AÇÃO TRABALHISTA - RITO ORDINÁRIO', tipo: 'Intimação',
    texto: 'Homologo a conta de liquidação elaborada pelo reclamante. Intime-se a reclamada para pagamento dos honorários periciais em 48 horas. Expeçam-se alvarás aos credores.',
    disponibilizacao: '2026-11-13',
  });
  assert.strictEqual(a.categoria, 'revisao');
  assert.strictEqual(a.termoFinal, null);
  assert.strictEqual(a.protocolarAte, null);
  assert.match(a.providencia, /alvar/i);
});

test('Edivaldo (TRF2): ata de sessão de julgamento → sem prazo agora (o recurso conta do acórdão)', () => {
  const a = analisarPrazoIntimacao({
    numeroProcesso: '5014269-85.2026.4.02.5001', tribunal: 'TRF2', orgao: 'SECRETARIA DA 7ª TURMA ESPECIALIZADA',
    classe: 'APELAÇÃO CÍVEL', tipo: 'Ata de sessão de julgamento',
    texto: 'A Turma, por unanimidade, deu provimento à apelação para anular a sentença e determinar o retorno dos autos à origem.',
    disponibilizacao: '2026-11-13',
  });
  assert.strictEqual(a.categoria, 'sem_prazo');
  assert.strictEqual(a.termoFinal, null);
  assert.match(a.providencia, /ac[óo]rd[ãa]o/i);
});

test('acórdão: revista (8) no trabalho, recurso especial/extraordinário (15) no comum', () => {
  const t = analisarPrazoIntimacao({ numeroProcesso: '0000001-11.2025.5.17.0001', tipo: 'Intimação', texto: 'ACÓRDÃO. Acordam os Desembargadores da 2ª Turma...', disponibilizacao: '2026-11-13' });
  assert.strictEqual(t.ato, 'Recurso de revista');
  assert.strictEqual(t.dias, 8);
  const c = analisarPrazoIntimacao({ numeroProcesso: '5000001-11.2026.8.08.0024', tipo: 'Intimação', texto: 'ACÓRDÃO. Vistos, relatados e discutidos...', disponibilizacao: '2026-11-13' });
  assert.strictEqual(c.dias, 15);
});

test('prazo escrito na decisão vale ("no prazo de 5 (cinco) dias"), inclusive por extenso', () => {
  const a = analisarPrazoIntimacao({ numeroProcesso: '5000001-11.2026.8.08.0024', tipo: 'Intimação', texto: 'Intime-se a parte autora para, no prazo de 5 (cinco) dias, juntar o comprovante de residência.', disponibilizacao: '2026-11-13' });
  assert.strictEqual(a.categoria, 'prazo');
  assert.strictEqual(a.dias, 5);
  assert.strictEqual(a.termoFinal, '2026-11-24'); // 17,18,19,23,24
  const b = analisarPrazoIntimacao({ numeroProcesso: '5000001-11.2026.8.08.0024', tipo: 'Intimação', texto: 'Manifeste-se a autora em quinze dias sobre o laudo.', disponibilizacao: '2026-11-13' });
  assert.strictEqual(b.dias, 15);
});

test('prazo em horas → revisão humana (não dá para contar em dias úteis)', () => {
  const a = analisarPrazoIntimacao({ numeroProcesso: '5000001-11.2026.8.08.0024', tipo: 'Intimação', texto: 'Intime-se a autora para se manifestar em 48 horas.', disponibilizacao: '2026-11-13' });
  assert.strictEqual(a.categoria, 'revisao');
});

test('contrarrazões: 15 dias no comum, 8 no trabalho, 10 no Juizado', () => {
  const base = { tipo: 'Intimação', texto: 'Intime-se o recorrido para apresentar contrarrazões.', disponibilizacao: '2026-11-13' };
  assert.strictEqual(analisarPrazoIntimacao({ ...base, numeroProcesso: '5000001-11.2026.8.08.0024' }).dias, 15);
  assert.strictEqual(analisarPrazoIntimacao({ ...base, numeroProcesso: '0000001-11.2025.5.17.0001' }).dias, 8);
  assert.strictEqual(analisarPrazoIntimacao({ ...base, numeroProcesso: '5018345-55.2026.4.02.5001', orgao: 'Juizado Especial Federal' }).dias, 10);
});

test('alvará, retorno dos autos, arquivamento e ciência → sem prazo', () => {
  for (const texto of ['Expeça-se alvará em favor do autor.', 'Arquivem-se os autos.', 'Dê-se ciência às partes do retorno dos autos.']) {
    const a = analisarPrazoIntimacao({ numeroProcesso: '5000001-11.2026.8.08.0024', tipo: 'Intimação', texto, disponibilizacao: '2026-11-13' });
    assert.strictEqual(a.categoria, 'sem_prazo', texto);
  }
});

test('texto que não permite saber o prazo → revisão humana, com o motivo', () => {
  const a = analisarPrazoIntimacao({ numeroProcesso: '5000001-11.2026.8.08.0024', tipo: 'Intimação', texto: 'Vistos. Intime-se.', disponibilizacao: '2026-11-13' });
  assert.strictEqual(a.categoria, 'revisao');
  assert.strictEqual(a.termoFinal, null);
  assert.match(a.explicacao, /recorte|inteiro teor/i);
});

test('recesso (20/12 a 20/01) suspende a contagem', () => {
  const a = analisarPrazoIntimacao({ numeroProcesso: '5000001-11.2026.8.08.0024', tipo: 'Intimação', texto: 'SENTENÇA. Julgo improcedente.', disponibilizacao: '2026-12-17' });
  // publicação 18/12; 19/12 é sábado e de 20/12 a 20/01 está suspenso → 1º dia 21/01/2027
  assert.strictEqual(a.publicacao, '2026-12-18');
  assert.strictEqual(a.inicioContagem, '2027-01-21');
});
