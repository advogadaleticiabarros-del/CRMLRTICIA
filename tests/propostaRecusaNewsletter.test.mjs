// tests/propostaRecusaNewsletter.test.mjs
// Recusa de proposta (PATCH /:id/status, status='recusada') dispara uma
// mensagem de WhatsApp com botões Sim/Não perguntando sobre a newsletter, e
// grava uma pendência (whatsapp_pending_replies) pra o webhook correlacionar
// a resposta depois. Ver docs no topo de src/services/pendingWhatsappReplyService.ts.
//
// O envio em si (uazapi.sendMenu + createPendingReply) foi extraído para
// dispararRecusaProposta (src/services/propostaFollowupService.ts) — função
// compartilhada entre a rota de recusa manual, o botão "Recusar" da proposta
// expirada e o fechamento definitivo da 2ª janela (ver
// propostaExpiracaoExtensao.test.mjs). Este arquivo cobre: (1) a rota chama
// a função compartilhada com os dados certos, (2) a função compartilhada em
// si manda o menu certo e grava a pendência certa, (3) a correlação da
// resposta no webhook.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const propostasSrc = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
const webhookSrc = fs.readFileSync(path.resolve('src/routes/whatsapp-webhook.ts'), 'utf8');
const followupSrc = fs.readFileSync(path.resolve('src/services/propostaFollowupService.ts'), 'utf8');

function trecho(src, inicioRegex) {
  const m = src.match(inicioRegex);
  assert.ok(m, `trecho não encontrado: ${inicioRegex}`);
  return src.slice(m.index);
}

// ── Rota PATCH /:id/status ───────────────────────────────────────────────

test('PATCH /:id/status reaproveita dispararRecusaProposta (não duplica a mecânica de envio)', () => {
  assert.match(propostasSrc, /import\s*\{[^}]*dispararRecusaProposta[^}]*\}\s*from\s*'\.\.\/services\/propostaFollowupService'/,
    'deve importar dispararRecusaProposta do serviço de follow-up compartilhado');
});

