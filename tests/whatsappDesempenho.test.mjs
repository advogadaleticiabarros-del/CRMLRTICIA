// tests/whatsappDesempenho.test.mjs
// Ideia 4 da auditoria do módulo WhatsApp (23/09/2026), pedida explicitamente
// pela Dra. Letícia: "painel de desempenho de contato, do whatsapp" — tempo
// médio de resposta e volume de mensagens do atendimento geral (diferente do
// SLA de lead comercial, que é outra coisa). Painel novo em
// Auditoria → Desempenho, reaproveitando o gráfico de colunas (chartColumns)
// já usado no financeiro, sem introduzir biblioteca de gráfico nova.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/whatsapp-instance.ts');
const frontPath = path.resolve('public/whatsapp.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const frontSrc = fs.readFileSync(frontPath, 'utf8');

test('SQL novo (desempenho) não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('GET /desempenho existe e devolve tempo médio de resposta e volume por dia', () => {
  const idx = routeSrc.indexOf("router.get('/desempenho'");
  assert.ok(idx > -1, "rota GET '/desempenho' não encontrada");
  const fim = routeSrc.indexOf('\nrouter.', idx + 10);
  const bloco = routeSrc.slice(idx, fim > -1 ? fim : idx + 2500);
  assert.match(bloco, /tempo_medio_resposta_min/);
  assert.match(bloco, /volume_por_dia/);
});

test('cálculo de tempo de resposta usa uma janela de tempo (não corre a tabela inteira sem limite)', () => {
  const idx = routeSrc.indexOf("router.get('/desempenho'");
  const fim = routeSrc.indexOf('\nrouter.', idx + 10);
  const bloco = routeSrc.slice(idx, fim > -1 ? fim : idx + 2500);
  assert.match(bloco, /DATE_SUB\(NOW\(\),\s*INTERVAL\s*30\s*DAY\)/, 'deveria limitar a janela de cálculo (ex.: últimos 30 dias)');
});

test('frontend tem aba "Desempenho" na Auditoria, reaproveitando chartColumns', () => {
  assert.match(frontSrc, /data-sec="desempenho"/);
  assert.match(frontSrc, /renderDesempenho/);
  assert.match(frontSrc, /chartColumns\(/);
  assert.match(frontSrc, /desempenho:\s*renderDesempenho/, 'RENDER_SEC deveria mapear a nova seção');
});

test('painel mostra o tempo médio de resposta em minutos/horas legível, não só número cru', () => {
  const idx = frontSrc.indexOf('async function renderDesempenho') > -1
    ? frontSrc.indexOf('async function renderDesempenho')
    : frontSrc.indexOf('const renderDesempenho');
  assert.ok(idx > -1, 'renderDesempenho não encontrado');
  const fim = frontSrc.indexOf('\n  const render', idx + 20);
  const bloco = frontSrc.slice(idx, fim > -1 ? fim : idx + 2000);
  assert.match(bloco, /tempo_medio_resposta_min/);
});
