// tests/loteProducao.test.mjs — card único do cliente na produção (pedido da Jessica, 30/10/2026):
// "tudo centralizado em um único card... documentos renomeados e as peças prontas
// para que eu revise e protocole um a um". Regra: uma peça por banco (réu); RMC e
// RCC do mesmo banco podem ir juntos. Cenário espelha o caso real (6 bancos), com
// dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert';
import { classificarDocumento, nomeNoKit, montarLote, etapaDoLote, mencionaBanco, agruparQuadro } from '../dist/services/loteProducao.js';
import { retirarSenhaInss } from '../dist/services/senhaInssCliente.js';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const doc = (id, name, content = null, extra = {}) => ({ id, case_id: 1, name, type: 'anexo', mime: null, content, has_data: true, file_url: null, versao_de: null, final_em: null, created_at: '2026-10-21', ...extra });
const acao = (id, titulo, etapa = 'em_analise', extra = {}) => ({ id, titulo, production_stage: etapa, case_number: null, legal_area: 'consumidor', partes: [], ...extra });

test('SQL do card do cliente não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(['src/services/loteProducaoMysql.ts', 'src/routes/lote.ts']);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

test('classifica pelo conteúdo lido antes do nome: "EXTRATO_DE_EMPRESTIMO" que é histórico de créditos', () => {
  const c = classificarDocumento(doc(1, 'EXTRATO_DE_EMPRESTIMO_CONSIGNADO_FULANO.pdf',
    '[Extraído por IA de "EXTRATO_DE_EMPRESTIMO_CONSIGNADO_FULANO.pdf"]\n**Tipo do documento:**\n*   Histórico de Créditos do Instituto Nacional do Seguro Social (INSS).'));
  assert.strictEqual(c.tipo, 'historico_creditos');
  assert.strictEqual(c.escopo, 'comum');
});

test('reconhece o extrato de empréstimos do INSS (HISCON), procuração, declaração e RG pelo nome', () => {
  assert.strictEqual(classificarDocumento(doc(1, 'extrato_emprestimo_consignado_completo_301025.pdf')).tipo, 'extrato_emprestimos');
  assert.strictEqual(classificarDocumento(doc(1, 'Extrato', 'Tipo do documento: Extrato de Empréstimos Consignados — HISCON')).tipo, 'extrato_emprestimos');
  assert.strictEqual(classificarDocumento(doc(1, 'PROCURAÇAO_LETICIA_DO_FULANO.pdf')).tipo, 'procuracao');
  assert.strictEqual(classificarDocumento(doc(1, 'DECLARAÇAO_DE_HIPOSSUFICIENCIA_FULANO.pdf')).tipo, 'declaracao_hipossuficiencia');
  assert.strictEqual(classificarDocumento(doc(1, 'RG .pdf')).tipo, 'identidade');
  assert.strictEqual(classificarDocumento(doc(1, 'historico-creditos (25).pdf')).tipo, 'historico_creditos');
  assert.strictEqual(classificarDocumento(doc(1, 'conta de luz.jpg')).tipo, 'comprovante_residencia');
});

test('peça, dossiê, revisão e análise são internos; a planilha vai para o kit da ação', () => {
  assert.strictEqual(classificarDocumento(doc(1, 'Petição Inicial — Fulano (v2)', 'x', { type: 'ia' })).tipo, 'peticao');
  assert.strictEqual(classificarDocumento(doc(1, 'Dossiê da peça — Fulano (v2)', 'x', { type: 'ia' })).escopo, 'interno');
  assert.strictEqual(classificarDocumento(doc(1, 'Revisão da Petição — Petição Inicial — Fulano (v1) (IA)', 'x', { type: 'ia' })).escopo, 'interno');
  assert.strictEqual(classificarDocumento(doc(1, 'Análise do caso (checklist) — Fulano', 'x', { type: 'ia' })).escopo, 'interno');
  const p = classificarDocumento(doc(1, 'Planilha de cálculos — Fulano (v1)', 'x', { type: 'ia' }));
  assert.strictEqual(p.tipo, 'planilha'); assert.strictEqual(p.escopo, 'acao');
});

test('menciona o banco do réu pelo núcleo do nome, sem confundir palavras parecidas', () => {
  assert.ok(mencionaBanco('Cartão de Benefício | RCC (BANCO PAN S A)', 'Banco PAN S.A.'));
  assert.ok(mencionaBanco('FACTA FINANCEIRA S A', 'Facta Financeira S.A.'));
  assert.ok(!mencionaBanco('panorama do benefício', 'Banco PAN S.A.'));
  assert.ok(mencionaBanco('ITAU CONSIGNADO S.A.', 'Banco Itaú S.A.'));
  assert.ok(!mencionaBanco('BANCO PAN', 'Banco Itaú S.A.'));
});

test('nome no kit: número, rótulo, cliente e extensão; vários do mesmo tipo ganham "1 de N"', () => {
  assert.strictEqual(nomeNoKit({ ordem: 3, rotulo: 'Documento de identidade', cliente: 'Fulano de Tal', original: 'RG .pdf' }), '03 - Documento de identidade - Fulano de Tal.pdf');
  assert.strictEqual(nomeNoKit({ ordem: 7, rotulo: 'Histórico de créditos do INSS', cliente: 'Fulano', original: 'historico-creditos (25).pdf', parte: [2, 6] }), '07 - Histórico de créditos do INSS (2 de 6) - Fulano.pdf');
  assert.strictEqual(nomeNoKit({ ordem: 1, rotulo: 'Procuração', cliente: 'Ana / Bia', original: 'x', mime: 'image/png' }), '01 - Procuração - Ana Bia.pdf', 'foto vira PDF e barra sai do nome');
});

// Cenário do caso real: 6 ações, uma por banco; tudo anexado só no card do Itaú.
const acoes = [
  acao(110, 'Fulano · empréstimo consignado — Banco Itaú S.A.', 'criacao_inicial'),
  acao(111, 'Fulano · empréstimo consignado — Banco Pine S.A.'),
  acao(112, 'Fulano · empréstimo consignado — Banco Banrisul S.A.'),
  acao(113, 'Fulano · empréstimo consignado — Banco C6 Consignado'),
  acao(114, 'Fulano · RCC — Banco PAN S.A.'),
  acao(115, 'Fulano · RMC — Facta Financeira S.A.'),
];
const docs = [
  doc(559, 'CARTOES_FULANO_PAN_E_FACTA.png', 'Tipo do documento: Consulta de empréstimos em cartão de benefício. BANCO PAN S A ... FACTA FINANCEIRA S A', { case_id: 110, mime: 'image/png' }),
  doc(560, 'DECLARAÇAO_DE_HIPOSSUFICIENCIA_FULANO.pdf', null, { case_id: 110 }),
  doc(561, 'EXTRATO_DE_EMPRESTIMO_CONSIGNADO_FULANO.pdf', 'Tipo do documento:\n* Histórico de Créditos do INSS', { case_id: 110 }),
  doc(562, 'PROCURAÇAO_LETICIA_DO_FULANO.pdf', null, { case_id: 110 }),
  doc(563, 'RG .pdf', null, { case_id: 110 }),
  doc(617, 'historico-creditos (25).pdf', null, { case_id: 110 }),
  doc(618, 'historico-creditos (24).pdf', null, { case_id: 110 }),
  doc(625, 'Dossiê da peça — Fulano (v1)', 'x', { case_id: 110, type: 'ia', has_data: false }),
  doc(626, 'Petição Inicial — Fulano (v1)', 'texto', { case_id: 110, type: 'ia', has_data: false }),
  doc(636, 'Petição Inicial — Fulano (v2)', 'texto', { case_id: 110, type: 'ia', has_data: false }),
];

test('lote do caso real: documentos comuns servem às 6 ações; o print do PAN/Facta vai só para as duas', () => {
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: docs });
  assert.strictEqual(l.acoes.length, 6);
  const itau = l.acoes.find((a) => a.id === 110), pan = l.acoes.find((a) => a.id === 114), facta = l.acoes.find((a) => a.id === 115), pine = l.acoes.find((a) => a.id === 111);
  assert.strictEqual(itau.reu, 'Banco Itaú S.A.');
  assert.ok(pan.kit.some((k) => k.docId === 559) && facta.kit.some((k) => k.docId === 559));
  assert.ok(!itau.kit.some((k) => k.docId === 559) && !pine.kit.some((k) => k.docId === 559));
  // Comuns no kit de todas, na ordem do protocolo e renomeados.
  for (const a of l.acoes) {
    const nomes = a.kit.map((k) => k.nome);
    assert.ok(nomes[0].startsWith('01 - Procuração - Fulano'), `${a.id}: ${nomes[0]}`);
    assert.ok(nomes.some((n) => /Declaração de hipossuficiência/.test(n)));
    assert.strictEqual(nomes.filter((n) => /Histórico de créditos do INSS \(\d de 3\)/.test(n)).length, 3);
  }
  // Interno nunca vai para o kit.
  assert.ok(!l.acoes.some((a) => a.kit.some((k) => [625, 626, 636].includes(k.docId))));
});

