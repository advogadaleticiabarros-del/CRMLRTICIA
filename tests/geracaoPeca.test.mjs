// tests/geracaoPeca.test.mjs — Geração da peça que sobrevive à atualização do sistema
// (30/10/2026). Caso real: a Jessica pediu uma nova versão e ela nunca chegou, porque
// uma publicação reiniciou o CRM no meio da geração (sem aviso, sem peça). Agora cada
// geração fica registrada no banco e é retomada sozinha quando o CRM volta.
import { test } from 'node:test';
import assert from 'node:assert';
import { criarGeracaoPeca } from '../dist/services/geracaoPeca.js';
import { criarTravaGeracao } from '../dist/services/travaGeracaoPeca.js';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

function fakes(over = {}) {
  const gerados = []; const revisados = []; const avisos = []; const pendentes = new Map();
  const deps = {
    trava: criarTravaGeracao(),
    gerar: async (caseId, userId, force) => { gerados.push({ caseId, userId, force }); return { ok: true, version: 3 }; },
    revisar: async (caseId) => { revisados.push(caseId); return { itens_ok: 8, itens_verificados: 10, pendencias_criticas: 1 }; },
    avisar: async (a) => { avisos.push(a); },
    pendentes: {
      guardar: async (p) => { pendentes.set(p.alvo, { ...p }); },
      apagar: async (alvo) => { pendentes.delete(alvo); },
      listar: async () => [...pendentes.values()],
    },
    ...over,
  };
  return { deps, gerados, revisados, avisos, pendentes };
}
const espera = () => new Promise((r) => setTimeout(r, 5));
const pedido = (o = {}) => ({ alvo: 110, caseId: 110, userId: 1, origem: 'manual', titulo: 'RMC — Banco Pan', ...o });

test('pedido manual: gera nova versão, avisa no sino e limpa o registro', async () => {
  const f = fakes(); const g = criarGeracaoPeca(f.deps);
  assert.strictEqual(g.pedir(pedido()), true);
  assert.ok(f.deps.trava.emAndamento(110));
  await g.ocioso();
  assert.deepStrictEqual(f.gerados, [{ caseId: 110, userId: 1, force: true }]);
  assert.strictEqual(f.avisos.length, 1);
  assert.strictEqual(f.avisos[0].ok, true);
  assert.match(f.avisos[0].mensagem, /v3 pronta/);
  assert.strictEqual(f.pendentes.size, 0);
  assert.strictEqual(f.deps.trava.emAndamento(110), null);
});

test('enquanto gera, o pedido fica registrado no banco', async () => {
  let soltar; const f = fakes({ gerar: () => new Promise((r) => { soltar = () => r({ ok: true, version: 2 }); }) });
  const g = criarGeracaoPeca(f.deps);
  g.pedir(pedido());
  await espera();
  assert.deepStrictEqual(f.pendentes.get(110), { ...pedido(), tentativas: 0 });
  soltar(); await g.ocioso();
  assert.strictEqual(f.pendentes.size, 0);
});

test('segundo pedido da mesma peça é recusado e não gera de novo', async () => {
  const f = fakes(); const g = criarGeracaoPeca(f.deps);
  assert.strictEqual(g.pedir(pedido()), true);
  assert.strictEqual(g.pedir(pedido()), false);
  await g.ocioso();
  assert.strictEqual(f.gerados.length, 1);
});

test('pela etapa "Criação inicial": não força versão nova e já revisa', async () => {
  const f = fakes(); const g = criarGeracaoPeca(f.deps);
  g.pedir(pedido({ origem: 'etapa' }));
  await g.ocioso();
  assert.strictEqual(f.gerados[0].force, false);
  assert.deepStrictEqual(f.revisados, [110]);
  assert.match(f.avisos[0].mensagem, /8\/10 itens OK, 1 pendência\(s\) crítica\(s\)/);
});

test('"gerar nova versão" também revisa a versão nova (31/10/2026: a revisão do caso Valmirio era de uma versão antiga)', async () => {
  const f = fakes(); const g = criarGeracaoPeca(f.deps);
  g.pedir(pedido({ origem: 'manual' }));
  await g.ocioso();
  assert.strictEqual(f.gerados[0].force, true);
  assert.deepStrictEqual(f.revisados, [110]);
  assert.match(f.avisos[0].mensagem, /Revisão automática: 8\/10 itens OK/);
});

