// Central de andamentos, ação nova contra cliente e audiência na agenda — 17/11/2026.
// Nomes e números são FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extrairAudiencia, maisUmaHora, tituloAudiencia } from '../dist/services/audienciaDetectada.js';
import { tipoDoAndamento, nomeDaFonte } from '../dist/services/centralAndamentos.js';
import { normalizarNome, nomeBuscavel, filtrarAchados, formatarCnj } from '../dist/services/acoesNovasClientes.js';

const AGORA = new Date('2026-11-17T15:00:00Z');

// ── audiência ────────────────────────────────────────────────────────────────

test('audiência: data com hora "às 14h00", tipo e virtual', () => {
  const a = extrairAudiencia('Designo audiência de conciliação para o dia 10/12/2026, às 14h00, por videoconferência. Link: https://meet.exemplo.jus.br/sala-1', AGORA);
  assert.deepEqual(a, { inicio: '2026-12-10T14:00', tipo: 'conciliação', virtual: true, link: 'https://meet.exemplo.jus.br/sala-1' });
});

test('audiência: formatos "13:30", "9h" e data por extenso', () => {
  assert.equal(extrairAudiencia('Fica designada audiência UNA para 05/02/2027 13:30.', AGORA).inicio, '2027-02-05T13:30');
  assert.equal(extrairAudiencia('Audiência de instrução designada para 03.03.2027 às 9h', AGORA).inicio, '2027-03-03T09:00');
  const ext = extrairAudiencia('Redesigno a audiência de instrução e julgamento para 15 de janeiro de 2027, às 10h30.', AGORA);
  assert.equal(ext.inicio, '2027-01-15T10:30');
  assert.equal(ext.tipo, 'instrução');
  assert.equal(ext.virtual, false);
});

test('audiência: não lança sem hora, com data passada, realizada ou cancelada', () => {
  assert.equal(extrairAudiencia('Designo audiência de conciliação para 10/12/2026.', AGORA), null, 'sem hora');
  assert.equal(extrairAudiencia('Designada audiência para 10/10/2026 às 14h.', AGORA), null, 'data passada');
  assert.equal(extrairAudiencia('Audiência realizada em 10/12/2026 às 14h00, sem acordo.', AGORA), null, 'realizada');
  assert.equal(extrairAudiencia('Audiência designada para 10/12/2026 às 14h foi cancelada.', AGORA), null, 'cancelada');
  assert.equal(extrairAudiencia('Juntada de petição em 10/12/2026 às 14h.', AGORA), null, 'não é audiência');
  assert.equal(extrairAudiencia('', AGORA), null);
});

test('audiência: título e fim uma hora depois', () => {
  const a = { inicio: '2026-12-10T14:00', tipo: 'conciliação', virtual: true, link: null };
  assert.equal(tituloAudiencia(a, 'Cliente Exemplo', '0001'), 'Audiência de conciliação (virtual) — Cliente Exemplo');
  assert.equal(tituloAudiencia({ ...a, tipo: null, virtual: false }, null, '0001'), 'Audiência — 0001');
  assert.equal(maisUmaHora('2026-12-10T14:30'), '2026-12-10T15:30');
  assert.equal(maisUmaHora('2026-12-10T23:30'), '2026-12-10T23:59');
});