test('lote: sem o extrato de empréstimos do INSS, as 6 ações ficam travadas e o card diz o que falta', () => {
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: docs });
  assert.ok(l.faltamComuns.some((f) => f.tipo === 'extrato_emprestimos' && f.bloqueia));
  assert.ok(l.faltamComuns.some((f) => f.tipo === 'comprovante_residencia'));
  for (const a of l.acoes) assert.strictEqual(a.situacao, 'faltam_documentos', `${a.id}`);
  const l2 = montarLote({ cliente: 'Fulano', acoes, documentos: [...docs, doc(700, 'extrato_emprestimo_consignado_completo_301025.pdf'), doc(701, 'comprovante de residencia.pdf')] });
  assert.ok(!l2.faltamComuns.some((f) => f.bloqueia));
  assert.strictEqual(l2.acoes.find((a) => a.id === 110).situacao, 'revisar', 'Itaú já tem peça: falta a revisão da Dra.');
  assert.strictEqual(l2.acoes.find((a) => a.id === 111).situacao, 'em_preparo');
});

test('lote: peça mais recente da ação (v2), e ação com peça final fica "pronta para protocolar"', () => {
  const comFinal = docs.map((d) => d.id === 636 ? { ...d, final_em: '2026-10-30' } : d);
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: [...comFinal, doc(700, 'extrato_emprestimo_consignado_completo.pdf'), doc(701, 'comprovante de residencia.pdf')] });
  const itau = l.acoes.find((a) => a.id === 110);
  assert.strictEqual(itau.peca.docId, 636);
  assert.strictEqual(itau.peca.versao, 2);
  assert.strictEqual(itau.situacao, 'pronta');
});

