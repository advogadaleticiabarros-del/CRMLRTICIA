// tests/obsidianPonte.test.mjs — Ponte do Obsidian (25/11/2026).
// O cofre fica no computador do escritório; o CRM, na VPS. Um programa no
// computador (scripts/ponte-obsidian/ponte.mjs) mantém os dois em dia sozinho:
// cofre → CRM (Cérebro e modelos de peças) e CRM → cofre (Clientes/, manual,
// Mapa do cofre). Regras do servidor em src/services/obsidianPonte.ts.
// Dados FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  nomeSeguro, montarNotaCliente, arquivosDoEspelho, situacaoPonte, deveAvisarQueda,
} from '../dist/services/obsidianPonte.js';

const ponte = await import(pathToFileURL(path.resolve('scripts/ponte-obsidian/ponte.mjs')).href);

const CLIENTE = { id: 7, name: 'Maria: da Silva/Teste', cpf_cnpj: '000.000.000-00', address: 'Rua Fictícia, 1', phone: null, email: null, tipo: 'PF' };
const caso = (o = {}) => ({
  id: 1, case_number: '0000001-00.2026.8.08.0001', title: 'Revisional', legal_area: 'consumidor', polo_cliente: 'ativo',
  production_labels: '', description: 'Resumo do caso.', valor_causa: 1000, valor_obtido: 500, resultado: 'acordo',
  resultado_em: '2026-10-01', acordos: [], lancamentos: [], repasses: [], partes: [], documentos: [], ...o,
});

// ── Servidor: nota do cliente ────────────────────────────────────────────────

test('nomeSeguro tira caracteres proibidos no Windows, pontos e espaços no fim', () => {
  assert.equal(nomeSeguro('Maria: da Silva/Teste'), 'Maria da SilvaTeste');
  assert.equal(nomeSeguro('  João   Paulo.. '), 'João Paulo');
  assert.equal(nomeSeguro('../..'), 'sem nome');
  assert.ok(nomeSeguro('x'.repeat(200)).length <= 90);
});

