// tests/cerebro.test.mjs — Cérebro: biblioteca do escritório (cofre Obsidian)
import { test } from 'node:test';
import assert from 'node:assert';
import {
  lerNota, dividirEmTrechos, buscarTrechos, analisarCofre, montarPromptCerebro, deveIgnorar, blocoParaAgente,
} from '../dist/services/cerebro.js';

const NOTA = `---
tags: [trabalhista, modelo]
area: trabalhista
---
# Horas extras do vigilante

Tese da casa: escala 12x36 sem acordo coletivo válido gera horas extras após a 8ª diária.
Ver também [[Súmula 444 TST]] e [[Modelos/Inicial trabalhista|inicial]]. #jurisprudencia`;

test('lerNota: título, pasta, tags (frontmatter e #tag), links e conteúdo sem frontmatter', () => {
  const n = lerNota('Modelos de Peças/Trabalhista/Horas extras.md', NOTA);
  assert.strictEqual(n.titulo, 'Horas extras');
  assert.strictEqual(n.pasta, 'Modelos de Peças/Trabalhista');
  assert.deepStrictEqual(n.tags.sort(), ['jurisprudencia', 'modelo', 'trabalhista']);
  assert.deepStrictEqual(n.links.sort(), ['Modelos/Inicial trabalhista', 'Súmula 444 TST']);
  assert.ok(!n.conteudo.includes('tags:'));
  assert.match(n.conteudo, /escala 12x36/);
  assert.strictEqual(n.hash.length, 64);
});

test('lerNota: mesmo texto → mesmo hash; texto diferente → hash diferente', () => {
  assert.strictEqual(lerNota('a.md', 'x').hash, lerNota('a.md', 'x').hash);
  assert.notStrictEqual(lerNota('a.md', 'x').hash, lerNota('a.md', 'y').hash);
});

test('deveIgnorar: pastas internas do Obsidian, lixeira e arquivos que não são .md', () => {
  assert.strictEqual(deveIgnorar('.obsidian/workspace.json'), true);
  assert.strictEqual(deveIgnorar('.trash/velha.md'), true);
  assert.strictEqual(deveIgnorar('Anexos/foto.png'), true);
  assert.strictEqual(deveIgnorar('Clientes/Maria Teste.md'), false);
});

test('dividirEmTrechos: corta em parágrafos sem passar do tamanho e mantém o título em cada trecho', () => {
  const longo = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i} ` + 'texto '.repeat(40)).join('\n\n');
  const t = dividirEmTrechos('Nota grande', longo, 1200);
  assert.ok(t.length > 3);
  for (const x of t) {
    assert.ok(x.length <= 1300, `trecho com ${x.length}`);
    assert.match(x, /^Nota grande/);
  }
  assert.deepStrictEqual(dividirEmTrechos('Vazia', '   '), []);
});

const TRECHOS = [
  { id: 1, titulo: 'Horas extras do vigilante', pasta: 'Modelos', texto: 'escala 12x36 sem acordo coletivo gera horas extras vigilante', vetor: [1, 0, 0] },
  { id: 2, titulo: 'Maria Teste', pasta: 'Clientes', texto: 'Maria Teste, vigilante, demitida em 2025, processo trabalhista', vetor: [0.8, 0.2, 0] },
  { id: 3, titulo: 'Pensão alimentícia', pasta: 'Modelos', texto: 'revisão de alimentos binômio necessidade possibilidade', vetor: [0, 0, 1] },
];

test('buscarTrechos: por palavra, sem vetor, acha o trecho certo primeiro', () => {
  const r = buscarTrechos('horas extras 12x36', {}, TRECHOS, null, 2);
  assert.strictEqual(r[0].id, 1);
  assert.ok(r.every((x) => x.pontos > 0));
});

test('buscarTrechos: o contexto (cliente) puxa a nota do cliente para cima', () => {
  const sem = buscarTrechos('vigilante', {}, TRECHOS, null, 3).map((x) => x.id);
  const com = buscarTrechos('vigilante', { cliente: 'Maria Teste' }, TRECHOS, null, 3).map((x) => x.id);
  assert.strictEqual(com[0], 2);
  assert.ok(sem.includes(1));
});

test('buscarTrechos: com vetor da pergunta, o significado conta (acha sem palavra em comum)', () => {
  const r = buscarTrechos('pagamento de pensão do filho', {}, TRECHOS, [0, 0, 1], 1);
  assert.strictEqual(r[0].id, 3);
});

test('buscarTrechos: nada parecido → lista vazia (não inventa fonte)', () => {
  assert.deepStrictEqual(buscarTrechos('xyzzy qwerty', {}, TRECHOS, null, 3), []);
});

test('analisarCofre: links quebrados, notas órfãs, sem tag, vazias e títulos repetidos', () => {
  const notas = [
    lerNota('A.md', '# A\nliga em [[B]] e em [[Fantasma]]'),
    lerNota('B.md', '---\ntags: [x]\n---\nconteúdo de B'),
    lerNota('Sozinha.md', 'texto sem link nenhum'),
    lerNota('Pasta1/Repetida.md', 'um'),
    lerNota('Pasta2/Repetida.md', 'dois'),
    lerNota('Vazia.md', '   '),
  ];
  const r = analisarCofre(notas);
  assert.strictEqual(r.totalNotas, 6);
  assert.deepStrictEqual(r.linksQuebrados, [{ nota: 'A.md', link: 'Fantasma' }]);
  assert.ok(r.orfas.includes('Sozinha.md'));
  assert.ok(!r.orfas.includes('B.md')); // B recebe link de A
  assert.ok(r.semTags.includes('A.md'));
  assert.ok(!r.semTags.includes('B.md'));
  assert.deepStrictEqual(r.vazias, ['Vazia.md']);
  assert.deepStrictEqual(r.titulosRepetidos, [{ titulo: 'Repetida', caminhos: ['Pasta1/Repetida.md', 'Pasta2/Repetida.md'] }]);
  assert.ok(r.pastas.some((p) => p.pasta === '(raiz)'));
  assert.match(r.mapaDoCofre, /\[\[A\]\]/); // índice (MOC) pronto para colar no Obsidian
});

test('montarPromptCerebro: responde só com as notas, cita as fontes e admite quando não sabe', () => {
  const p = montarPromptCerebro('qual a tese de horas extras?', { cliente: 'Maria Teste' }, [{ ...TRECHOS[0], caminho: 'Modelos/Horas.md' }]);
  assert.match(p, /SOMENTE/);
  assert.match(p, /Modelos\/Horas\.md/);
  assert.match(p, /Maria Teste/);
  assert.match(p, /não encontrei/i);
});

test('blocoParaAgente: bloco curto com as notas para entrar no prompt de outro agente', () => {
  const b = blocoParaAgente([{ ...TRECHOS[0], caminho: 'Modelos/Horas.md' }]);
  assert.match(b, /BIBLIOTECA DO ESCRITÓRIO/);
  assert.match(b, /Modelos\/Horas\.md/);
  assert.strictEqual(blocoParaAgente([]), '');
});