test('lote: peça marcada como versão final pela Dra. deixa a ação "pronta", mesmo com documento faltando (fica avisado)', () => {
  const comFinal = docs.map((d) => d.id === 636 ? { ...d, final_em: '2026-10-30' } : d);
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: [...comFinal, doc(900, 'Petição Inicial — Fulano (v3 · versão final da Dra.)', 'texto', { case_id: 110, type: 'peca', final_em: '2026-10-31', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] });
  const itau = l.acoes.find((a) => a.id === 110);
  assert.strictEqual(itau.peca.docId, 900, 'a versão final mais nova');
  assert.strictEqual(itau.peca.versao, 3);
  assert.strictEqual(itau.situacao, 'pronta');
  assert.ok(itau.faltam.some((f) => f.bloqueia), 'o que falta continua listado');
});

test('lote: ação protocolada fica como protocolada, e a etapa do card é a da ação mais atrasada', () => {
  const l = montarLote({ cliente: 'Fulano', acoes: [acao(1, 'RMC — Banco X', 'protocolado', { case_number: '5000001-00.2026' }), acao(2, 'Empréstimo consignado — Banco Y', 'revisao_inicial'), acao(3, 'Empréstimo consignado — Banco Z', 'separacao_documentos')], documentos: [] });
  assert.strictEqual(l.acoes[0].situacao, 'protocolada');
  assert.strictEqual(etapaDoLote(l.acoes), 'separacao_documentos');
  assert.strictEqual(l.resumo.protocoladas, 1);
  assert.strictEqual(l.resumo.total, 3);
});