test('PATCH /:id/status chama dispararRecusaProposta com os dados certos quando status=recusada', () => {
  const rota = trecho(propostasSrc, /router\.patch\('\/:id\/status'/);
  const bloco = rota.slice(0, rota.indexOf("router.post('/:id/accept'"));
  assert.match(bloco, /status === 'recusada'/, "precisa checar explicitamente o status 'recusada'");
  assert.match(bloco, /dispararRecusaProposta\(/, 'deve chamar a função compartilhada de recusa');
  const idx = bloco.indexOf('dispararRecusaProposta(');
  const chamada = bloco.slice(idx, bloco.indexOf('});', idx) + 1);
  assert.match(chamada, /leadId:\s*p\.lead_id/);
  assert.match(chamada, /clientId:\s*p\.client_id/);
  assert.match(chamada, /phone:\s*p\.phone/);
  assert.match(chamada, /propostaId:/);
});

test('PATCH /:id/status NÃO chama uazapi diretamente (mecânica de envio mora só no serviço compartilhado)', () => {
  const rota = trecho(propostasSrc, /router\.patch\('\/:id\/status'/);
  const bloco = rota.slice(0, rota.indexOf("router.post('/:id/accept'"));
  assert.doesNotMatch(bloco, /uazapi\.sendMenu\(/, 'não deve duplicar a chamada de envio — isso mora em dispararRecusaProposta');
});

// ── Serviço compartilhado: dispararRecusaProposta ───────────────────────

test('dispararRecusaProposta envia sendMenu tipo button com os ids de newsletter e grava a pendência certa', () => {
  const fn = trecho(followupSrc, /export async function dispararRecusaProposta/);
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(bloco, /uazapi\.sendMenu\(/, 'deve usar uazapi.sendMenu para os botões nativos');
  assert.match(bloco, /'button'/, "o menu deve ser do tipo 'button'");
  assert.match(bloco, /NEWSLETTER_BOTAO_SIM_ID/, 'deve usar a constante de id do botão Sim (não inventar string solta)');
  assert.match(bloco, /NEWSLETTER_BOTAO_NAO_ID/, 'deve usar a constante de id do botão Não (não inventar string solta)');
  assert.match(bloco, /createPendingReply\(/, 'deve gravar a pendência de confirmação');
  assert.match(bloco, /tipo:\s*'newsletter_opt_in'/, "o tipo da pendência deve ser 'newsletter_opt_in'");
  const idxSend = bloco.indexOf('uazapi.sendMenu(');
  const idxPending = bloco.indexOf('createPendingReply(');
  assert.ok(idxSend > -1 && idxPending > -1 && idxSend < idxPending,
    'o envio do menu deve acontecer antes de gravar a pendência (senão a pendência fica órfã se o envio falhar)');
});

test('dispararRecusaProposta nunca lança (best-effort) — envio dentro de try/catch', () => {
  const fn = trecho(followupSrc, /export async function dispararRecusaProposta/);
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  const tryIdx = bloco.indexOf('try {');
  const sendIdx = bloco.indexOf('uazapi.sendMenu(');
  assert.ok(tryIdx > -1 && tryIdx < sendIdx, 'o envio do menu de recusa precisa estar dentro de um try/catch');
  assert.match(bloco, /catch\s*\(e[:\s]*any\)/, 'precisa capturar erro do envio');
});

// ── Webhook: correlação da resposta ──────────────────────────────────────

test('webhook do WhatsApp valida o token ANTES de tratar a pendência de newsletter (não abre exceção de segurança)', () => {
  const idxToken = webhookSrc.indexOf('if (!compararSeguro(');
  const idxPendencia = webhookSrc.indexOf('await tratarPendenciaWhatsapp(phone, String(body))');
  assert.ok(idxToken > -1 && idxPendencia > -1, 'os dois trechos precisam existir no arquivo');
  assert.ok(idxToken < idxPendencia, 'a validação do token (compararSeguro) precisa vir antes de qualquer tratamento de pendência');
});

test('webhook só chama tratarPendenciaWhatsapp para mensagens que não são nossas (!msg.fromMe)', () => {
  const idx = webhookSrc.indexOf('await tratarPendenciaWhatsapp(phone, String(body))');
  assert.ok(idx > -1, 'chamada não encontrada');
  const antes = webhookSrc.slice(0, idx);
  const ultimoIf = antes.lastIndexOf('if (r.affectedRows === 1 && !msg.fromMe)');
  assert.ok(ultimoIf > -1 && ultimoIf < idx, 'a chamada deve estar dentro do bloco de mensagem nova e não-nossa');
});

test('webhook NÃO notifica "novo contato" quando a mensagem respondeu a uma pendência em aberto', () => {
  const idx = webhookSrc.indexOf('if (!clientId && !respondeuPendencia)');
  assert.ok(idx > -1, 'o guard precisa considerar respondeuPendencia, senão confunde resposta de proposta com lead novo');
  const trechoSeguinte = webhookSrc.slice(idx, idx + 200);
  assert.match(trechoSeguinte, /notifyNewWhatsappContact\(/, 'o guard precisa proteger justamente a chamada de notifyNewWhatsappContact');
});

test('processarRespostaNewsletter: "sim" atualiza leads.status ou clients.newsletter_opt_in, conforme o vínculo', () => {
  const fn = webhookSrc.slice(webhookSrc.indexOf('async function processarRespostaNewsletter'));
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(bloco, /UPDATE leads SET status = 'newsletter'/);
  assert.match(bloco, /UPDATE clients SET newsletter_opt_in = 1/);
  assert.match(bloco, /pending\.lead_id/);
  assert.match(bloco, /pending\.client_id/);
});

test('processarRespostaNewsletter: "não" NÃO cadastra nada, só audita via logActivity', () => {
  const fn = webhookSrc.slice(webhookSrc.indexOf('async function processarRespostaNewsletter'));
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  const idxElse = bloco.indexOf('} else {');
  const ramoNao = bloco.slice(idxElse);
  assert.doesNotMatch(ramoNao, /UPDATE leads SET status/, 'a recusa não pode alterar o status do lead');
  assert.doesNotMatch(ramoNao, /UPDATE clients SET newsletter_opt_in = 1/, 'a recusa não pode marcar opt-in do cliente');
  assert.match(ramoNao, /logActivity\(/, 'precisa auditar a recusa (não repetir a pergunta depois)');
  assert.match(ramoNao, /newsletter_recusado/, "eventType 'newsletter_recusado' pedido pela Letícia, pra ficar auditável");
});

test('tratarPendenciaWhatsapp resolve a pendência (não fica aberta pra sempre) quando reconhece sim/não', () => {
  const fn = webhookSrc.slice(webhookSrc.indexOf('async function tratarPendenciaWhatsapp'));
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(bloco, /resolvePendingReply\(/, 'precisa marcar a pendência como resolvida após processar');
  assert.match(bloco, /findOpenPendingReply\(/, 'precisa checar se existe pendência em aberto antes de fazer qualquer coisa');
});

test('tratarPendenciaWhatsapp também roteia pendências do tipo proposta_expirada', () => {
  const fn = webhookSrc.slice(webhookSrc.indexOf('async function tratarPendenciaWhatsapp'));
  const bloco = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(bloco, /pending\.tipo === 'proposta_expirada'/);
  assert.match(bloco, /processarRespostaPropostaExpirada\(/);
});
