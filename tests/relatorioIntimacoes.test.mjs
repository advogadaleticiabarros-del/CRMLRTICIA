// Relatório diário de intimações (pedido da Dra., 13/11/2026: "por que as
// atualizações dos processos não chegam dessa forma para mim? De fácil
// entendimento, com prazo correto e me dando a data final?").
import { test } from 'node:test';
import assert from 'node:assert';
import { analisarPrazoIntimacao } from '../dist/services/prazoIntimacao.js';
import { montarRelatorio, pdfRelatorio, pdfRecorte, polosDasPartes } from '../dist/services/relatorioIntimacoes.js';

const item = (o) => ({
  movementId: o.id, numero: o.numero, tribunal: o.tribunal, orgao: o.orgao, classe: o.classe || null, tipo: 'Intimação',
  poloAtivo: o.ativo || [], poloPassivo: o.passivo || [], cliente: o.cliente || null, link: 'https://exemplo.jus.br/doc',
  texto: o.texto, resumo: o.resumo || null,
  analise: analisarPrazoIntimacao({ numeroProcesso: o.numero, tribunal: o.tribunal, orgao: o.orgao, classe: o.classe, tipo: o.tipo || 'Intimação', texto: o.texto, disponibilizacao: '2026-11-13' }),
});

const itens = [
  item({ id: 3, numero: '5014269-85.2026.4.02.5001', tribunal: 'TRF2', orgao: '7ª Turma Especializada', tipo: 'Ata de sessão de julgamento', texto: 'Deu provimento à apelação.', ativo: ['FULANO DE TAL'] }),
  item({ id: 1, numero: '5018345-55.2026.4.02.5001', tribunal: 'TRF2', orgao: '3º Juizado Especial de Vitória', texto: 'SENTENÇA. Julgo improcedente o pedido <b>.', ativo: ['CLIENTE TESTE'], cliente: 'Cliente Teste', resumo: 'Sentença que julga improcedente o pedido.' }),
  item({ id: 2, numero: '0001868-68.2024.5.17.0003', tribunal: 'TRT17', orgao: '3ª Vara do Trabalho de Vitória', texto: 'Homologo a conta de liquidação. Expeçam-se alvarás.', passivo: ['EMPRESA EXEMPLO LTDA'] }),
];

test('polos: A = ativo, P = passivo; sem polo vai para o ativo', () => {
  assert.deepStrictEqual(polosDasPartes([{ nome: 'Ana', polo: 'A' }, { nome: 'Emp', polo: 'P' }, { nome: 'Bia', polo: '' }]),
    { ativo: ['Ana', 'Bia'], passivo: ['Emp'] });
});

test('relatório: totais, ordem (prazo primeiro) e data limite + protocolar até', () => {
  const r = montarRelatorio(itens, { oab: '39948/ES', dataReferencia: '2026-11-13' });
  assert.deepStrictEqual(r.totais, { publicacoes: 3, processos: 3, prazos: 1, revisao: 1, semPrazo: 1 });
  assert.strictEqual(r.itens[0].movementId, 1, 'o prazo vem primeiro');
  assert.match(r.assunto, /13\/11\/2026/);
  assert.match(r.texto, /Recurso inominado/);
  assert.match(r.texto, /01\/12\/2026/);
  assert.match(r.texto, /protocolar até \*?30\/11\/2026/i);
  assert.match(r.html, /01\/12\/2026/);
  assert.doesNotMatch(r.html, /<b>\./, 'texto do tribunal é escapado no HTML');
});

test('planilha CSV: cabeçalho e uma linha por publicação, separador ;', () => {
  const r = montarRelatorio(itens, { oab: '39948/ES', dataReferencia: '2026-11-13' });
  const linhas = r.csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.strictEqual(linhas.length, 4);
  assert.match(linhas[0], /^Nº;Prioridade;Processo;/);
  assert.match(linhas[1], /2026-12-01|01\/12\/2026/);
});

test('PDFs do relatório e do recorte são gerados', async () => {
  const r = montarRelatorio(itens, { oab: '39948/ES', dataReferencia: '2026-11-13' });
  const a = await pdfRelatorio(r);
  const b = await pdfRecorte(r);
  assert.strictEqual(a.subarray(0, 4).toString(), '%PDF');
  assert.strictEqual(b.subarray(0, 4).toString(), '%PDF');
  assert.ok(a.length > 1500);
  const paginas = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
  assert.ok(paginas(a) <= 2, `o rodapé não pode criar páginas em branco (veio ${paginas(a)})`);
  assert.strictEqual(paginas(b), 3, 'recorte: uma página por publicação');
});

test('dia sem publicação: relatório vazio não quebra', () => {
  const r = montarRelatorio([], { oab: '39948/ES', dataReferencia: '2026-11-13' });
  assert.strictEqual(r.totais.publicacoes, 0);
  assert.match(r.texto, /nenhuma publica/i);
});

test('e-mail que não sai diz o motivo (13/11: "não chegou nenhum e-mail")', async () => {
  const { motivoFalhaEmail } = await import('../dist/services/relatorioIntimacoes.js');
  assert.strictEqual(motivoFalhaEmail([], 0), 'nenhum usuário admin/advogado ativo com e-mail cadastrado');
  assert.match(motivoFalhaEmail([{ ok: false, skipped: true }], 1), /não está configurado no servidor/);
  assert.match(motivoFalhaEmail([{ ok: false, error: 'Resend HTTP 403: domain not verified' }], 1), /Resend HTTP 403/);
  assert.strictEqual(motivoFalhaEmail([{ ok: true }, { ok: false, error: 'x' }], 2), null, 'se um chegou, não é falha');
});
