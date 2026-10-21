// tests/leisSync.test.mjs — Pesquisa de Leis: baixar/atualizar o acervo (git simulado) e reindexar só o que mudou
import { test } from 'node:test';
import assert from 'node:assert';
import { abrirAcervo } from '../dist/services/leisAcervo.js';
import { atualizarAcervo } from '../dist/services/leisSync.js';

const lei = (n, texto) => `---\ntitulo: "Lei nº ${n}"\ntipo: "Lei Ordinária"\nnumero: "${n}"\ndata: 2020-01-01\nfonte: "x"\n---\n# Lei\n\n**Art. 1º** ${texto}\n`;
const C = (n) => `federal/leis-ordinarias/2020/lei-${n}-2020.md`;

function ambiente() {
  const arquivos = new Map();
  const estado = { clonado: false, head: 'c1', remoto: 'c1', diff: '', diffFalha: false, chamadas: [] };
  const deps = {
    dir: '/leis/acervo',
    acervo: abrirAcervo(':memory:'),
    windows: false,
    existe: (p) => p.endsWith('.git') ? estado.clonado : false,
    listar: () => [...arquivos.keys(), '.git/config', 'README.md'],
    lerArquivo: (abs) => arquivos.get(abs.replace(/^\/leis\/acervo\//, '')),
    git: async (args) => {
      estado.chamadas.push(args.join(' '));
      if (args[0] === 'clone') { estado.clonado = true; estado.head = estado.remoto; return ''; }
      const cmd = args.includes('-C') ? args.slice(2) : args;
      if (cmd[0] === 'rev-parse') return estado.head + '\n';
      if (cmd[0] === 'fetch') return '';
      if (cmd[0] === 'reset') { estado.head = estado.remoto; return ''; }
      if (cmd[0] === 'diff') { if (estado.diffFalha) throw new Error('objeto ausente'); return estado.diff; }
      return '';
    },
  };
  return { arquivos, estado, deps };
}

test('primeira vez: clona só as pastas do acervo e indexa tudo', async () => {
  const { arquivos, estado, deps } = ambiente();
  arquivos.set(C(1), lei(1, 'Primeira regra.'));
  arquivos.set(C(2), lei(2, 'Segunda regra.'));
  const r = await atualizarAcervo(deps);
  assert.ok(estado.chamadas[0].startsWith('clone --depth 1 --filter=blob:none --sparse'));
  assert.ok(estado.chamadas.some((c) => c.includes('sparse-checkout set --no-cone') && c.includes('/federal/leis-ordinarias/')));
  assert.ok(!estado.chamadas.some((c) => c.includes('!*:*')), 'no Linux não exclui nomes com ":"');
  assert.strictEqual(r.novos, 2);
  assert.strictEqual(r.completo, true);
  assert.strictEqual(deps.acervo.lerMeta('commit'), 'c1');
  assert.strictEqual(deps.acervo.resumo().normas, 2);
});

test('sem commit novo: não reindexa nada', async () => {
  const { arquivos, deps } = ambiente();
  arquivos.set(C(1), lei(1, 'Regra.'));
  await atualizarAcervo(deps);
  const r = await atualizarAcervo(deps);
  assert.strictEqual(r.semMudanca, true);
  assert.strictEqual(r.novos + r.atualizados + r.removidos, 0);
});

test('commit novo: indexa só o que o diff mostra (A/M) e tira o que foi apagado (D)', async () => {
  const { arquivos, estado, deps } = ambiente();
  arquivos.set(C(1), lei(1, 'Regra antiga.'));
  arquivos.set(C(2), lei(2, 'Vai sair.'));
  await atualizarAcervo(deps);
  arquivos.set(C(1), lei(1, 'Regra nova sobre aviso prévio.'));
  arquivos.set(C(3), lei(3, 'Lei nova.'));
  arquivos.delete(C(2));
  estado.remoto = 'c2';
  estado.diff = ['M', C(1), 'A', C(3), 'D', C(2), 'A', 'scripts/x.py', ''].join('\0');
  const r = await atualizarAcervo(deps);
  assert.ok(estado.chamadas.some((c) => c.startsWith('-C /leis/acervo fetch --depth 1')));
  assert.strictEqual(r.completo, false);
  assert.deepStrictEqual([r.novos, r.atualizados, r.removidos], [1, 1, 1]);
  assert.strictEqual(deps.acervo.lerMeta('commit'), 'c2');
  assert.strictEqual(deps.acervo.buscar('aviso previo')[0].rotulo, 'Art. 1º');
});

test('diff falhou ou índice fora de sincronia: confere tudo (tira do índice o que não existe mais)', async () => {
  const { arquivos, estado, deps } = ambiente();
  arquivos.set(C(1), lei(1, 'Um.'));
  arquivos.set(C(2), lei(2, 'Dois.'));
  await atualizarAcervo(deps);
  arquivos.delete(C(2));
  estado.remoto = 'c3';
  estado.diffFalha = true;
  const r = await atualizarAcervo(deps);
  assert.strictEqual(r.completo, true);
  assert.strictEqual(r.removidos, 1);
  assert.strictEqual(r.iguais, 1);
  assert.strictEqual(deps.acervo.resumo().normas, 1);
});

test('regras de leitura mudaram (nova versão): relê todos os arquivos, mesmo sem mudança no git', async () => {
  const { arquivos, deps } = ambiente();
  arquivos.set(C(1), lei(1, 'Um.'));
  await atualizarAcervo(deps);
  deps.acervo.definirMeta('versao_regras', '0');
  const r = await atualizarAcervo(deps);
  assert.strictEqual(r.completo, true);
  assert.strictEqual(r.atualizados, 1, 'mesmo conteúdo, relido com as regras novas');
  assert.notStrictEqual(deps.acervo.lerMeta('versao_regras'), '0');
});

test('no Windows (teste local), exclui nomes de arquivo que o Windows não aceita', async () => {
  const { estado, deps } = ambiente();
  deps.windows = true;
  await atualizarAcervo(deps);
  assert.ok(estado.chamadas.some((c) => c.includes('sparse-checkout set') && c.includes('!*:*')));
});
