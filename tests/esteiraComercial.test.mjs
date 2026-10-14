// tests/esteiraComercial.test.mjs — Produtor de proposta, Fechador de contrato e Coletor de documentos
import { test } from 'node:test';
import assert from 'node:assert';
import {
  valoresDeTabela, aplicarPolitica, POLITICA_PADRAO, montarHonorarios, mensagemAprovacao, interpretarComandoProposta,
  proximoPassoContrato, checklistDoCaso, mensagemPedidoDocumentos, mensagemCobrancaDocumentos, itensRecebidos, marcoCobranca,
} from '../dist/services/esteiraComercial.js';

// ── Produtor de proposta ────────────────────────────────────────────────────

const HIST = [
  { area: 'trabalhista', total: 1200, entrada: 300, parcelas: 3 },
  { area: 'trabalhista', total: 1500, entrada: 500, parcelas: 5 },
  { area: 'trabalhista', total: 1000, entrada: 200, parcelas: 4 },
  { area: 'familia', total: 3000, entrada: 1000, parcelas: 10 },
];

test('valoresDeTabela: a tabela configurada pela Dra. vale primeiro', () => {
  const v = valoresDeTabela('trabalhista', HIST, { trabalhista: { total: 2000, entrada: 500, parcelas: 6, exito: 30 } });
  assert.deepStrictEqual(v, { total: 2000, entrada: 500, parcelas: 6, exito: 30, origem: 'tabela' });
});

test('valoresDeTabela: sem tabela, usa a mediana das propostas aceitas da área', () => {
  const v = valoresDeTabela('trabalhista', HIST, {});
  assert.strictEqual(v.total, 1200);
  assert.strictEqual(v.entrada, 300);
  assert.strictEqual(v.parcelas, 4);
  assert.strictEqual(v.exito, 30);
  assert.strictEqual(v.origem, 'historico');
});

test('valoresDeTabela: sem nada para a área → só êxito de 30% (regra do escritório), sem inventar valor fixo', () => {
  const v = valoresDeTabela('consumidor', HIST, {});
  assert.deepStrictEqual(v, { total: 0, entrada: 0, parcelas: 1, exito: 30, origem: 'padrao' });
});

test('aplicarPolitica: respeita máximo de parcelas, parcela mínima e entrada mínima', () => {
  const p = aplicarPolitica({ total: 1200, entrada: 0, parcelas: 20 }, { entradaMinPct: 20, maxParcelas: 10, parcelaMinima: 150 });
  assert.strictEqual(p.entrada, 240);           // 20% de 1200
  assert.ok(p.parcelas <= 10);
  assert.ok(p.valor_parcela >= 150);
  assert.strictEqual(Math.round((p.entrada + p.valor_parcela * (p.parcelas - 1) + p.ultima_parcela) * 100) / 100, 1200);
});

test('aplicarPolitica: total zero (só êxito) não gera parcelas', () => {
  const p = aplicarPolitica({ total: 0, entrada: 0, parcelas: 1 }, POLITICA_PADRAO);
  assert.deepStrictEqual(p, { total: 0, entrada: 0, parcelas: 0, valor_parcela: 0, ultima_parcela: 0 });
});

test('montarHonorarios: formato que a tela de propostas e o contrato já usam', () => {
  const h = montarHonorarios({ exito: 30, parcelamento: { total: 1200, entrada: 300, parcelas: 3, valor_parcela: 300, ultima_parcela: 300 } }, '2026-11-10');
  assert.deepStrictEqual(h.modalidades, ['exito']);
  assert.strictEqual(h.values.exito, 30);
  assert.strictEqual(h.parcelamento.total, 1200);
  assert.strictEqual(h.parcelamento.primeiro_vencimento, '2026-11-10');
  const so = montarHonorarios({ exito: 30, parcelamento: { total: 0, entrada: 0, parcelas: 0, valor_parcela: 0, ultima_parcela: 0 } }, null);
  assert.strictEqual(so.apenas_exito, true);
});

test('mensagemAprovacao: resumo para a Dra. com valores e como responder', () => {
  const m = mensagemAprovacao({ id: 123, nome: 'Maria Teste', area: 'trabalhista', tipoCausa: 'Rescisão indireta', resumo: 'Sem FGTS há 8 meses.',
    exito: 30, parcelamento: { total: 1200, entrada: 300, parcelas: 3, valor_parcela: 300, ultima_parcela: 300 }, origem: 'historico' });
  assert.match(m, /Maria Teste/);
  assert.match(m, /R\$\s?1\.200,00/);
  assert.match(m, /3x de R\$\s?300,00/);
  assert.match(m, /30%/);
  assert.match(m, /aprovar 123/);
  assert.match(m, /ajustar 123/);
  assert.match(m, /média das propostas aceitas/i);
});

test('mensagemAprovacao: avisa conflito de interesses quando a pessoa já é parte contrária', () => {
  const base = { id: 5, nome: 'Fulano', area: 'trabalhista', tipoCausa: null, resumo: null, exito: 30,
    parcelamento: { total: 0, entrada: 0, parcelas: 0, valor_parcela: 0, ultima_parcela: 0 }, origem: 'padrao' };
  assert.match(mensagemAprovacao({ ...base, conflitos: ['Processo — Maria Teste (parte contrária)'] }), /CONFLITO[\s\S]*Maria Teste/);
  assert.match(mensagemAprovacao({ ...base, conflitos: [] }), /Conflito de interesses: nenhum/);
});

