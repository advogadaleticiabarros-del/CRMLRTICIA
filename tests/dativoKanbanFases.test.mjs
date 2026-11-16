// Pedido (16/11/2026): "EM DEMANDAS, QUERO LISTA DO JEITO QUE JA ESTA, E QUERO
// KANBAN POR FASE". A aba Demandas da Advocacia Dativa ganha um seletor
// Lista | Kanban. A lista continua igual; o kanban mostra uma coluna por fase
// (DATIVE_STATUS), usando os mesmos filtros e a mesma consulta.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const ini = src.indexOf('async function datDemandas(');
const demandas = src.slice(ini, src.indexOf('async function datAudiencias(', ini));

test('aba Demandas tem seletor Lista | Kanban por fase', () => {
  assert.match(demandas, /data-dcase-vista="lista"/);
  assert.match(demandas, /data-dcase-vista="kanban"/);
  assert.match(demandas, /aria-pressed/);
});

test('a lista continua com as mesmas colunas de antes', () => {
  assert.match(demandas, /<th>Comarca<\/th><th>Assistido<\/th><th>Assunto<\/th><th>Área<\/th><th>Nomeação<\/th><th>Estimado<\/th><th>Status<\/th>/);
});

test('kanban: uma coluna por fase do DATIVE_STATUS, mais Recusada', () => {
  assert.match(demandas, /DATIVE_STATUS\.map\(/);
  assert.match(demandas, /'recusada'/);
  assert.match(demandas, /class="dat-quadro dcase-kanban"/);
});

test('kanban usa os mesmos dados filtrados da lista e abre a ficha no clique', () => {
  assert.match(demandas, /renderKanban\(rows\)/);
  assert.match(demandas, /data-dcase="\$\{d\.id\}"/);
});

test('a escolha de vista é lembrada (localStorage protegido por try/catch)', () => {
  assert.match(demandas, /try \{[^}]*localStorage\.getItem\('dcase_vista'\)/);
  assert.match(demandas, /try \{[^}]*localStorage\.setItem\('dcase_vista'/);
});
