// Pedido (16/11/2026): "QUERO MOVER OS CARDS DOS DATIVOS" — no quadro Caminho do
// pagamento (aba Projeção) os cards só abriam a ficha. Agora dá para arrastar o
// card para outra coluna; a etapa escolhida vale como está (inclusive para trás,
// para corrigir), sem o "só avança" que vale ao preencher os campos da ficha.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ETAPAS_DO_QUADRO, validarMovimentoNoQuadro } from '../dist/services/fluxoPagamentoDativo.js';

test('colunas do quadro: da atuação concluída até a lista da Sefaz, mais indeferida', () => {
  assert.deepStrictEqual(ETAPAS_DO_QUADRO, [
    'concluida', 'aguardando_liberacao_requerimento', 'protocolada', 'deferida', 'a_receber', 'indeferida',
  ]);
});

test('move para frente e para trás entre as colunas do quadro', () => {
  assert.deepStrictEqual(validarMovimentoNoQuadro('protocolada', 'deferida'), { ok: true, status: 'deferida' });
  assert.deepStrictEqual(validarMovimentoNoQuadro('a_receber', 'protocolada'), { ok: true, status: 'protocolada' });
  assert.deepStrictEqual(validarMovimentoNoQuadro('deferida', 'indeferida'), { ok: true, status: 'indeferida' });
  assert.deepStrictEqual(validarMovimentoNoQuadro('indeferida', 'aguardando_liberacao_requerimento'), { ok: true, status: 'aguardando_liberacao_requerimento' });
});

test('também move para as etapas antes da certidão (para o kanban de todas as fases)', () => {
  assert.deepStrictEqual(validarMovimentoNoQuadro('nomeada', 'em_andamento'), { ok: true, status: 'em_andamento' });
  assert.deepStrictEqual(validarMovimentoNoQuadro('protocolada', 'nomeada'), { ok: true, status: 'nomeada' });
});

test('não leva a recebida nem recusada, e não mexe em quem já está nelas', () => {
  assert.strictEqual(validarMovimentoNoQuadro('protocolada', 'paga').ok, false); // recebida só pelo "Recebi no banco"
  assert.strictEqual(validarMovimentoNoQuadro('protocolada', 'recusada').ok, false); // recusa exige motivo
  assert.strictEqual(validarMovimentoNoQuadro('protocolada', 'xyz').ok, false);
  assert.strictEqual(validarMovimentoNoQuadro('paga', 'deferida').ok, false);
  assert.strictEqual(validarMovimentoNoQuadro('recusada', 'deferida').ok, false);
});

test('mensagem de erro em português claro', () => {
  assert.match(validarMovimentoNoQuadro('paga', 'deferida').erro, /recebida/i);
  assert.match(validarMovimentoNoQuadro('deferida', 'paga').erro, /dar baixa/i);
  assert.match(validarMovimentoNoQuadro('deferida', 'recusada').erro, /motivo/i);
});

const rota = fs.readFileSync(path.resolve('src/routes/dative.ts'), 'utf8');
test('rota PATCH /cases/:id/etapa grava a etapa pela regra e só da própria usuária', () => {
  const ini = rota.indexOf("router.patch('/cases/:id/etapa'");
  assert.ok(ini > 0, 'rota existe');
  const corpo = rota.slice(ini, rota.indexOf('\nrouter.', ini + 10));
  assert.match(corpo, /validarMovimentoNoQuadro\(/);
  assert.match(corpo, /user_id = \?/);
  assert.doesNotMatch(corpo, /statusAposRegistro/); // o arrasto não reaplica o "só avança"
});

const app = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const ini = app.indexOf('async function datProjecao(');
const projecao = app.slice(ini, app.indexOf('async function datDemandas(', ini));
const ajudante = app.slice(app.indexOf('function datLigarArrastoDeEtapa('), app.indexOf('async function datDemandas('));
const iniD = app.indexOf('async function datDemandas(');
const demandas = app.slice(iniD, app.indexOf('async function datAudiencias(', iniD));

test('ajudante único: arrasta o card, a coluna recebe e chama a rota da etapa', () => {
  assert.match(ajudante, /\[data-arrasta-caso\]/);
  assert.match(ajudante, /\[data-etapa-col\]/);
  assert.match(ajudante, /addEventListener\('drop'/);
  assert.match(ajudante, /\/api\/dative\/cases\/\$\{d\.id\}\/etapa/);
});

test('Caminho do pagamento (Projeção): cards arrastáveis e coluna Indeferida sempre visível', () => {
  assert.match(projecao, /class="dat-quadro-caso" draggable="true"[^>]*data-arrasta-caso=/);
  assert.match(projecao, /data-etapa-col="\$\{e\.status\}"/);
  assert.match(projecao, /datLigarArrastoDeEtapa\(c,/);
  assert.doesNotMatch(projecao, /e\.status !== 'indeferida' \|\| e\.quantidade/);
});

test('Kanban por fase (Demandas): cards arrastáveis, menos recebida e recusada', () => {
  assert.match(demandas, /data-arrasta-caso="\$\{d\.id\}"/);
  assert.match(demandas, /data-etapa-col="\$\{v\}"/);
  assert.match(demandas, /if \(vista === 'kanban'\) datLigarArrastoDeEtapa\(/);
  assert.match(demandas, /d\.status !== 'paga' && d\.status !== 'recusada'/);
});
