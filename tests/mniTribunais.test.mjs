// Ligação oficial com os tribunais (MNI) — pedido da Dra. em 17/11/2026.
// Formatos de resposta abaixo seguem o esqueleto real (sem dados pessoais)
// colhido no PJe do TJES (1º grau) e no eproc da JFES. Todos os nomes, CPFs e
// números aqui são FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mni-'));
execSync(`npx tsc src/services/mni/cliente.ts src/services/mni/sistemas.ts src/services/mni/monitorMni.ts src/services/mni/nomesMovimento.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const imp = async (f) => (await import(pathToFileURL(path.join(out, f)).href)).default;
const cli = await imp('cliente.js');
const sis = await imp('sistemas.js');
const mon = await imp('monitorMni.js');
const nomes = await imp('nomesMovimento.js');

const envelope = (corpo) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${corpo}</soap:Body></soap:Envelope>`;

const XML_AVISOS_EPROC = envelope(`<ns2:consultarAvisosPendentesResposta xmlns:ns2="x" xmlns:ns3="y">
  <ns3:sucesso>true</ns3:sucesso><ns3:mensagem>Consulta realizada com sucesso</ns3:mensagem>
  <ns3:aviso idAviso="711111111111111" tipoComunicacao="INT">
    <ns2:destinatario><ns2:pessoa nome="ADVOGADA FICTICIA" numeroDocumentoPrincipal="00000000000" tipoPessoa="fisica"/></ns2:destinatario>
    <ns2:processo numero="50012345620264025001" competencia="11" classeProcessual="436" nivelSigilo="0">
      <ns2:polo polo="AT"><ns2:parte assistenciaJudiciaria="false"><ns2:pessoa nome="CLIENTE FICTICIO"/></ns2:parte></ns2:polo>
      <ns2:outroParametro nome="xxxx" valor="1"/>
      <ns2:orgaoJulgador codigoOrgao="ES000001" nomeOrgao="Juizo A do 1o Nucleo de JEF" instancia="ORIG" codigoMunicipioIBGE="3205309"/>
    </ns2:processo>
    <ns2:dataDisponibilizacao>20261110153000</ns2:dataDisponibilizacao>
  </ns3:aviso>
  <ns3:aviso idAviso="722222222222222" tipoComunicacao="CIT">
    <ns2:processo numero="50099999920264025002"><ns2:orgaoJulgador nomeOrgao="Vara Federal &amp; Turma"/></ns2:processo>
    <ns2:dataDisponibilizacao>20261112090000</ns2:dataDisponibilizacao>
  </ns3:aviso>
</ns2:consultarAvisosPendentesResposta>`);

const XML_PROCESSO_PJE = envelope(`<ns2:consultarProcessoResposta xmlns:ns2="x">
  <sucesso>true</sucesso><mensagem>Processo consultado com sucesso</mensagem>
  <processo>
    <dadosBasicos numero="00012345620268080024" competencia="99" classeProcessual="7">
      <polo polo="AT"><parte><pessoa nome="CLIENTE FICTICIO"/></parte></polo>
      <orgaoJulgador codigoOrgao="123" nomeOrgao="Vitoria - 1a Vara Civel" instancia="ORIG"/>
    </dadosBasicos>
    <movimento dataHora="20261105101500" identificadorMovimento="11111111">
      <movimentoNacional codigoNacional="85"><complemento>tipo_de_peticao: Peticao (outras)</complemento></movimentoNacional>
      <idDocumentoVinculado>123456789</idDocumentoVinculado>
    </movimento>
    <movimento dataHora="20261106120000" identificadorMovimento="11111112">
      <movimentoNacional codigoNacional="11010"><complemento>Mero expediente</complemento></movimentoNacional>
    </movimento>
  </processo>
</ns2:consultarProcessoResposta>`);

const XML_PROCESSO_EPROC = envelope(`<ns2:consultarProcessoResposta xmlns:ns2="x">
  <sucesso>true</sucesso><mensagem>Consulta realizada com sucesso</mensagem>
  <processo>
    <dadosBasicos numero="50012345620264025001"><orgaoJulgador nomeOrgao="Juizo A do 1o Nucleo de JEF"/></dadosBasicos>
    <movimento dataHora="20261110153000" identificadorMovimento="24">
      <complemento>Refer. ao Evento 20 - 10/11/2026</complemento>
      <complemento>Prazo: 15 dias</complemento>
      <movimentoLocal codigoMovimento="123456789" codigoPaiNacional="12265" descricao="Expedida/certificada a intimacao eletronica"/>
    </movimento>
  </processo>
</ns2:consultarProcessoResposta>`);

// ── segurança: só leitura ───────────────────────────────────────────────────

test('o cliente MNI não tem nenhuma operação que dê ciência ou protocole', () => {
  const codigo = fs.readFileSync('src/services/mni/cliente.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // ignora comentários
  for (const proibida of ['consultarTeorComunicacao', 'confirmarRecebimento', 'entregarManifestacaoProcessual']) {
    assert.ok(!codigo.includes(proibida), `cliente MNI não pode usar ${proibida}`);
  }
  // E nenhum outro arquivo do módulo chama essas operações.
  for (const f of fs.readdirSync('src/services/mni')) {
    const c = fs.readFileSync(path.join('src/services/mni', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/ser:(consultarTeorComunicacao|confirmarRecebimento|entregarManifestacaoProcessual)/.test(c), f);
  }
});

test('consultarProcesso pede movimentos SEM documentos e envia só as duas operações conhecidas', async () => {
  const enviados = [];
  const fakeFetch = async (_url, init) => { enviados.push(init.body); return { status: 200, text: async () => XML_PROCESSO_PJE }; };
  const c = cli.criarClienteMni({ url: 'https://exemplo/intercomunicacao', fetch: fakeFetch });
  await c.consultarProcesso({ cpf: '000.000.000-00', senha: 's<e>&"' }, '0001234-56.2026.8.08.0024');
  assert.match(enviados[0], /<ser:consultarProcesso>/);
  assert.match(enviados[0], /<tip:incluirDocumentos>false<\/tip:incluirDocumentos>/);
  assert.match(enviados[0], /<tip:numeroProcesso>00012345620268080024<\/tip:numeroProcesso>/);
  assert.match(enviados[0], /<tip:idConsultante>00000000000<\/tip:idConsultante>/);
  assert.match(enviados[0], /<tip:senhaConsultante>s&lt;e&gt;&amp;&quot;<\/tip:senhaConsultante>/, 'senha escapada no XML');
});

// ── leitura das respostas reais ─────────────────────────────────────────────

test('avisos do eproc: id, tipo, número, órgão e data de disponibilização', () => {
  const avisos = cli.lerAvisos(XML_AVISOS_EPROC);
  assert.equal(avisos.length, 2);
  assert.deepEqual(avisos[0], {
    idAviso: '711111111111111', tipoComunicacao: 'INT', numeroProcesso: '50012345620264025001',
    orgaoJulgador: 'Juizo A do 1o Nucleo de JEF', disponibilizadoEm: '2026-11-10T15:30:00',
  });
  assert.equal(avisos[1].orgaoJulgador, 'Vara Federal & Turma');
  assert.equal(avisos[1].tipoComunicacao, 'CIT');
});

test('processo do PJe: código nacional + complemento (sem nome por extenso)', () => {
  const p = cli.lerProcesso(XML_PROCESSO_PJE);
  assert.equal(p.numero, '00012345620268080024');
  assert.equal(p.orgaoJulgador, 'Vitoria - 1a Vara Civel');
  assert.equal(p.movimentos.length, 2);
  assert.deepEqual(p.movimentos[0], {
    dataHora: '2026-11-05T10:15:00', identificador: '11111111', codigoNacional: 85, descricao: null,
    complementos: ['tipo_de_peticao: Peticao (outras)'],
  });
});

test('processo do eproc: descrição local por extenso + vários complementos', () => {
  const p = cli.lerProcesso(XML_PROCESSO_EPROC);
  assert.equal(p.movimentos.length, 1);
  assert.equal(p.movimentos[0].descricao, 'Expedida/certificada a intimacao eletronica');
  assert.equal(p.movimentos[0].codigoNacional, 12265);
  assert.deepEqual(p.movimentos[0].complementos, ['Refer. ao Evento 20 - 10/11/2026', 'Prazo: 15 dias']);
});

test('login recusado: as mensagens reais dos tribunais viram ErroLoginMni', () => {
  const msgs = [
    'Erro ao realizar login via MNI. exception invoking: loginFailed',
    "Erro ao realizar login via MNI. O usuário '00000000000' não está corretamente cadastrado no sistema.",
    'Erro ao realizar login via MNI. A senha foi bloqueada. Solicite uma nova senha para efetuar o desbloqueio',
    '->Falha na autenticação do usuário 00000000000 [Senha ou usuário Inválidos  ]',
  ];
  for (const m of msgs) {
    const xml = envelope(`<r><sucesso>false</sucesso><mensagem>${m.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</mensagem></r>`);
    assert.throws(() => cli.verificarResposta(xml), (e) => e.name === 'ErroLoginMni', m);
  }
  // O CPF que o tribunal repete na mensagem sai mascarado (vai para banco/sino/log).
  const xmlCpf = envelope("<r><sucesso>false</sucesso><mensagem>O usuário '12345678901' não está corretamente cadastrado no sistema.</mensagem></r>");
  assert.throws(() => cli.verificarResposta(xmlCpf), (e) => !/12345678901/.test(e.message) && /\*\*\*/.test(e.message));
  assert.equal(cli.mascararCpf('CPF 123.456.789-01 e processo 50012345620264025001'), 'CPF ***.***.***-** e processo 50012345620264025001');
  // Processo não encontrado NÃO é recusa de login.
  assert.doesNotThrow(() => cli.verificarResposta(envelope('<r><sucesso>false</sucesso><mensagem>Processo não encontrado</mensagem></r>')));
});

test('HTTP 403 (tribunal exige credenciamento) não é tratado como senha errada', async () => {
  const c = cli.criarClienteMni({ url: 'x', fetch: async () => ({ status: 403, text: async () => 'Forbidden' }) });
  await assert.rejects(() => c.avisosPendentes({ cpf: '1', senha: '2' }), (e) => e.name === 'ErroRespostaMni');
});

// ── regras ───────────────────────────────────────────────────────────────────

test('ciência automática: 10 dias corridos depois da disponibilização', () => {
  assert.equal(sis.cienciaAutomaticaEm('2026-11-10T15:30:00'), '2026-11-20');
  assert.equal(sis.cienciaAutomaticaEm('2026-12-28T00:00:00'), '2027-01-07');
  assert.equal(sis.cienciaAutomaticaEm(null), null);
});

test('cada número de processo vai para o sistema certo', () => {
  const tjes = sis.sistemaPorId('tjes_pje1g');
  const jfes = sis.sistemaPorId('eproc_jfes');
  assert.ok(tjes.atende('0001234-56.2026.8.08.0024'));
  assert.ok(!tjes.atende('5001234-56.2026.4.02.5001'));
  assert.ok(jfes.atende('5001234-56.2026.4.02.5001'));
  assert.ok(!jfes.atende('5001234-56.2026.4.02.5101'), 'JF do RJ (51xx) não é JFES');
  assert.ok(!jfes.atende('0000123-45.2026.5.17.0001'), 'TRT17 fora');
  assert.equal(sis.fonteMni('eproc_jfes'), 'mni_eproc_jfes');
});

test('nome do movimento: usa o cache e só consulta o CNJ quando falta', async () => {
  const cache = new Map([[848, 'Trânsito em julgado']]);
  const gravados = [];
  let chamadas = 0;
  const nome = nomes.criarNomesMovimento({
    lerCache: async (c) => cache.get(c) ?? null,
    gravarCache: async (c, n) => { gravados.push([c, n]); },
    fetch: async () => { chamadas++; return { status: 200, text: async () => '<x><cod_item>11010</cod_item><nome>Mero expediente</nome></x>' }; },
  });
  assert.equal(await nome(848), 'Trânsito em julgado');
  assert.equal(chamadas, 0);
  assert.equal(await nome(11010), 'Mero expediente');
  assert.equal(await nome(11010), 'Mero expediente'); // segunda vez: memória
  assert.equal(chamadas, 1);
  assert.deepEqual(gravados, [[11010, 'Mero expediente']]);
  assert.equal(await nome(null), null);
});

// ── rodada completa com dependências falsas ──────────────────────────────────

function depsFalsas({ avisos = [], processo = null, loginRecusado = false } = {}) {
  const reg = { avisos: [], erros: [], oks: [], equipe: [], gravados: [], consultas: [] };
  const deps = {
    credenciaisAtivas: async () => [{ sistema: 'eproc_jfes', cpf: '00000000000', senha: 'x' }, { sistema: 'tjes_pje1g', cpf: '00000000000', senha: 'y' }],
    cliente: (s) => ({
      avisosPendentes: async () => {
        if (loginRecusado && s.id === 'eproc_jfes') { const e = new cli.ErroLoginMni('Senha ou usuário Inválidos'); throw e; }
        return s.id === 'eproc_jfes' ? avisos : [];
      },
      consultarProcesso: async (_c, n) => { reg.consultas.push([s.id, n]); return processo ?? { numero: n, orgaoJulgador: null, movimentos: [] }; },
    }),
    nomeMovimento: async (c) => (c === 85 ? 'Petição' : null),
    processosMonitorados: async () => [
      { id: 1, process_number: '0001234-56.2026.8.08.0024' },
      { id: 2, process_number: '5001234-56.2026.4.02.5001' },
      { id: 3, process_number: '0000123-45.2026.5.17.0001' },
    ],
    garantirProcesso: async () => ({ id: 99, criado: true }),
    gravarMovimentos: async (id, n, movs, fonte) => { reg.gravados.push({ id, movs, fonte }); return movs.length; },
    registrarAvisos: async (sistema, lista) => { reg.avisos.push([sistema, lista]); return { novos: lista.length, resolvidos: 0, listaNovos: lista }; },
    marcarOk: async (s, n) => { reg.oks.push([s, n]); },
    marcarErro: async (s, m, desligar) => { reg.erros.push([s, m, desligar]); },
    avisarEquipe: async (t, m) => { reg.equipe.push([t, m]); },
  };
  return { deps, reg };
}

test('rodada: avisos novos avisam a equipe com a data da ciência automática', async () => {
  const { deps, reg } = depsFalsas({ avisos: cli.lerAvisos(XML_AVISOS_EPROC) });
  const r = await mon.rodarMonitoramentoMni(deps);
  const eproc = r.sistemas.find((s) => s.sistema === 'eproc_jfes');
  assert.equal(eproc.status, 'ok');
  assert.equal(eproc.avisosPendentes, 2);
  assert.equal(reg.avisos[0][1][0].cienciaAutomatica, '2026-11-20');
  assert.equal(reg.avisos[0][1][0].processId, 99);
  const aviso = reg.equipe.find(([t]) => t.startsWith('Intimação pendente'));
  assert.ok(aviso, 'avisa a equipe');
  assert.match(aviso[1], /5001234-56\.2026\.4\.02\.5001/);
  assert.match(aviso[1], /ciência é automática em 20\/11\/2026/);
  assert.match(aviso[1], /não abriu a intimação/);
});

test('rodada: cada sistema só consulta os processos dele (TRT17 fica de fora)', async () => {
  const { deps, reg } = depsFalsas();
  await mon.rodarMonitoramentoMni(deps);
  assert.deepEqual(reg.consultas, [['eproc_jfes', '5001234-56.2026.4.02.5001'], ['tjes_pje1g', '0001234-56.2026.8.08.0024']]);
});

test('rodada: movimento do PJe ganha o nome por extenso e grava com a fonte mni_*', async () => {
  const processo = cli.lerProcesso(XML_PROCESSO_PJE);
  const { deps, reg } = depsFalsas({ processo });
  await mon.rodarMonitoramentoMni(deps);
  const g = reg.gravados.find((x) => x.fonte === 'mni_tjes_pje1g');
  assert.equal(g.movs[0].title, 'Petição');
  assert.equal(g.movs[0].description, 'Petição — tipo_de_peticao: Peticao (outras)');
  assert.equal(g.movs[1].title, 'Movimento (código 11010)', 'sem nome no CNJ: mostra o código');
  assert.equal(g.movs[0].movement_date, '2026-11-05T10:15:00');
});

test('rodada: login recusado PARA o sistema, desliga a credencial e avisa; os outros seguem', async () => {
  const { deps, reg } = depsFalsas({ loginRecusado: true });
  const r = await mon.rodarMonitoramentoMni(deps);
  const eproc = r.sistemas.find((s) => s.sistema === 'eproc_jfes');
  assert.equal(eproc.status, 'login_recusado');
  assert.deepEqual(reg.erros[0].slice(0, 1).concat(reg.erros[0][2]), ['eproc_jfes', true], 'desliga (ativo = 0)');
  assert.ok(!reg.consultas.some(([s]) => s === 'eproc_jfes'), 'não tenta mais nada no sistema recusado');
  assert.ok(reg.equipe.some(([t]) => t.startsWith('Login recusado')));
  assert.equal(r.sistemas.find((s) => s.sistema === 'tjes_pje1g').status, 'ok', 'TJES segue normalmente');
});

test('rodada: sem login cadastrado não faz nada', async () => {
  const { deps } = depsFalsas();
  deps.credenciaisAtivas = async () => [];
  let consultou = false;
  deps.processosMonitorados = async () => { consultou = true; return []; };
  assert.deepEqual(await mon.rodarMonitoramentoMni(deps), { sistemas: [] });
  assert.equal(consultou, false);
});