test('uma nota por cliente reúne TODOS os casos (antes o segundo caso apagava o primeiro)', () => {
  const n = montarNotaCliente(CLIENTE, [caso(), caso({ id: 2, case_number: '0000002-00.2026.8.08.0001', title: 'Alimentos' })]);
  assert.equal(n.caminho, 'Clientes/Maria da SilvaTeste/Maria da SilvaTeste.md');
  assert.match(n.texto, /## Processo 0000001-00/);
  assert.match(n.texto, /## Processo 0000002-00/);
  assert.match(n.texto, /^---\ncliente: "Maria: da Silva\/Teste"/);
  assert.match(n.texto, /tags: \[cliente, crm\]/);
});

test('a nota não muda de um dia para o outro sem mudança no CRM (sem data de geração)', () => {
  const a = montarNotaCliente(CLIENTE, [caso()]);
  const b = montarNotaCliente(CLIENTE, [caso()]);
  assert.equal(a.texto, b.texto);
  assert.doesNotMatch(a.texto, /Gerado do CRM em/);
});

test('anexos ganham caminho dentro de anexos/ com o id e a extensão certa', () => {
  const n = montarNotaCliente(CLIENTE, [caso({ documentos: [
    { id: 31, name: 'Sentença: final', mime: 'application/pdf' },
    { id: 32, name: 'foto', mime: 'image/jpeg' },
  ] })]);
  assert.deepEqual(n.anexos, [
    { id: 31, caminho: 'Clientes/Maria da SilvaTeste/anexos/Sentença final #31.pdf' },
    { id: 32, caminho: 'Clientes/Maria da SilvaTeste/anexos/foto #32.jpg' },
  ]);
  assert.match(n.texto, /\[\[anexos\/Sentença final #31\.pdf\]\]/);
});

test('financeiro e partes entram na nota', () => {
  const n = montarNotaCliente(CLIENTE, [caso({
    acordos: [{ opposing_party: 'Banco Fictício', total_agreement_value: 900, honorarium_percentage: 30, honorarium_value: 270, sucumbencia_value: 0, status: 'ativo' }],
    lancamentos: [{ description: 'Parcela 1', valor: 300, due_date: '2026-11-01', status: 'pago', paid_at: '2026-11-02' }],
    repasses: [{ tranche_label: '1/3', valor_bruto: 300, valor_honorarios: 90, valor_liquido: 210, status: 'pago', data_repasse: '2026-11-03' }],
    partes: [{ papel: 'Réu', nome: 'Banco Fictício', cpf_cnpj: null, advogado: null, advogado_oab: null }],
  })]);
  assert.match(n.texto, /\*\*Acordo\*\* com Banco Fictício/);
  assert.match(n.texto, /\| Parcela 1 \|/);
  assert.match(n.texto, /\| 1\/3 \|/);
  assert.match(n.texto, /\*\*Réu:\*\* Banco Fictício/);
});

// ── Servidor: espelho do manual ──────────────────────────────────────────────

test('espelho: manual vai para Documentação Técnica, ficha e mapa na raiz', () => {
  const a = arquivosDoEspelho([{ nome: '00-visao-geral.md', texto: 'a' }, { nome: '../fora.md', texto: 'x' }, { nome: 'img.png', texto: 'x' }], 'ficha', 'mapa');
  assert.deepEqual(a, [
    { caminho: 'Documentação Técnica/00-visao-geral.md', texto: 'a' },
    { caminho: 'Escritório Virtual.md', texto: 'ficha' },
    { caminho: 'Mapa do cofre.md', texto: 'mapa' },
  ]);
  assert.deepEqual(arquivosDoEspelho([], null, null), []);
});

// ── Servidor: sinal de vida ──────────────────────────────────────────────────

test('situação: nunca ligada, conectada (até 30 min) ou parada', () => {
  const agora = new Date('2026-11-25T12:00:00Z');
  assert.equal(situacaoPonte(null, agora).estado, 'nunca');
  assert.equal(situacaoPonte(new Date('2026-11-25T11:40:00Z'), agora).estado, 'conectada');
  const p = situacaoPonte(new Date('2026-11-25T10:00:00Z'), agora);
  assert.equal(p.estado, 'parada');
  assert.equal(p.minutos, 120);
});

test('avisa a queda só depois de 24 h sem sinal e uma vez por queda', () => {
  const agora = new Date('2026-11-26T13:00:00Z');
  const sinal = new Date('2026-11-25T12:00:00Z');
  assert.equal(deveAvisarQueda(null, null, agora), false, 'nunca ligada não é queda');
  assert.equal(deveAvisarQueda(new Date('2026-11-26T00:00:00Z'), null, agora), false, 'menos de 24 h');
  assert.equal(deveAvisarQueda(sinal, null, agora), true);
  assert.equal(deveAvisarQueda(sinal, new Date('2026-11-26T12:30:00Z'), agora), false, 'já avisou desta queda');
  assert.equal(deveAvisarQueda(sinal, new Date('2026-11-20T00:00:00Z'), agora), true, 'aviso antigo é de outra queda');
});

// ── Computador: regras da ponte ──────────────────────────────────────────────

test('caminhoDentro recusa caminho que sai do cofre ou da pasta permitida', () => {
  const base = path.resolve(os.tmpdir(), 'cofre-x');
  assert.equal(ponte.caminhoDentro(base, 'Clientes/A/A.md'), path.join(base, 'Clientes', 'A', 'A.md'));
  assert.equal(ponte.caminhoDentro(base, '../fora.md'), null);
  assert.equal(ponte.caminhoDentro(base, 'Clientes/../../fora.md'), null);
  assert.equal(ponte.caminhoDentro(base, 'C:/Windows/x.md'), null);
  assert.equal(ponte.caminhoDentro(base, '/etc/x'), null);
  assert.equal(ponte.caminhoDentro(base, ''), null);
});

test('o CRM só escreve onde é dono: Clientes/, Documentação Técnica/, ficha e mapa', () => {
  assert.equal(ponte.escritaPermitida('Clientes/A/A.md'), true);
  assert.equal(ponte.escritaPermitida('Clientes/A/anexos/x #1.pdf'), true);
  assert.equal(ponte.escritaPermitida('Documentação Técnica/00-visao-geral.md'), true);
  assert.equal(ponte.escritaPermitida('Escritório Virtual.md'), true);
  assert.equal(ponte.escritaPermitida('Mapa do cofre.md'), true);
  assert.equal(ponte.escritaPermitida('Modelos de Peças/x.md'), false);
  assert.equal(ponte.escritaPermitida('Documentação Técnica/sub/x.md'), false);
  assert.equal(ponte.escritaPermitida('.obsidian/app.json'), false);
});

test('notas do Cérebro: só .md, fora de pastas ocultas', () => {
  assert.equal(ponte.ehNota('Pesquisas/a.md'), true);
  assert.equal(ponte.ehNota('.obsidian/x.md'), false);
  assert.equal(ponte.ehNota('.trash/x.md'), false);
  assert.equal(ponte.ehNota('anexos/x.pdf'), false);
  assert.equal(ponte.ehFicha('Modelos de Peças/Trabalhista/Fichas/Horas extras.md'), true);
  assert.equal(ponte.ehFicha('Modelos de Peças/Trabalhista/Horas extras.md'), false);
});

test('não apaga notas do Cérebro se o cofre "encolheu" de repente (pasta fora do ar)', () => {
  assert.equal(ponte.podeApagarAusentes(400, 395), true);
  assert.equal(ponte.podeApagarAusentes(400, 100), false);
  assert.equal(ponte.podeApagarAusentes(0, 10), true);
  assert.equal(ponte.podeApagarAusentes(400, 0), false);
});

test('plano de Clientes/: escreve o que mudou, baixa anexo novo, apaga o que saiu', () => {
  const indice = [
    { caminho: 'Clientes/A/A.md', texto: 'nova', anexos: [{ id: 1, caminho: 'Clientes/A/anexos/x #1.pdf' }] },
    { caminho: 'Clientes/B/B.md', texto: 'igual', anexos: [] },
  ];
  const locais = new Map([
    ['Clientes/A/A.md', 'velha'],
    ['Clientes/B/B.md', 'igual'],
    ['Clientes/C/C.md', 'saiu'],
    ['Clientes/C/anexos/y #9.pdf', null],
  ]);
  const p = ponte.planoClientes(indice, locais);
  assert.deepEqual(p.escrever, [{ caminho: 'Clientes/A/A.md', texto: 'nova' }]);
  assert.deepEqual(p.baixar, [{ id: 1, caminho: 'Clientes/A/anexos/x #1.pdf' }]);
  assert.deepEqual(p.apagar.sort(), ['Clientes/C/C.md', 'Clientes/C/anexos/y #9.pdf']);
});

test('plano de Clientes/ com índice vazio não apaga nada (CRM fora do ar ou erro)', () => {
  const p = ponte.planoClientes([], new Map([['Clientes/A/A.md', 'x']]));
  assert.deepEqual(p.apagar, []);
});

test('plano de Clientes/ ignora caminho do servidor fora de Clientes/', () => {
  const p = ponte.planoClientes([{ caminho: 'Modelos de Peças/x.md', texto: 'x', anexos: [{ id: 2, caminho: '../y.pdf' }] }], new Map());
  assert.deepEqual(p.escrever, []);
  assert.deepEqual(p.baixar, []);
});

test('frontmatter da ficha: valor simples, lista em linha e lista em várias linhas', () => {
  const fm = ponte.lerFrontmatter('---\narea: Trabalhista\narquivo: "[[Horas.docx]]"\nfundamentos: [CLT, Súmula 85]\nteses:\n  - "[[Tese A]]"\n  - Tese B\n---\ntexto');
  assert.equal(fm.area, 'Trabalhista');
  assert.equal(fm.arquivo, '[[Horas.docx]]');
  assert.deepEqual(fm.fundamentos, ['CLT', 'Súmula 85']);
  assert.deepEqual(fm.teses, ['Tese A', 'Tese B']);
  assert.deepEqual(ponte.lerFrontmatter('sem frontmatter'), {});
});

test('listarArquivos percorre o cofre e devolve caminhos com barra normal', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-'));
  fs.mkdirSync(path.join(base, 'Pesquisas'), { recursive: true });
  fs.mkdirSync(path.join(base, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(base, 'Pesquisas', 'a.md'), 'a');
  fs.writeFileSync(path.join(base, '.obsidian', 'app.json'), '{}');
  fs.writeFileSync(path.join(base, 'raiz.md'), 'r');
  assert.deepEqual(ponte.listarArquivos(base).sort(), ['Pesquisas/a.md', 'raiz.md']);
});
