// tests/whatsappTriagemIA.test.mjs
// Triagem de conversas do WhatsApp (22/09/2026): parceiro reconhecido por
// telefone (sem IA) tem prioridade sobre a classificação de lead; mensagem
// "só cumprimento" vira sugestão (greeting_only) na conversa, nunca um envio
// automático. Testes estáticos (auditam o código-fonte, sem precisar de
// banco) — mesmo mecanismo de whatsappChatsQuery.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const webhookPath = path.resolve('src/routes/whatsapp-webhook.ts');
const instancePath = path.resolve('src/services/uazapiInstance.ts');
const partnersPath = path.resolve('src/routes/partners.ts');
const webhookSrc = fs.readFileSync(webhookPath, 'utf8');
const instanceSrc = fs.readFileSync(instancePath, 'utf8');
const partnersSrc = fs.readFileSync(partnersPath, 'utf8');

test('SQL novo da triagem não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([webhookPath, instancePath, partnersPath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('parceiro reconhecido por telefone tem prioridade sobre a triagem de lead', () => {
  const bloco = webhookSrc.match(/const ehParceiro[\s\S]*?detectarDadosParaProposta\(phone, String\(body\)\)\.catch\(\(\) => \{\}\);\s*\}/);
  assert.ok(bloco, 'bloco de decisão parceiro/lead não encontrado em whatsapp-webhook.ts');
  const idxParceiro = bloco[0].indexOf('ehParceiro');
  const idxNotify = bloco[0].indexOf('notifyNewWhatsappContact');
  assert.ok(idxParceiro < idxNotify, 'a checagem de parceiro precisa vir antes de notifyNewWhatsappContact');
  assert.match(bloco[0], /marcarComoParceiro\(phone\)/);
});

test('reconhecimento de parceiro é determinístico (telefone), não usa IA', () => {
  const fn = webhookSrc.match(/async function findPartnerPhoneMatch[\s\S]*?\n\}/);
  assert.ok(fn, 'findPartnerPhoneMatch não encontrada');
  assert.doesNotMatch(fn[0], /aiComplete|aiExtractFromFile|groq|gemini/i);
  assert.match(fn[0], /FROM partners/);
});

test('classificação da 1ª mensagem distingue só-cumprimento de caso real', () => {
  const fn = webhookSrc.match(/async function classificarPrimeiraMsg[\s\S]*?\n\}/);
  assert.ok(fn, 'classificarPrimeiraMsg não encontrada');
  assert.match(fn[0], /so_cumprimento/);
  assert.match(fn[0], /soCumprimento/);
});

test('mensagem "só cumprimento" nunca envia automaticamente — só marca sugestão', () => {
  const fn = webhookSrc.match(/async function notifyNewWhatsappContact[\s\S]*?\n\}/);
  assert.ok(fn, 'notifyNewWhatsappContact não encontrada');
  assert.match(fn[0], /soCumprimento/);
  assert.match(fn[0], /greeting_only/);
  // Garantia central do pedido da Dra. Letícia: esta função nunca chama envio.
  assert.doesNotMatch(fn[0], /sendText\(|uazapi\.sendText/);
});

test('qualquer envio nosso limpa a sugestão de saudação (greeting_only)', () => {
  const fnSend = instanceSrc.match(/export async function sendText[\s\S]*?\n\}/);
  assert.ok(fnSend, 'sendText não encontrada em uazapiInstance.ts');
  assert.match(fnSend[0], /greeting_only\s*=\s*0/);
});

test('cadastro de parceiro aceita e normaliza telefone', () => {
  assert.match(partnersSrc, /normalizePhone/);
  assert.match(partnersSrc, /INSERT INTO partners \(name, phone,/);
});
