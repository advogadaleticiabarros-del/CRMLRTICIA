// Lista de documentos do processo pelo MNI (28/11/2026): base da baixa automática
// de prazos. Só os DADOS dos documentos (tipo, data, quem assinou), nunca o conteúdo.
// Formato conforme o XSD do MNI 2.2.2. Nomes, CPFs e números são FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mnidoc-'));
execSync(`npx tsc src/services/mni/cliente.ts src/services/mni/sistemas.ts src/services/mni/monitorMni.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const imp = async (f) => (await import(pathToFileURL(path.join(out, f)).href)).default;
const cli = await imp('cliente.js');
const mon = await imp('monitorMni.js');

const envelope = (corpo) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${corpo}</soap:Body></soap:Envelope>`;

const XML_DOCS = envelope(`<ns2:consultarProcessoResposta xmlns:ns2="x">
  <sucesso>true</sucesso><mensagem>ok</mensagem>
  <processo>
    <dadosBasicos numero="50000000020268080012"/>
    <documento idDocumento="900001" tipoDocumento="58" dataHora="20261118143000" mimetype="application/pdf" nivelSigilo="0" movimento="777001" hash="abc" descricao="Réplica" tipoDocumentoLocal="Petição">
      <conteudo>JVBERi0xLjQKU0VHUkVETw==</conteudo>
      <assinatura assinatura="AAAA" dataAssinatura="20261118142900" cadeiaCertificado="CERT">
        <signatarioLogin identificador="11122233344" dataHora="20261118142900"/>
      </assinatura>
      <outroParametro nome="nomeUsuario" valor="ADVOGADA FICTICIA"/>
      <outroParametro nome="cpfUsuario" valor="11122233344"/>
      <documentoVinculado idDocumento="900002" tipoDocumento="13" dataHora="20261118143000" descricao="Procuração">
        <conteudo>SEGREDO</conteudo>
        <assinatura><signatarioLogin identificador="11122233344"/></assinatura>
      </documentoVinculado>
    </documento>
    <documento idDocumento="900010" tipoDocumento="57" dataHora="20261120100000" descricao="Contestação" movimento="777002">
      <assinatura><signatarioLogin identificador="99988877766"/></assinatura>
    </documento>
  </processo>
</ns2:consultarProcessoResposta>`);

test('lerDocumentos: dados de cada documento, sem conteúdo nem assinatura digital', () => {
  const docs = cli.lerDocumentos(XML_DOCS, '111.222.333-44');
  assert.equal(docs.length, 3);
  const [replica, procuracao, contestacao] = docs;
  assert.equal(replica.idDocumento, '900001');
  assert.equal(replica.idMovimento, '777001');
  assert.equal(replica.dataHora, '2026-11-18T14:30:00');
  assert.equal(replica.tipo, '58');
  assert.equal(replica.tipoLocal, 'Petição');
  assert.equal(replica.descricao, 'Réplica');
  assert.equal(replica.assinadoPeloLogin, true, 'assinada com o CPF do login da Dra.');
  assert.equal(procuracao.idVinculadoA, '900001');
  assert.equal(procuracao.descricao, 'Procuração');
  assert.equal(contestacao.assinadoPeloLogin, false);

  const tudo = JSON.stringify(docs);
  assert.ok(!tudo.includes('JVBERi0'), 'conteúdo do documento nunca é guardado');
  assert.ok(!tudo.includes('SEGREDO'));
  assert.ok(!tudo.includes('CERT') && !tudo.includes('"AAAA"'), 'assinatura digital e certificado ficam de fora');
  assert.ok(!/11122233344|99988877766/.test(tudo), 'CPF de quem assinou sai mascarado');
  assert.ok(replica.parametros.some((p) => p.nome === 'nomeUsuario' && p.valor === 'ADVOGADA FICTICIA'));
});

// Formato real do PJe do TJES (conferido em 28/11/2026): sem <assinatura>; quem
// juntou vem em outroParametro (usuarioJuntadaArquivo + CPF).
const XML_DOCS_PJE = envelope(`<r><sucesso>true</sucesso><processo><dadosBasicos numero="50000000020268080012"/>
  <documento idDocumento="700001" tipoDocumento="8170024" dataHora="20261124091400" descricao="Petição (outras)" movimento="1">
    <outroParametro nome="mni:pje:documento:usuarioJuntadaArquivo:documentoIdentificacao" valor="11122233344"/>
    <outroParametro nome="mni:pje:documento:usuarioJuntadaArquivo:tipoDocumentoIdentificacao" valor="CPF"/>
    <outroParametro nome="usuarioJuntadaArquivo" valor="ADVOGADA FICTICIA"/>
    <outroParametro nome="criadorArquivo" valor="ADVOGADA FICTICIA"/>
  </documento>
  <documento idDocumento="700002" tipoDocumento="8170024" dataHora="20261125110700" descricao="Petição (outras)">
    <outroParametro nome="mni:pje:documento:usuarioJuntadaArquivo:documentoIdentificacao" valor="99988877766"/>
    <outroParametro nome="usuarioJuntadaArquivo" valor="ADVOGADO DO BANCO"/>
  </documento>
</processo></r>`);

test('PJe do TJES: quem juntou vem nos parâmetros; reconhece a Dra. pelo CPF do login', () => {
  const [nossa, deles] = cli.lerDocumentos(XML_DOCS_PJE, '111.222.333-44');
  assert.equal(nossa.juntadoPor, 'ADVOGADA FICTICIA');
  assert.equal(nossa.assinadoPeloLogin, true, 'juntado com o CPF do login');
  assert.equal(deles.juntadoPor, 'ADVOGADO DO BANCO');
  assert.equal(deles.assinadoPeloLogin, false);
  assert.ok(!/11122233344|99988877766/.test(JSON.stringify([nossa, deles])), 'CPFs continuam mascarados');
});

test('documentosDoProcesso pede só a lista (incluirDocumentos=true), sem movimentos e sem pedir conteúdo', async () => {
  const enviados = [];
  const fakeFetch = async (_u, init) => { enviados.push(init.body); return { status: 200, text: async () => XML_DOCS }; };
  const c = cli.criarClienteMni({ url: 'https://exemplo/intercomunicacao', fetch: fakeFetch });
  const docs = await c.documentosDoProcesso({ cpf: '11122233344', senha: 'x' }, '5000000-00.2026.8.08.0012');
  assert.equal(docs.length, 3);
  assert.match(enviados[0], /<ser:consultarProcesso>/);
  assert.match(enviados[0], /<tip:incluirDocumentos>true<\/tip:incluirDocumentos>/);
  assert.match(enviados[0], /<tip:movimentos>false<\/tip:movimentos>/);
  assert.ok(!/<tip:documento>/.test(enviados[0]), 'nunca pede o conteúdo de um documento específico');
});

// ── quando ler ──────────────────────────────────────────────────────────────

const mov = (dataHora, codigoNacional) => ({ dataHora, identificador: null, codigoNacional, descricao: null, complementos: [] });

test('precisaLerDocumentos: só com petição nos últimos 30 dias e mais nova que a última leitura', () => {
  const hoje = '2026-11-28';
  assert.equal(mon.precisaLerDocumentos([mov('2026-11-25T10:00:00', 85)], null, hoje), '2026-11-25T10:00:00');
  assert.equal(mon.precisaLerDocumentos([mov('2026-11-25T10:00:00', 85)], '2026-11-25T10:00:00', hoje), null, 'já lida');
  assert.equal(mon.precisaLerDocumentos([mov('2026-10-01T10:00:00', 85)], null, hoje), null, 'antiga demais');
  assert.equal(mon.precisaLerDocumentos([mov('2026-11-25T10:00:00', 11010)], null, hoje), null, 'não é petição');
  assert.equal(mon.precisaLerDocumentos([mov('2026-11-20T10:00:00', 85), mov('2026-11-26T09:00:00', 85)], '2026-11-21T00:00:00', hoje), '2026-11-26T09:00:00');
});

// ── na rodada ───────────────────────────────────────────────────────────────

const XML_PROC = (n, data) => envelope(`<r><sucesso>true</sucesso><processo><dadosBasicos numero="${n}"/>
  <movimento dataHora="${data}" identificadorMovimento="1"><movimentoNacional codigoNacional="85"/></movimento></processo></r>`);

function depsFake({ processos, ultima = {}, falharDocsEm = null }) {
  const guardados = [];
  const marcas = [];
  const fakeCli = {
    async avisosPendentes() { return []; },
    async consultarProcesso(_c, n) { return cli.lerProcesso(XML_PROC(n.replace(/\D/g, ''), '20261125100000')); },
    async documentosDoProcesso(_c, n) {
      if (falharDocsEm && n.includes(falharDocsEm)) throw new Error('tribunal fora do ar');
      return cli.lerDocumentos(XML_DOCS, '11122233344');
    },
  };
  return {
    guardados, marcas,
    deps: {
      async credenciaisAtivas() { return [{ sistema: 'tjes_pje1g', cpf: '11122233344', senha: 'x' }]; },
      cliente: () => fakeCli,
      async nomeMovimento() { return 'Petição'; },
      async processosMonitorados() { return processos; },
      async garantirProcesso() { return { id: 0, criado: false }; },
      async gravarMovimentos() { return 0; },
      async registrarAvisos() { return { novos: 0, resolvidos: 0, listaNovos: [] }; },
      async marcarOk() {}, async marcarErro() {}, async avisarEquipe() {},
      async documentosLidosAte(pid) { return ultima[pid] ?? null; },
      async guardarDocumentos(pid, sistema, docs, ate) { guardados.push({ pid, sistema, n: docs.length }); marcas.push({ pid, ate }); return docs.length; },
      hoje: () => '2026-11-28',
    },
  };
}

test('rodada: lê os documentos dos processos com petição recente e marca até onde leu', async () => {
  const { deps, guardados, marcas } = depsFake({
    processos: [{ id: 1, process_number: '5000000-00.2026.8.08.0012' }, { id: 2, process_number: '5000001-00.2026.8.08.0012' }],
    ultima: { 2: '2026-11-25T10:00:00' },
  });
  const r = await mon.rodarMonitoramentoMni(deps);
  assert.deepEqual(guardados, [{ pid: 1, sistema: 'tjes_pje1g', n: 3 }], 'o processo 2 já tinha sido lido');
  assert.deepEqual(marcas, [{ pid: 1, ate: '2026-11-25T10:00:00' }]);
  assert.equal(r.sistemas[0].documentosLidos, 3);
});

test('rodada: no máximo 15 processos por rodada e falha nos documentos não derruba a rodada', async () => {
  const processos = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, process_number: `50000${String(i).padStart(2, '0')}-00.2026.8.08.0012` }));
  const { deps, guardados } = depsFake({ processos, falharDocsEm: '5000000' });
  const r = await mon.rodarMonitoramentoMni(deps);
  assert.equal(r.sistemas[0].status, 'ok');
  assert.equal(guardados.length, 14, '15 tentativas, 1 falhou');
  assert.ok(!guardados.some((g) => g.pid === 1));
});

test('rodada: cliente sem lista de documentos (ex.: robô do PJe-JT) segue como antes', async () => {
  const { deps, guardados } = depsFake({ processos: [{ id: 1, process_number: '5000000-00.2026.8.08.0012' }] });
  const base = deps.cliente();
  deps.cliente = () => ({ avisosPendentes: base.avisosPendentes, consultarProcesso: base.consultarProcesso });
  const r = await mon.rodarMonitoramentoMni(deps);
  assert.equal(r.sistemas[0].status, 'ok');
  assert.equal(guardados.length, 0);
});