test('lote: documento anexado num card de outro banco não vai para o kit errado', () => {
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: [doc(800, 'contrato.pdf', 'Tipo do documento: Cédula de crédito bancário. Credor: BANCO PINE S.A.', { case_id: 110 })] });
  assert.ok(l.acoes.find((a) => a.id === 111).kit.some((k) => k.docId === 800));
  assert.ok(!l.acoes.find((a) => a.id === 110).kit.some((k) => k.docId === 800));
});

test('quadro: cliente com 2+ ações antes do protocolo vira um card só, na etapa mais atrasada', () => {
  const rows = [
    { id: 110, client_id: 9, client_name: 'Fulano', production_stage: 'criacao_inicial', sla_days: 9, pendencias: 1 },
    { id: 111, client_id: 9, client_name: 'Fulano', production_stage: 'em_analise', sla_days: 9, pendencias: 0 },
    { id: 112, client_id: 9, client_name: 'Fulano', production_stage: 'protocolado', sla_days: 0, pendencias: 0 },
    { id: 200, client_id: 7, client_name: 'Beltrana', production_stage: 'em_analise', sla_days: 2, pendencias: 0 },
  ];
  const q = agruparQuadro(rows);
  const lote = q.find((r) => r.lote);
  assert.strictEqual(lote.production_stage, 'em_analise');
  assert.deepStrictEqual(lote.lote.casos, [110, 111]);
  assert.strictEqual(lote.lote.protocoladas, 1);
  assert.strictEqual(lote.pendencias, 1);
  assert.ok(q.some((r) => r.id === 112 && !r.lote), 'protocolada segue como card próprio');
  assert.ok(q.some((r) => r.id === 200 && !r.lote));
  assert.strictEqual(q.length, 3);
});

test('quadro: arrastar o card do cliente move as ações que ficaram para trás (caso real: card do Valmirio não ia para Separação)', () => {
  const rows = [
    { id: 110, client_id: 9, production_stage: 'em_analise' },
    { id: 111, client_id: 9, production_stage: 'em_analise' },
    { id: 112, client_id: 9, production_stage: 'criacao_inicial' },
  ];
  const { mover } = agruparQuadro(rows)[0].lote;
  assert.deepStrictEqual(mover.separacao_documentos, [110, 111], 'avança só as atrasadas; a que já está à frente fica');
  assert.deepStrictEqual(mover.revisao_inicial, [110, 111, 112]);
  assert.deepStrictEqual(mover.em_analise, [], 'soltar na própria coluna não move nada');
  assert.strictEqual(mover.protocolado, undefined, 'protocolo é uma a uma, na tela do cliente');
  assert.strictEqual(mover.recusado, undefined);
});

test('quadro: arrastar o card do cliente para trás volta todas as ações', () => {
  const rows = [
    { id: 1, client_id: 9, production_stage: 'criacao_inicial' },
    { id: 2, client_id: 9, production_stage: 'revisao_inicial' },
  ];
  const { mover } = agruparQuadro(rows)[0].lote;
  assert.deepStrictEqual(mover.separacao_documentos, [1, 2]);
  assert.deepStrictEqual(mover.criacao_inicial, []);
  assert.deepStrictEqual(mover.aguardando_protocolo, [1, 2]);
});

test('senha do Meu INSS escrita na observação sai do texto e vai para o cofre', () => {
  const r = retirarSenhaInss('Encaminho o caso.\n🔐 DADOS DE ACESSO AO INSS\nSenha Meu INSS: Fict#2026#\nPontos principais');
  assert.strictEqual(r.senha, 'Fict#2026#');
  assert.ok(!r.texto.includes('Fict#2026#'));
  assert.ok(r.texto.includes('Senha Meu INSS: [guardada na ficha do cliente]'));
  assert.ok(r.texto.includes('Pontos principais'));
  assert.deepStrictEqual(retirarSenhaInss('sem senha aqui'), { texto: 'sem senha aqui', senha: null });
  assert.strictEqual(retirarSenhaInss('senha do inss - abc123').senha, 'abc123');
  assert.strictEqual(retirarSenhaInss('Senha Meu INSS: [guardada na ficha do cliente]').senha, null, 'não relê o marcador');
});

