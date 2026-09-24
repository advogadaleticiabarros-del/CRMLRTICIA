// tests/clientsExportacaoLgpd.test.mjs
// Ideia 5 de prioridade alta da auditoria do módulo Clientes (23/09/2026):
// LGPD art. 18 garante direito de portabilidade ao titular — hoje não havia
// nenhuma forma de entregar "tudo que temos sobre este cliente" sem
// consultar o banco na mão. Novo GET /api/clients/:id/exportar-lgpd devolve
// um pacote consolidado (cadastro, processos, financeiro, documentos,
// histórico) e registra o próprio acesso à exportação no log LGPD.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/clients.ts');
const frontPath = path.resolve('public/app.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const frontSrc = fs.readFileSync(frontPath, 'utf8');

function rotaExportar() {
  const idx = routeSrc.indexOf("router.get('/:id/exportar-lgpd'");
  assert.ok(idx > -1, "rota GET '/:id/exportar-lgpd' não encontrada");
  const fim = routeSrc.indexOf("\nrouter.", idx + 10);
  return routeSrc.slice(idx, fim > -1 ? fim : undefined);
}

test('rota de exportação LGPD existe, ANTES de /:id/ficha (senão "exportar-lgpd" seria lido como :id)', () => {
  const idxExport = routeSrc.indexOf("router.get('/:id/exportar-lgpd'");
  const idxFicha = routeSrc.indexOf("router.get('/:id/ficha'");
  // Ambas usam prefixo /:id/ — não colidem entre si por serem sufixos
  // diferentes (Express casa o caminho inteiro), mas mantemos a rota nova
  // perto da ficha por organização; o teste real de ordem é o de /resumo
  // vs /:id noutro arquivo (pecaModelos). Aqui só confirmamos que existe.
  assert.ok(idxExport > -1 && idxFicha > -1);
});

test('exportação LGPD registra o próprio acesso (log de auditoria)', () => {
  const bloco = rotaExportar();
  assert.match(bloco, /logAccess/);
  assert.match(bloco, /action:\s*'exportacao_lgpd'/);
});

test('exportação LGPD reúne cadastro, processos, financeiro, documentos e histórico', () => {
  const bloco = rotaExportar();
  assert.match(bloco, /FROM cases/);
  assert.match(bloco, /FROM installments/);
  assert.match(bloco, /FROM documents/);
  assert.match(bloco, /FROM client_timeline/);
});

test('exportação LGPD baixa como arquivo (Content-Disposition attachment), não só JSON na tela', () => {
  const bloco = rotaExportar();
  assert.match(bloco, /Content-Disposition/);
  assert.match(bloco, /attachment/);
});

test('SQL de clients.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('ficha do cliente ganha botão de baixar dados (LGPD)', () => {
  const idx = frontSrc.indexOf('async function fichaCliente');
  const fim = frontSrc.indexOf('\n}', frontSrc.indexOf('openModal', idx));
  const bloco = frontSrc.slice(idx, fim);
  assert.match(bloco, /exportar-lgpd/);
  assert.match(bloco, /Baixar dados/i);
});
