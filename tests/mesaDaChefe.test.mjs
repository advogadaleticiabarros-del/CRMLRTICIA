// tests/mesaDaChefe.test.mjs — a CEO (advogada chefe) recebe tudo o que a equipe entrega
import { test } from 'node:test';
import assert from 'node:assert';
import { montarMesaDaChefe, ITENS_DA_CHEFE } from '../dist/services/mesaDaChefe.js';

const AGORA = new Date('2026-11-13T15:00:00Z');
const vazio = () => Object.fromEntries(ITENS_DA_CHEFE.map((i) => [i.id, 0]));

test('ITENS_DA_CHEFE: ids únicos e todo item diz onde abrir', () => {
  const ids = ITENS_DA_CHEFE.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const i of ITENS_DA_CHEFE) assert.ok(i.abrir && i.titulo && i.grupo, i.id);
});

test('total para conferir soma só o que espera decisão dela (não as avaliações)', () => {
  const m = montarMesaDaChefe({ contagens: { ...vazio(), mensagens: 3, contratos: 2, decisoes_lidas: 9, leads_quentes: 4 }, recados: [], ideias: [], agora: AGORA });
  assert.strictEqual(m.total, 5);
  const conferir = m.grupos.find((g) => g.id === 'conferir');
  assert.deepStrictEqual(conferir.itens.slice(0, 2).map((i) => i.id), ['mensagens', 'contratos']);
  const aval = m.grupos.find((g) => g.id === 'avaliacoes');
  assert.ok(aval.itens.some((i) => i.id === 'decisoes_lidas' && i.n === 9));
});

test('itens zerados aparecem como "em dia" no fim do grupo', () => {
  const m = montarMesaDaChefe({ contagens: { ...vazio(), prazos: 1 }, recados: [], ideias: [], agora: AGORA });
  const itens = m.grupos.find((g) => g.id === 'conferir').itens;
  assert.strictEqual(itens[0].id, 'prazos');
  assert.ok(itens.slice(1).every((i) => i.n === 0 && i.emDia));
});

test('mensagem urgente vira alerta no topo', () => {
  const m = montarMesaDaChefe({ contagens: { ...vazio(), mensagens: 2, mensagens_urgentes: 1 }, recados: [], ideias: [], agora: AGORA });
  assert.strictEqual(m.urgentes, 1);
  assert.match(m.grupos.find((g) => g.id === 'conferir').itens[0].detalhe, /1 urgente/);
});

test('recados: nome e cor do agente, mais novo primeiro, no máximo 30', () => {
  const recados = Array.from({ length: 40 }, (_, k) => ({ agente: k % 2 ? 'leitor' : 'prazos', texto: `ação ${k}`, created_at: new Date(AGORA.getTime() - k * 60000) }));
  recados.push({ agente: 'fantasma', texto: 'agente que não existe', created_at: new Date(AGORA.getTime() + 60000) });
  const m = montarMesaDaChefe({ contagens: vazio(), recados, ideias: [], agora: AGORA });
  assert.strictEqual(m.recados.length, 30);
  assert.strictEqual(m.recados[0].nome, 'fantasma');
  assert.strictEqual(m.recados[1].nome, 'Dra. Paula');
  assert.ok(m.recados.every((r, i, a) => i === 0 || a[i - 1].em >= r.em));
  assert.ok(m.recados.find((r) => r.agente === 'leitor').cor.startsWith('#'));
});

test('ideias da reunião chegam com o nome de quem sugeriu', () => {
  const m = montarMesaDaChefe({ contagens: vazio(), recados: [], ideias: [{ agente: 'financeiro', ideia: 'cobrar antes do vencimento' }], agora: AGORA });
  assert.deepStrictEqual(m.ideias, [{ agente: 'financeiro', nome: 'Dr. Fábio', ideia: 'cobrar antes do vencimento' }]);
});

test('frase do status: em dia quando não há nada, senão quantos itens', () => {
  assert.match(montarMesaDaChefe({ contagens: vazio(), recados: [], ideias: [], agora: AGORA }).frase, /em dia/i);
  assert.match(montarMesaDaChefe({ contagens: { ...vazio(), fichas: 4 }, recados: [], ideias: [], agora: AGORA }).frase, /4 itens/);
  assert.match(montarMesaDaChefe({ contagens: { ...vazio(), fichas: 1 }, recados: [], ideias: [], agora: AGORA }).frase, /1 item\b/);
});