test('senha repetida no texto sai de todas as vezes, mesmo depois de um marcador (caso real: e-mail colado com a senha no topo e no corpo)', () => {
  const r = retirarSenhaInss('Senha Meu INSS: Fict#2026# Bom dia\nDADOS DE ACESSO\nSenha Meu INSS: Fict#2026#\nfim');
  assert.strictEqual(r.senha, 'Fict#2026#');
  assert.ok(!r.texto.includes('Fict#2026#'), r.texto);
  const meio = retirarSenhaInss('Senha Meu INSS: [guardada na ficha do cliente] Bom dia\nSenha Meu INSS: Fict#2026#\nfim');
  assert.strictEqual(meio.senha, 'Fict#2026#', 'acha a senha que sobrou depois do marcador');
  assert.ok(!meio.texto.includes('Fict#2026#'));
});

// ── Introdução do caso e documentos sem repetição (31/10/2026, print da Jessica) ──

test('lote: o mesmo arquivo do Drive em várias ações entra uma vez na lista e no kit (o kit do Itaú tinha 39 anexos)', () => {
  const link = 'https://drive.google.com/file/d/hiscre24/view';
  const repetidos = [110, 111, 112].map((caso, i) => doc(950 + i, 'historico-creditos (24).pdf', null, { case_id: caso, file_url: link }));
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: [...docs, ...repetidos, doc(960, 'RG (2).pdf', null, { duplicado_de: 563 })] });
  assert.strictEqual(l.documentos.filter((d) => d.original === 'historico-creditos (24).pdf').length, 2, 'o 618 (sem link) e um só dos três do Drive');
  assert.ok(!l.documentos.some((d) => d.docId === 960), 'o já marcado como repetido não aparece');
  for (const a of l.acoes) assert.strictEqual(a.kit.filter((k) => k.original === 'historico-creditos (24).pdf').length, 2, `${a.id}`);
});

test('apresentação: assunto, bancos e o próximo passo (travado pelo extrato do INSS); a descrição de uma ação não vira relato do caso', () => {
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: docs });
  const ap = l.apresentacao;
  assert.match(ap.assunto, /benefício do INSS/);
  assert.match(ap.assunto, /Empréstimo consignado/);
  assert.match(ap.assunto, /Cartão consignado/);
  assert.deepStrictEqual(ap.bancos, ['Banco Itaú S.A.', 'Banco Pine S.A.', 'Banco Banrisul S.A.', 'Banco C6 Consignado', 'Banco PAN S.A.', 'Facta Financeira S.A.']);
  assert.ok(!('relato' in ap), 'o relato do caso vem da síntese do cliente inteiro (sinteseCaso.ts)');
  assert.strictEqual(ap.proximo.tipo, 'trava');
  assert.match(ap.proximo.texto, /Extrato de empréstimos consignados do INSS/);
});

test('apresentação: sem trava, o próximo passo diz quais peças gerar, revisar ou protocolar', () => {
  const completos = [...docs, doc(700, 'extrato_emprestimo_consignado_completo.pdf'), doc(701, 'comprovante de residencia.pdf')];
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: completos });
  assert.strictEqual(l.apresentacao.proximo.tipo, 'gerar');
  assert.match(l.apresentacao.proximo.texto, /5 ações/);
  assert.match(l.apresentacao.proximo.texto, /Banco Pine S\.A\./);
  const so2 = montarLote({ cliente: 'Fulano', acoes: acoes.slice(0, 1), documentos: completos });
  assert.strictEqual(so2.apresentacao.proximo.tipo, 'revisar');
  const final = montarLote({ cliente: 'Fulano', acoes: acoes.slice(0, 1), documentos: completos.map((d) => d.id === 636 ? { ...d, final_em: '2026-10-31' } : d) });
  assert.strictEqual(final.apresentacao.proximo.tipo, 'protocolar');
});

test('apresentação: sem ponto dobrado quando o último banco termina em "S.A."', () => {
  const l = montarLote({ cliente: 'Fulano', acoes, documentos: [...docs, doc(700, 'extrato_emprestimo_consignado_completo.pdf'), doc(701, 'comprovante de residencia.pdf')] });
  assert.match(l.apresentacao.proximo.texto, /Facta Financeira S\.A\.$/);
});
