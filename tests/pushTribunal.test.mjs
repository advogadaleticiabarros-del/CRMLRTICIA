// Push do PJe (TRT17 e outros) lido do e-mail — 18/11/2026. Números e textos FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehEmailPush, lerMovimentosDoPush, dataPushParaIso } from '../dist/services/pushTribunal.js';

const DE = '"Processo Judicial Eletrônico - Push" <notificacoes@trt17.jus.br>';
const ASSUNTO = '[TRT17] [PUSH] Atualizações de Informações Processuais do Processo 0000004-44.2026.5.17.0001';

test('reconhece o e-mail Push do PJe e o tribunal pelo assunto', () => {
  assert.deepEqual(ehEmailPush(DE, ASSUNTO), { tribunal: 'TRT17' });
  assert.deepEqual(ehEmailPush('notificacoes@trt9.jus.br', '[TRT9] [PUSH] Atualizações'), { tribunal: 'TRT9' });
  // Push sem a sigla no assunto: tribunal vem do domínio do remetente
  assert.deepEqual(ehEmailPush('push@pje.tjes.jus.br', 'PUSH - movimentação'), { tribunal: 'TJES' });
});

test('não confunde outros e-mails com Push', () => {
  assert.equal(ehEmailPush('naoresponder.jte@trt6.jus.br', 'JTe - Validação de usuário'), null);
  assert.equal(ehEmailPush('alguem@gmail.com', '[PUSH] promoção'), null);
  assert.equal(ehEmailPush(DE, 'Intimação'), null);
});

test('data do Push vira horário de Brasília em ISO', () => {
  assert.equal(dataPushParaIso('17/11/2026 14:32'), '2026-11-17T17:32:00.000Z');
  assert.equal(dataPushParaIso('17/11/2026 14:32:05'), '2026-11-17T17:32:05.000Z');
  assert.equal(dataPushParaIso('17/11/2026'), '2026-11-17T15:00:00.000Z'); // sem hora: meio-dia
  assert.equal(dataPushParaIso('31/02/2026'), null);
  assert.equal(dataPushParaIso('qualquer'), null);
});

test('lê cada linha da tabela do e-mail como uma movimentação', () => {
  const html = `<html><body><p>Prezado(a) usuário(a),</p>
    <table><tr><th>Data</th><th>Movimento</th><th>Documento</th></tr>
    <tr><td>17/11/2026 14:32</td><td>Juntada a petição de Manifestação</td><td>abc123</td></tr>
    <tr><td> 18/11/2026 09:05:10 </td><td>Expedido(a) intimação a(o) RECLAMANTE &amp; outros</td><td></td></tr>
    <tr><td>Observação</td><td>texto que não é movimento</td></tr>
    </table></body></html>`;
  const movs = lerMovimentosDoPush(html);
  assert.equal(movs.length, 2);
  assert.deepEqual(movs[0], { data: '2026-11-17T17:32:00.000Z', texto: 'Juntada a petição de Manifestação — abc123' });
  assert.deepEqual(movs[1], { data: '2026-11-18T12:05:10.000Z', texto: 'Expedido(a) intimação a(o) RECLAMANTE & outros' });
});

test('data dentro do texto do movimento não separa a linha', () => {
  const html = '<table><tr><td>17/11/2026 10:00</td><td>Audiência designada para 10/12/2026 14:00</td></tr></table>';
  assert.deepEqual(lerMovimentosDoPush(html), [
    { data: '2026-11-17T13:00:00.000Z', texto: 'Audiência designada para 10/12/2026 14:00' },
  ]);
});

test('e-mail em texto puro: uma linha por movimento, começando pela data', () => {
  const txt = 'Prezado(a),\nSeguem as atualizações:\n17/11/2026 14:32 - Conclusos para despacho\n18/11/2026 08:00 | Publicado o despacho\nAtenciosamente';
  assert.deepEqual(lerMovimentosDoPush(txt), [
    { data: '2026-11-17T17:32:00.000Z', texto: 'Conclusos para despacho' },
    { data: '2026-11-18T11:00:00.000Z', texto: 'Publicado o despacho' },
  ]);
});

test('formato desconhecido devolve lista vazia (quem chama mantém o caminho antigo)', () => {
  assert.deepEqual(lerMovimentosDoPush('<p>Houve movimentação no processo.</p>'), []);
  assert.deepEqual(lerMovimentosDoPush(''), []);
  assert.deepEqual(lerMovimentosDoPush(null), []);
});

test('movimento repetido no mesmo e-mail entra uma vez só', () => {
  const html = '<table><tr><td>17/11/2026 10:00</td><td>Conclusos</td></tr><tr><td>17/11/2026 10:00</td><td>Conclusos</td></tr></table>';
  assert.equal(lerMovimentosDoPush(html).length, 1);
});
