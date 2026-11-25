// tests/pecaModelosImportObsidian.test.mjs
// Achado da pesquisa de módulos (22/09/2026): a biblioteca de peças (que
// alimenta a IA na hora de redigir) só era atualizada rodando
// scripts/import-pecas-obsidian.mjs manualmente no terminal — editar um
// modelo no Obsidian nunca chegava na IA sozinho. Agora existe um botão em
// Configurações ("Importar do Obsidian…") que faz o mesmo trabalho lendo a
// pasta escolhida no navegador. Testes:
//  1. as duas funções puras do front (parser de frontmatter + varredura de
//     pasta) isoladas e testadas de verdade (não só lidas por regex);
//  2. auditoria estática do backend novo (SQL, ordem de rota, uso do mesmo
//     stripDataUrlPrefix já usado no resto do sistema).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const frontendSrc = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const routePath = path.resolve('src/routes/pecaModelos.ts');
const routeSrc = fs.readFileSync(routePath, 'utf8');

// Isola as duas funções puras (sem DOM) exatamente como estão em produção —
// se alguém mudar o parser e quebrar o formato, este teste pega.
function carregarFuncoes() {
  const start = frontendSrc.indexOf('function parseFichaFrontmatter');
  const end = frontendSrc.indexOf('\nasync function importarFichasObsidian');
  assert.ok(start > -1 && end > start, 'funções parseFichaFrontmatter/encontrarFichasNaPasta não encontradas em app.js');
  const escopo = {};
  // eslint-disable-next-line no-new-func
  new Function('escopo', frontendSrc.slice(start, end) + '\nescopo.parseFichaFrontmatter = parseFichaFrontmatter; escopo.encontrarFichasNaPasta = encontrarFichasNaPasta;')(escopo);
  return escopo;
}

test('parseFichaFrontmatter lê chave simples, lista entre colchetes e valor entre aspas', () => {
  const { parseFichaFrontmatter } = carregarFuncoes();
  const fm = parseFichaFrontmatter(
    '---\ntitulo: Teste\narea: Trabalhista\nteses: [tese um, tese dois]\narquivo: "[[modelo.docx]]"\n---\nresto do texto'
  );
  assert.equal(fm.titulo, 'Teste');
  assert.equal(fm.area, 'Trabalhista');
  assert.deepEqual(fm.teses, ['tese um', 'tese dois']);
  assert.equal(fm.arquivo, '[[modelo.docx]]');
});

test('parseFichaFrontmatter devolve objeto vazio sem bloco --- ---', () => {
  const { parseFichaFrontmatter } = carregarFuncoes();
  assert.deepEqual(parseFichaFrontmatter('texto qualquer sem frontmatter'), {});
});

test('encontrarFichasNaPasta acha ficha em subpasta de área e ignora .md fora de Fichas/', () => {
  const { encontrarFichasNaPasta } = carregarFuncoes();
  const files = [
    { webkitRelativePath: 'Modelos de Peças/Trabalhista/Fichas/Reclamatoria.md' },
    { webkitRelativePath: 'Modelos de Peças/Trabalhista/modelo.docx' },
    { webkitRelativePath: 'Modelos de Peças/Consumidor/Fichas/Acao.md' },
    { webkitRelativePath: 'Modelos de Peças/_Sobre — Consumidor.md' },
  ];
  const { fichas } = encontrarFichasNaPasta(files);
  assert.equal(fichas.length, 2);
  assert.equal(fichas[0].vaultDir, 'Modelos de Peças/Trabalhista');
  assert.equal(fichas[0].nomeArquivo, 'Reclamatoria.md');
  assert.equal(fichas[1].vaultDir, 'Modelos de Peças/Consumidor');
});

test('SQL novo de pecaModelos.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('rota /resumo vem ANTES de /:id (senão "resumo" seria lido como id)', () => {
  const idxResumo = routeSrc.indexOf("router.get('/resumo'");
  const idxId = routeSrc.indexOf("router.get('/:id'");
  assert.ok(idxResumo > -1 && idxId > -1, 'rotas /resumo ou /:id não encontradas');
  assert.ok(idxResumo < idxId, "'/resumo' precisa ser registrada antes de '/:id' no Express");
});

// Desde 25/11/2026 a importação de uma ficha mora em services/pecaModelosImport.ts,
// usada pelo botão (import-ficha) e pela ponte do Obsidian (/api/obsidian-ponte/modelos).
const importSrc = fs.readFileSync(path.resolve('src/services/pecaModelosImport.ts'), 'utf8');

test('import-ficha delega para importarFichaModelo (mesma regra do botão e da ponte)', () => {
  const fn = routeSrc.match(/router\.post\('\/import-ficha'[\s\S]*?\n\}\);/);
  assert.ok(fn, 'rota /import-ficha não encontrada');
  assert.match(fn[0], /importarFichaModelo\(req\.body/);
});

test('importarFichaModelo usa stripDataUrlPrefix (mesmo padrão de documents.ts/acordos.ts), não regex própria', () => {
  assert.match(importSrc, /stripDataUrlPrefix\(f\.docx_base64\)/);
  assert.doesNotMatch(importSrc, /replace\(\/\^data:/, 'não deve reimplementar a extração de data URL na mão');
});

test('importarFichaModelo calcula embedding com aiEmbed (mesma função de findPecaModelo)', () => {
  assert.match(importSrc, /import \{ aiEmbed \} from '\.\/aiAssistant'/);
  assert.match(importSrc, /await aiEmbed\(/);
});

test('SQL de pecaModelosImport.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([path.resolve('src/services/pecaModelosImport.ts'), path.resolve('src/services/obsidianPonteServico.ts')]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('Configurações expõe o botão de importar e o seletor de pasta', () => {
  assert.match(frontendSrc, /Biblioteca de modelos de peça \(IA\)/);
  assert.match(frontendSrc, /id="pm-folder-picker"/);
  assert.match(frontendSrc, /webkitdirectory/);
});
