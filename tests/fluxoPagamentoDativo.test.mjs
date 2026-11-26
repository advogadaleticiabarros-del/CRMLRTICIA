// Fluxo do pagamento do dativo (pedido da Dra., 13/11/2026): "um campo para incluir
// um código quando sai uma certidão e eu protocolo... depois eles deferem (ou não) e
// aí fica aguardando sair na lista de pagamentos... só depois é que fica disponível
// para sacar". Caminho: nomeação → atuação → certidão → e-Flow (protocolo) →
// e-Docs (deferimento) → lista da Sefaz → banco (baixa).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  ETAPAS_DATIVO, LINKS_DATIVO, statusAposRegistro, resumoFluxo, validarCamposFluxo,
} from '../dist/services/fluxoPagamentoDativo.js';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

test('etapas seguem a ordem do fluxo, com indeferida como desvio', () => {
  assert.deepStrictEqual(ETAPAS_DATIVO.map((e) => e.status), [
    'nomeada', 'em_andamento', 'concluida', 'aguardando_liberacao_requerimento',
    'protocolada', 'deferida', 'a_receber', 'paga',
  ]);
  assert.match(LINKS_DATIVO.eflow, /^https:\/\/e-flow\.es\.gov\.br\/flow-definition\/38c32372/);
  assert.strictEqual(LINKS_DATIVO.edocs, 'https://edocs.es.gov.br/');
  assert.match(LINKS_DATIVO.sefaz, /sefaz\.es\.gov\.br\/obrigacoes-de-pequeno-valor-opv-dativos/);
});

test('registrar a certidão leva a "certidão emitida"; o protocolo, a "protocolada"', () => {
  assert.strictEqual(statusAposRegistro('em_andamento', { certidao_date: '2026-11-10' }), 'aguardando_liberacao_requerimento');
  assert.strictEqual(statusAposRegistro('concluida', { certidao_date: '2026-11-10', eflow_protocolo: '2026-ABC123' }), 'protocolada');
  // protocolo sem certidão registrada também avança (ela pode ter esquecido a data)
  assert.strictEqual(statusAposRegistro('nomeada', { eflow_protocolo: 'X1' }), 'protocolada');
});

test('decisão: deferido → aguardando lista; indeferido → indeferida; lista → disponível para saque', () => {
  const base = { eflow_protocolo: 'X1' };
  assert.strictEqual(statusAposRegistro('protocolada', { ...base, decisao_pagamento: 'deferido' }), 'deferida');
  assert.strictEqual(statusAposRegistro('protocolada', { ...base, decisao_pagamento: 'indeferido' }), 'indeferida');
  // reconsiderou: indeferida que passa a deferida
  assert.strictEqual(statusAposRegistro('indeferida', { ...base, decisao_pagamento: 'deferido' }), 'deferida');
  assert.strictEqual(statusAposRegistro('deferida', { ...base, decisao_pagamento: 'deferido', sefaz_lista_date: '2026-12-01' }), 'a_receber');
});

test('nunca volta etapa, nem mexe em paga ou recusada', () => {
  assert.strictEqual(statusAposRegistro('a_receber', { certidao_date: '2026-11-10' }), 'a_receber');
  assert.strictEqual(statusAposRegistro('paga', { eflow_protocolo: 'X' }), 'paga');
  assert.strictEqual(statusAposRegistro('recusada', { eflow_protocolo: 'X' }), 'recusada');
  assert.strictEqual(statusAposRegistro('em_andamento', {}), 'em_andamento');
  // campo vazio não conta como registrado
  assert.strictEqual(statusAposRegistro('concluida', { eflow_protocolo: '  ', certidao_date: '' }), 'concluida');
});

test('resumo diz a etapa atual e o próximo passo, com o link certo e os dias parados', () => {
  const r = resumoFluxo({ status: 'aguardando_liberacao_requerimento', certidao_date: '2026-11-03' }, '2026-11-13');
  assert.strictEqual(r.atual, 'aguardando_liberacao_requerimento');
  assert.strictEqual(r.posicao, 4);
  assert.match(r.proximo.acao, /e-Flow/);
  assert.strictEqual(r.proximo.link, LINKS_DATIVO.eflow);
  assert.strictEqual(r.dias_na_etapa, 10);

  const p = resumoFluxo({ status: 'protocolada', eflow_protocolo: '2026-ABC', eflow_protocolo_date: '2026-11-01' }, '2026-11-13');
  assert.match(p.proximo.acao, /e-Docs/);
  assert.strictEqual(p.proximo.link, LINKS_DATIVO.edocs);
  assert.strictEqual(p.dias_na_etapa, 12);

  assert.strictEqual(resumoFluxo({ status: 'deferida' }, '2026-11-13').proximo.link, LINKS_DATIVO.sefaz);
  assert.match(resumoFluxo({ status: 'a_receber' }, '2026-11-13').proximo.acao, /banco/i);
  assert.strictEqual(resumoFluxo({ status: 'paga' }, '2026-11-13').proximo, null);
  assert.strictEqual(resumoFluxo({ status: 'indeferida' }, '2026-11-13').posicao, 6);
});