test('interpretarComandoProposta: aprovar, recusar e ajustar com valores', () => {
  assert.deepStrictEqual(interpretarComandoProposta('Aprovar 123'), { acao: 'aprovar', id: 123, ajustes: {} });
  assert.deepStrictEqual(interpretarComandoProposta('aprovo proposta 45'), { acao: 'aprovar', id: 45, ajustes: {} });
  assert.deepStrictEqual(interpretarComandoProposta('recusar 7'), { acao: 'recusar', id: 7, ajustes: {} });
  assert.deepStrictEqual(interpretarComandoProposta('ajustar 123 total 1500, entrada 500, 5x, êxito 25%'),
    { acao: 'ajustar', id: 123, ajustes: { total: 1500, entrada: 500, parcelas: 5, exito: 25 } });
  assert.deepStrictEqual(interpretarComandoProposta('ajustar 9 entrada R$ 1.000,00'), { acao: 'ajustar', id: 9, ajustes: { entrada: 1000 } });
  assert.strictEqual(interpretarComandoProposta('aprovar o boleto da luz'), null);
  assert.strictEqual(interpretarComandoProposta('oi'), null);
});

// ── Fechador de contrato ────────────────────────────────────────────────────

const AGORA = new Date('2026-10-14T15:00:00Z');
const dias = (n) => new Date(AGORA.getTime() - n * 86400000);

test('proximoPassoContrato: em produção há mais de 1 dia → avisar a Dra. para revisar', () => {
  assert.deepStrictEqual(proximoPassoContrato({ status: 'em_producao', desde: dias(2) }, AGORA), { acao: 'avisar_dra', marco: 'revisao_d1' });
  assert.strictEqual(proximoPassoContrato({ status: 'em_producao', desde: dias(0.5) }, AGORA), null);
});

test('proximoPassoContrato: enviado para assinatura e não assinado → lembrar o cliente em D+1, D+3 e D+7', () => {
  assert.deepStrictEqual(proximoPassoContrato({ status: 'finalizado', desde: dias(1.2) }, AGORA), { acao: 'lembrar_cliente', marco: 'assinatura_d1' });
  assert.deepStrictEqual(proximoPassoContrato({ status: 'finalizado', desde: dias(4) }, AGORA), { acao: 'lembrar_cliente', marco: 'assinatura_d3' });
  assert.deepStrictEqual(proximoPassoContrato({ status: 'finalizado', desde: dias(8) }, AGORA), { acao: 'avisar_dra', marco: 'assinatura_d7' });
  assert.strictEqual(proximoPassoContrato({ status: 'assinado', desde: dias(3) }, AGORA), null);
});

// ── Coletor de documentos e provas ──────────────────────────────────────────

test('checklistDoCaso: trabalhista pede foto, endereço, CTPS em PDF com o contrato e FGTS em PDF', () => {
  const l = checklistDoCaso('trabalhista', '').map((i) => i.label).join(' | ');
  assert.match(l, /documento com foto/i);
  assert.match(l, /comprovante de endereço/i);
  assert.match(l, /Carteira de Trabalho.*PDF.*contrato/i);
  assert.match(l, /extrato do FGTS.*PDF/i);
  assert.match(l, /conversas.*WhatsApp/i);
  assert.match(l, /transcrição da reunião/i);
});

test('checklistDoCaso: as provas acompanham o assunto falado', () => {
  const he = checklistDoCaso('trabalhista', 'faço muitas horas extras e não recebo').map((i) => i.label).join(' | ');
  assert.match(he, /ponto|jornada|escala/i);
  const as = checklistDoCaso('trabalhista', 'sofri assédio moral do gerente').map((i) => i.label).join(' | ');
  assert.match(as, /testemunha/i);
  assert.match(as, /áudios|prints/i);
  const ac = checklistDoCaso('trabalhista', 'tive um acidente de trabalho').map((i) => i.label).join(' | ');
  assert.match(ac, /CAT/);
  const ge = checklistDoCaso('gestante', '').map((i) => i.label).join(' | ');
  assert.match(ge, /ultrassom|gravidez/i);
});

test('checklistDoCaso: itens não se repetem', () => {
  const l = checklistDoCaso('trabalhista', 'horas extras e assédio e acidente').map((i) => i.label);
  assert.strictEqual(new Set(l).size, l.length);
});

test('itensRecebidos: marca pelo nome do arquivo e pela leitura do documento', () => {
  const lista = checklistDoCaso('trabalhista', '');
  const r = itensRecebidos(lista, ['RG frente e verso.jpg', 'extrato-fgts-caixa.pdf', 'conta de luz (comprovante de residência).pdf']);
  const ok = r.filter((x) => x.recebido).map((x) => x.label).join(' | ');
  assert.match(ok, /foto/i);
  assert.match(ok, /FGTS/);
  assert.match(ok, /endereço/i);
  assert.ok(r.some((x) => !x.recebido && /Carteira de Trabalho/.test(x.label)));
});

test('mensagemPedidoDocumentos e mensagemCobrancaDocumentos: claras, com a lista e sem conteúdo jurídico', () => {
  const lista = checklistDoCaso('trabalhista', '');
  const m = mensagemPedidoDocumentos('Maria Teste', lista);
  assert.match(m, /Olá, Maria/);
  assert.match(m, /FGTS/);
  assert.match(m, /PDF/);
  const c = mensagemCobrancaDocumentos('Maria Teste', lista.slice(0, 2));
  assert.match(c, /ainda faltam/i);
  assert.ok(c.split('\n').filter((l) => l.startsWith('•')).length === 2);
});

test('marcoCobranca: cobra em D+2, D+5 e D+10; depois avisa a Dra.', () => {
  assert.strictEqual(marcoCobranca(dias(1), AGORA), null);
  assert.strictEqual(marcoCobranca(dias(2.5), AGORA), 'docs_d2');
  assert.strictEqual(marcoCobranca(dias(6), AGORA), 'docs_d5');
  assert.strictEqual(marcoCobranca(dias(11), AGORA), 'docs_d10');
});