test('falha da IA: avisa a falha, limpa o registro e solta a trava', async () => {
  const f = fakes({ gerar: async () => { throw new Error('IA sem cota'); } });
  const g = criarGeracaoPeca(f.deps);
  g.pedir(pedido());
  await g.ocioso();
  assert.strictEqual(f.avisos[0].ok, false);
  assert.match(f.avisos[0].mensagem, /IA sem cota/);
  assert.strictEqual(f.pendentes.size, 0);
  assert.strictEqual(f.deps.trava.emAndamento(110), null);
});

test('ao voltar do reinício, retoma a geração interrompida e avisa que foi retomada', async () => {
  const f = fakes(); f.pendentes.set(110, { ...pedido(), tentativas: 0 });
  const g = criarGeracaoPeca(f.deps);
  assert.strictEqual(await g.retomar(), 1);
  await g.ocioso();
  assert.deepStrictEqual(f.gerados, [{ caseId: 110, userId: 1, force: true }]);
  assert.match(f.avisos[0].mensagem, /retomada/i);
  assert.strictEqual(f.pendentes.size, 0);
});

test('geração que já foi retomada 2 vezes não roda de novo (evita repetir sem fim) e avisa', async () => {
  const f = fakes(); f.pendentes.set(110, { ...pedido(), tentativas: 2 });
  const g = criarGeracaoPeca(f.deps);
  assert.strictEqual(await g.retomar(), 0);
  await g.ocioso();
  assert.strictEqual(f.gerados.length, 0);
  assert.strictEqual(f.avisos[0].ok, false);
  assert.match(f.avisos[0].mensagem, /peça de novo|pedir de novo/i);
  assert.strictEqual(f.pendentes.size, 0);
});

test('a retomada conta a tentativa no registro', async () => {
  let soltar; const f = fakes({ gerar: () => new Promise((r) => { soltar = () => r({ ok: true, version: 2 }); }) });
  f.pendentes.set(110, { ...pedido(), tentativas: 0 });
  const g = criarGeracaoPeca(f.deps);
  await g.retomar(); await espera();
  assert.strictEqual(f.pendentes.get(110).tentativas, 1);
  soltar(); await g.ocioso();
});

test('banco fora do ar não impede a geração', async () => {
  const f = fakes(); f.deps.pendentes.guardar = async () => { throw new Error('db'); }; f.deps.pendentes.apagar = async () => { throw new Error('db'); };
  const g = criarGeracaoPeca(f.deps);
  g.pedir(pedido());
  await g.ocioso();
  assert.strictEqual(f.gerados.length, 1);
  assert.strictEqual(f.avisos[0].ok, true);
});

test('o SQL do registro bate com as migrations (tabela e colunas existem)', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([path.resolve('src/services/geracaoPecaMysql.ts')]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('a geração aparece no painel de tarefas e termina com a confirmação (30/10/2026)', async () => {
  const eventos = [];
  const tarefa = (p, retomada) => { eventos.push(['inicio', p.alvo, retomada]); return { concluir: (m) => eventos.push(['ok', m]), falhar: (m) => eventos.push(['falhou', m]) }; };
  const f = fakes({ tarefa }); const g = criarGeracaoPeca(f.deps);
  g.pedir(pedido());
  await g.ocioso();
  assert.deepStrictEqual(eventos[0], ['inicio', 110, false]);
  assert.strictEqual(eventos[1][0], 'ok');
  assert.match(eventos[1][1], /v3 pronta/);

  const e2 = []; const f2 = fakes({ tarefa: () => ({ concluir: (m) => e2.push(['ok', m]), falhar: (m) => e2.push(['falhou', m]) }), gerar: async () => ({ ok: false, message: 'sem documentos' }) });
  const g2 = criarGeracaoPeca(f2.deps); g2.pedir(pedido()); await g2.ocioso();
  assert.deepStrictEqual(e2, [['falhou', 'sem documentos']]);
});