test('validação: datas no formato do formulário, protocolo curto, decisão só deferido/indeferido', () => {
  assert.deepStrictEqual(validarCamposFluxo({ certidao_date: '2026-11-10', eflow_protocolo: ' 2026-ABC ' }),
    { ok: true, campos: { certidao_date: '2026-11-10', eflow_protocolo: '2026-ABC' } });
  assert.strictEqual(validarCamposFluxo({ certidao_date: '10/11/2026' }).ok, false);
  assert.strictEqual(validarCamposFluxo({ decisao_pagamento: 'talvez' }).ok, false);
  assert.strictEqual(validarCamposFluxo({ eflow_protocolo: 'x'.repeat(81) }).ok, false);
  // vazio apaga o campo
  assert.deepStrictEqual(validarCamposFluxo({ eflow_protocolo: '', decisao_pagamento: '' }).campos,
    { eflow_protocolo: null, decisao_pagamento: null });
  // campo fora do fluxo é ignorado
  assert.deepStrictEqual(validarCamposFluxo({ comarca: 'Vitória' }).campos, {});
});

test('migration cria as colunas e as etapas novas; rotas usam só colunas que existem', () => {
  const nome = fs.readdirSync('migrations').find((f) => /_dative_fluxo_pagamento\.sql$/.test(f));
  assert.ok(nome, 'migration do fluxo de pagamento não encontrada');
  const sql = fs.readFileSync(path.join('migrations', nome), 'utf8');
  for (const c of ['aceite_date', 'certidao_date', 'eflow_protocolo', 'eflow_protocolo_date', 'decisao_pagamento',
    'decisao_pagamento_date', 'decisao_pagamento_motivo', 'sefaz_lista_date', 'sefaz_lista_ref']) {
    assert.match(sql, new RegExp(c), c);
  }
  assert.match(sql, /'protocolada','deferida','indeferida'/);
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([path.resolve('src/routes/dative.ts')]);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

test('rota: salvar a demanda aplica o avanço do fluxo e a ficha recebe o resumo', () => {
  const src = fs.readFileSync('src/routes/dative.ts', 'utf8');
  assert.match(src, /CASE_STATUS\s*=\s*\[[^\]]*'protocolada'[^\]]*'deferida'[^\]]*'indeferida'/);
  const put = src.slice(src.indexOf("router.put('/cases/:id'"), src.indexOf("router.post('/cases/:id/reject'"));
  assert.match(put, /validarCamposFluxo/);
  assert.match(put, /statusAposRegistro/);
  assert.match(src, /resumoFluxo\(/);
  assert.match(src, /router\.get\('\/fluxo-pagamento'/);
});

test('tela: links do e-Flow, e-Docs e Sefaz no topo do Dativo, caminho na ficha e quadro na projeção', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const tela = app.slice(app.indexOf('async dativo(page)'), app.indexOf('async fases(page)'));
  assert.match(tela, /datLinksBar\(\)/);
  const barra = app.slice(app.indexOf('function datLinksBar('), app.indexOf('function datLinksBar(') + 600);
  assert.match(barra, /id="dat-links"/);
  for (const url of Object.values(LINKS_DATIVO)) assert.ok(app.includes(url), `link ausente na tela: ${url}`);
  const ficha = app.slice(app.indexOf('async function dativeCaseDetail('), app.indexOf('async function dativeHearingForm('));
  assert.match(ficha, /name="eflow_protocolo"|'eflow_protocolo'/);
  assert.match(ficha, /datFluxoHtml\(d\)/);
  assert.match(ficha, /datLigarFluxo\(form, d, id, onSave\)/);
  const caminho = app.slice(app.indexOf('function datFluxoHtml('), app.indexOf('async function dativeCaseDetail('));
  assert.match(caminho, /id="dat-fluxo"/);
  assert.match(caminho, /\/receber/);
  assert.match(caminho, /dat-copiar-protocolo/);
  const proj = app.slice(app.indexOf('async function datProjecao('), app.indexOf('async function datDemandas('));
  assert.match(proj, /\/api\/dative\/fluxo-pagamento/);
});

// Pedido da Jessica (26/11/2026): "um local para colocar o link para consulta
// direto, que sai junto com o código do protocolo" (ex.: e-docs.es.gov.br/e/CÓDIGO).
test('link de consulta do protocolo: só http/https, até 500 caracteres, vazio apaga', () => {
  const url = 'https://e-docs.es.gov.br/e/2026-509JVP';
  assert.deepStrictEqual(validarCamposFluxo({ eflow_link: `  ${url} ` }), { ok: true, campos: { eflow_link: url } });
  assert.deepStrictEqual(validarCamposFluxo({ eflow_link: '' }).campos, { eflow_link: null });
  assert.strictEqual(validarCamposFluxo({ eflow_link: 'javascript:alert(1)' }).ok, false);
  assert.strictEqual(validarCamposFluxo({ eflow_link: 'e-docs.es.gov.br/e/2026-509JVP' }).ok, false);
  assert.strictEqual(validarCamposFluxo({ eflow_link: 'https://x.br/' + 'a'.repeat(500) }).ok, false);
});

test('link de consulta: coluna própria, campo na ficha e botão de abrir no caminho do pagamento', () => {
  const mig = fs.readdirSync('migrations').find((f) => /eflow_link/i.test(f));
  assert.ok(mig, 'migration do eflow_link ausente');
  assert.match(fs.readFileSync(path.join('migrations', mig), 'utf8'), /ADD COLUMN eflow_link VARCHAR\(500\) NULL/);
  const app = fs.readFileSync('public/app.js', 'utf8');
  const ficha = app.slice(app.indexOf('async function dativeCaseDetail('), app.indexOf('async function dativeHearingForm('));
  assert.match(ficha, /'eflow_link'/);
  const caminho = app.slice(app.indexOf('function datFluxoHtml('), app.indexOf('async function dativeCaseDetail('));
  assert.match(caminho, /dat-abrir-consulta/);
  assert.match(caminho, /\^https\?:/);
});
