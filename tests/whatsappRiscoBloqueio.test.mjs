// tests/whatsappRiscoBloqueio.test.mjs
// Ideia 2 da auditoria do módulo WhatsApp (23/09/2026): a integração usa um
// gateway não-oficial (Uazapi) — não existe mensagem-modelo pré-aprovada, só
// texto livre. A única proteção contra bloqueio do número era um atraso
// aleatório entre envios + teto diário; nada avisava quando a Uazapi já
// sinalizava risco de bloqueio de verdade (HTTP 463 — erro documentado pela
// própria Uazapi como "limite de mensagens novas"). Este teste audita que:
// 1) o erro HTTP carrega o status code (não só a mensagem de texto);
// 2) um 463 dispara um aviso PRÓPRIO, distinto do aviso genérico de falha de
//    envio, para o escritório poder agir antes de o número ser banido;
// 3) o Painel de Saúde expõe essa contagem separadamente.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const arquivos = [
  'src/services/uazapiClient.ts',
  'src/services/uazapiInstance.ts',
  'src/routes/whatsapp-instance.ts',
].map((f) => path.resolve(f));

test('SQL novo (risco de bloqueio) não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(arquivos);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('erro HTTP da Uazapi carrega o status code no objeto Error', () => {
  const src = fs.readFileSync(path.resolve('src/services/uazapiClient.ts'), 'utf8');
  const bloco = src.match(/async function request[\s\S]*?\n\}/);
  assert.ok(bloco, 'função request() não encontrada');
  assert.match(bloco[0], /\.status\s*=\s*res\.status/, 'o erro lançado deveria carregar res.status');
});

test('HTTP 463 (risco de bloqueio) dispara aviso próprio, distinto da falha genérica de envio', () => {
  const src = fs.readFileSync(path.resolve('src/services/uazapiInstance.ts'), 'utf8');
  assert.match(src, /avisarRiscoBloqueioWhatsapp/, 'deveria existir uma função dedicada de aviso de risco de bloqueio');
  assert.match(src, /whatsapp_risco_bloqueio/, "notification_type deveria ser 'whatsapp_risco_bloqueio'");
  assert.match(src, /463/, 'deveria checar especificamente o código 463');
});

test('aviso de risco de bloqueio é best-effort (nunca derruba o envio)', () => {
  const src = fs.readFileSync(path.resolve('src/services/uazapiInstance.ts'), 'utf8');
  const idx = src.indexOf('async function avisarRiscoBloqueioWhatsapp');
  assert.ok(idx > -1);
  const fim = src.indexOf('\nexport', idx + 10);
  const corpo = src.slice(idx, fim > -1 ? fim : idx + 1200);
  assert.match(corpo, /catch/, 'deveria ter try/catch (best-effort)');
});

test('Painel de Saúde expõe a contagem de risco de bloqueio separada da falha genérica', () => {
  const src = fs.readFileSync(path.resolve('src/routes/whatsapp-instance.ts'), 'utf8');
  assert.match(src, /whatsapp_risco_bloqueio/);
  assert.match(src, /risco_bloqueio_7d/);
});
