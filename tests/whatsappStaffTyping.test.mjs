// tests/whatsappStaffTyping.test.mjs
// Ideia 3 da auditoria do módulo WhatsApp (23/09/2026): qualquer pessoa da
// equipe pode abrir e responder qualquer conversa ao mesmo tempo, sem nenhum
// aviso de "alguém já está respondendo esta". Usa a mesma ponte de tempo real
// (Socket.IO / emitWaUpdate) já usada pro indicador "digitando…" do CONTATO
// (whatsapp-webhook.ts:437) — aqui é o indicador equivalente entre membros
// da EQUIPE, nunca enviado ao WhatsApp de verdade (puramente interno).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/whatsapp-instance.ts');
const frontPath = path.resolve('public/whatsapp.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const frontSrc = fs.readFileSync(frontPath, 'utf8');

test('SQL novo não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('rota staff-typing existe e transmite quem está respondendo (não grava no banco)', () => {
  const idx = routeSrc.indexOf("router.post('/chats/:phone/staff-typing'");
  assert.ok(idx > -1, "rota POST '/chats/:phone/staff-typing' não encontrada");
  const fim = routeSrc.indexOf('\nrouter.', idx + 10);
  const bloco = routeSrc.slice(idx, fim > -1 ? fim : idx + 600);
  assert.match(bloco, /emitWaUpdate/, 'deveria transmitir via emitWaUpdate (tempo real), não gravar histórico');
  assert.match(bloco, /staffTyping/);
  assert.match(bloco, /req\.user!?\.id/, 'deveria identificar quem está digitando pelo usuário autenticado');
  assert.doesNotMatch(bloco, /INSERT INTO|UPDATE /, 'não deveria persistir em tabela — é só um aviso ao vivo, como o indicador de digitação do contato');
});

test('frontend avisa o backend enquanto a pessoa digita a resposta (com throttle, não a cada tecla)', () => {
  assert.match(frontSrc, /staff-typing/);
  const idx = frontSrc.indexOf('taTexto.oninput');
  assert.ok(idx > -1);
  const bloco = frontSrc.slice(idx - 600, idx + 200);
  assert.match(bloco, /setTimeout|Date\.now\(\)|throttle/i, 'deveria limitar a frequência de chamadas ao backend');
});

test('frontend mostra quem mais está respondendo a conversa aberta, ignorando o próprio usuário', () => {
  assert.match(frontSrc, /staffTyping/);
  assert.match(frontSrc, /wa-staff-typing/);
  const idx = frontSrc.indexOf('data.staffTyping');
  assert.ok(idx > -1, 'waOnUpdate deveria tratar data.staffTyping');
  const bloco = frontSrc.slice(idx - 50, idx + 500);
  assert.match(bloco, /USER\.id|USER\?\.id/, 'deveria comparar com o próprio usuário logado pra não avisar de si mesmo');
});
