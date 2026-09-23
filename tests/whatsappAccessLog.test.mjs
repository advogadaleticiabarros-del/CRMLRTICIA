// tests/whatsappAccessLog.test.mjs
// Achado da auditoria do módulo WhatsApp (23/09/2026): abrir a ficha de um
// cliente gera log de acesso LGPD (access_logs), mas abrir a conversa de
// WhatsApp desse mesmo cliente — que pode ter CPF, endereço, relato de caso —
// não gerava nenhum registro. Esta rota (GET /chats/:phone, a que realmente
// carrega o histórico de mensagens) passa a chamar logAccess(), no mesmo
// padrão best-effort já usado em clients.ts (ficha_cliente).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/whatsapp-instance.ts');
const src = fs.readFileSync(routePath, 'utf8');

function rotaChatsPorTelefone() {
  // GET '/chats/:phone' (sem sufixo /notes ou /context) — pega o bloco até o próximo router.
  const idx = src.indexOf("router.get('/chats/:phone',");
  assert.ok(idx > -1, "rota GET '/chats/:phone' não encontrada");
  const fim = src.indexOf("\nrouter.", idx + 10);
  return src.slice(idx, fim > -1 ? fim : undefined);
}

test('GET /chats/:phone registra log de acesso LGPD (paridade com ficha_cliente)', () => {
  const bloco = rotaChatsPorTelefone();
  assert.match(bloco, /logAccess/, 'rota deveria chamar logAccess()');
  assert.match(bloco, /action:\s*'conversa_whatsapp'/, "action deveria ser 'conversa_whatsapp'");
});

test('log de acesso é best-effort (não usa await direto, tem .catch)', () => {
  const bloco = rotaChatsPorTelefone();
  const trecho = bloco.slice(bloco.indexOf('logAccess') - 200, bloco.indexOf('logAccess') + 300);
  assert.match(trecho, /\.catch\(/, 'chamada a logAccess deveria ser best-effort, com .catch()');
});

test('SQL novo de whatsapp-instance.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
