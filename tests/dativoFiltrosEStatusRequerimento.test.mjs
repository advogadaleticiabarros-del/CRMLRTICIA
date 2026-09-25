// tests/dativoFiltrosEStatusRequerimento.test.mjs
// Pedido da Dra. Letícia (25/09/2026) no módulo Dativo:
// 1) pesquisar demandas pelo nome do assistido (representado);
// 2) filtrar por comarca;
// 3) novo status "aguardando_liberacao_requerimento" — cobre o meio-do-caminho
//    entre "concluida" (a nomeação/ato terminou, o honorário pode ou não já
//    ter sido arbitrado) e "a_receber" (o procedimento de recebimento JÁ foi
//    aberto). Antes esse meio-do-caminho não existia: só dava pra marcar
//    "a_receber" depois de registrar o requerimento, mas não tinha como
//    sinalizar "terminei, mas ainda não posso nem pedir o pagamento".
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { lerSchema, auditarArquivos } from './helpers/schemaAudit.mjs';

const migPath = path.resolve('migrations/135_dative_case_aguardando_requerimento.sql');
const routePath = path.resolve('src/routes/dative.ts');
const frontPath = path.resolve('public/app.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const frontSrc = fs.readFileSync(frontPath, 'utf8');

test('migration 135 existe e adiciona o novo status ao ENUM de dative_cases.status', () => {
  assert.ok(fs.existsSync(migPath), 'migration 135 não encontrada');
  const sql = fs.readFileSync(migPath, 'utf8');
  assert.match(sql, /aguardando_liberacao_requerimento/);
  assert.match(sql, /ALTER TABLE dative_cases/);
});

test('CASE_STATUS (validação de status) inclui o novo status', () => {
  assert.match(routeSrc, /CASE_STATUS\s*=\s*\[[^\]]*'aguardando_liberacao_requerimento'/);
});

test('GET /api/dative/cases aceita busca por nome do assistido e filtro de comarca', () => {
  const idx = routeSrc.indexOf("router.get('/cases'");
  const fim = routeSrc.indexOf('\n});', idx);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /assisted_name/);
  assert.match(bloco, /comarca/);
  assert.match(bloco, /LIKE/);
});

test('SQL de dative.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('tela de demandas dativas tem campo de busca por assistido e filtro de comarca', () => {
  const idx = frontSrc.indexOf('async function datDemandas');
  const fim = frontSrc.indexOf('\n}', frontSrc.indexOf('$(\'#new-dcase\').onclick', idx));
  const bloco = frontSrc.slice(idx, fim);
  assert.match(bloco, /dcase-busca|dcase-nome/);
  assert.match(bloco, /dcase-comarca/);
});

test('novo status aparece no select de filtro e no formulário de edição', () => {
  assert.match(frontSrc, /aguardando_liberacao_requerimento.*Aguardando liberação do requerimento|Aguardando liberação do requerimento.*aguardando_liberacao_requerimento/);
});
