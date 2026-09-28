// Reportado pela Dra. Letícia (28/09/2026): áudios que ELA envia (pelo celular,
// fora do CRM) não aparecem na conversa — só os que o cliente manda. Causa: o
// webhook só baixava/guardava mídia quando !msg.fromMe, e como áudio não tem
// texto, a mensagem inteira era descartada (`if (!body) return`).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const webhookPath = path.resolve('src/routes/whatsapp-webhook.ts');
const src = fs.readFileSync(webhookPath, 'utf8');
const ini = src.indexOf("router.post('/uazapi-webhook'");
const rota = src.slice(ini);

test('mídia enviada por nós (fromMe) também é tratada, não só a recebida', () => {
  const linha = rota.match(/const isMedia = [^\n]*/)[0];
  assert.doesNotMatch(linha, /!msg\.fromMe/);
  assert.match(linha, /mediaTypeNorm/);
});

test('mensagem nossa já gravada pelo envio do CRM (mesmo message_id) não baixa a mídia de novo', () => {
  assert.match(rota, /msg\.fromMe && msgId/);
  assert.match(rota, /SELECT id FROM whatsapp_messages WHERE message_id = \?/);
});

test('mídia nossa não vira "documento recebido" do cliente', () => {
  assert.match(rota, /registrarDocumento:\s*!msg\.fromMe/);
  assert.match(src, /registrarDocumento/);
});

test('falha ao baixar mídia nossa deixa aviso recuperável (mesma marca "falhou ao baixar")', () => {
  assert.match(rota, /Mídia enviada por você, mas falhou ao baixar \(tipo:/);
});

test('recuperação automática e manual cobrem mensagens nossas também', () => {
  const i = src.indexOf('export async function reprocessarMidiasFalhadas');
  const bloco = src.slice(i, src.indexOf('\n}', i));
  assert.doesNotMatch(bloco, /from_me = 0/);
  assert.match(bloco, /from_me/);
  const j = src.indexOf('export async function reprocessarMensagemMidia');
  assert.match(src.slice(j, src.indexOf('\n}', j)), /registrarDocumento: !msg\.from_me/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([webhookPath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