test('audiência é ligada nos dois pontos onde uma movimentação nova é gravada', () => {
  const src = fs.readFileSync('src/services/monitoringService.ts', 'utf8');
  assert.equal((src.match(/registrarAudienciaSeHouver\(/g) || []).length, 2);
});

// ── central ──────────────────────────────────────────────────────────────────

test('tipo do andamento: IA manda; senão título; senão texto', () => {
  assert.equal(tipoDoAndamento('Qualquer', '', 'sentenca'), 'Sentença');
  assert.equal(tipoDoAndamento('Trânsito em julgado', ''), 'Trânsito em julgado');
  assert.equal(tipoDoAndamento('Mero expediente', ''), 'Despacho');
  assert.equal(tipoDoAndamento('Publicação', 'ACORDAM os magistrados...'), 'Acórdão');
  assert.equal(tipoDoAndamento('Intimação', 'Julgo procedente o pedido'), 'Intimação', 'título pesa mais que o texto');
  assert.equal(tipoDoAndamento('Conclusos para despacho', ''), 'Despacho');
  assert.equal(tipoDoAndamento('Remessa', 'Remetidos os autos'), 'Andamento');
});

test('nome da fonte', () => {
  assert.equal(nomeDaFonte('mni_tjes_pje1g'), 'PJe TJES');
  assert.equal(nomeDaFonte('mni_eproc_jfes'), 'eproc JFES');
  assert.equal(nomeDaFonte('djen_oab'), 'DJEN');
  assert.equal(nomeDaFonte('api_publica_tjes'), 'DataJud');
  assert.equal(nomeDaFonte('email_monitoramento'), 'E-mail');
});

// ── ação nova contra cliente ─────────────────────────────────────────────────

test('nome pesquisável: 2+ palavras de verdade, sem segredo de justiça nem iniciais', () => {
  assert.ok(nomeBuscavel('Maria Exemplo da Silva'));
  assert.ok(!nomeBuscavel('Maria'));
  assert.ok(!nomeBuscavel('EM SEGREDO DE JUSTIÇA'));
  assert.ok(!nomeBuscavel('E. S. D. J.'));
  assert.ok(!nomeBuscavel('B. F. S. C.'));
  assert.equal(normalizarNome('  José  Exemplo-Júnior '), 'JOSE EXEMPLO JUNIOR');
});

test('achados: só nome EXATO do cliente, só processo que o CRM não conhece, um por processo', () => {
  const conhecidos = new Set(['00000000000000000001']);
  const itens = [
    { numero_processo: '5012345-67.2026.8.08.0024', siglaTribunal: 'TJES', nomeClasse: 'Procedimento Comum', tipoComunicacao: 'Citação',
      data_disponibilizacao: '2026-11-14', texto: '<p>Cite-se</p>', destinatarios: [{ nome: 'MARIA EXEMPLO DA SILVA', polo: 'P' }, { nome: 'BANCO X', polo: 'A' }] },
    { numero_processo: '50123456720268080024', data_disponibilizacao: '2026-11-10', destinatarios: [{ nome: 'Maria Exemplo da Silva', polo: 'P' }] },
    { numero_processo: '00000000000000000001', destinatarios: [{ nome: 'MARIA EXEMPLO DA SILVA', polo: 'A' }] },
    { numero_processo: '50999999920268080024', destinatarios: [{ nome: 'MARIA EXEMPLO DA SILVA SANTOS', polo: 'P' }] },
  ];
  const a = filtrarAchados('Maria Exemplo da Silva', itens, conhecidos);
  assert.equal(a.length, 1, 'homônimo parcial e processo já conhecido ficam de fora');
  assert.equal(a[0].numero_processo, '50123456720268080024');
  assert.equal(a[0].polo, 'P');
  assert.equal(a[0].data_publicacao, '2026-11-14', 'fica a publicação mais recente');
  assert.equal(a[0].trecho, 'Cite-se');
  assert.equal(formatarCnj(a[0].numero_processo), '5012345-67.2026.8.08.0024');
});

test('a busca por nome roda no navegador (o DJEN bloqueia o servidor) e uma vez por dia', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /nomeParte=\$\{encodeURIComponent\(c\.nome\)\}/);
  assert.match(app, /setTimeout\(autoBuscaAcoesNovasDiaria/);
  assert.match(app, /r\.status === 429 \|\| r\.status === 403\) \{ bloqueado = true; break; \}/, 'para ao ser limitado pelo DJEN');
});

test('a aba "Processos monitorados" mantém a tabela de antes', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  for (const trecho of ['Parados +30 dias', 'Trazer p/ a esteira', '+ Monitorar processo', "api('/api/processes' + q)", 'revisarClientesProcessos();', 'processosDuplicados();']) {
    assert.ok(app.includes(trecho), trecho);
  }
});
