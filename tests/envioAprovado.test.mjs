// tests/envioAprovado.test.mjs — o que sai quando a equipe aprova uma mensagem da fila.
// Desde 20/10/2026 as automações antigas (acompanhamento de proposta, recusa,
// expiração, aceite com PIX, newsletter, e-book) também passam pela aprovação.
// A mensagem aprovada sai do jeito que a automação montou: texto, com botões
// (e a pendência que o webhook espera) ou com o botão de PIX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarEnvioAprovado, lerEnvio } from '../dist/services/envioAprovado.js';

function depsFalsas({ falhaMenu = false, falhaTexto = false } = {}) {
  const chamadas = [];
  return {
    chamadas,
    deps: {
      sendText: async (phone, texto, sentBy) => { chamadas.push(['texto', phone, texto, sentBy]); return !falhaTexto; },
      sendMenu: async (phone, texto, botoes) => { chamadas.push(['menu', phone, texto, botoes]); if (falhaMenu) throw new Error('uazapi fora'); },
      sendPix: async (phone, chave, nome, tipo) => { chamadas.push(['pix', phone, chave, nome, tipo]); return true; },
      criarPendencia: async (p) => { chamadas.push(['pendencia', p]); },
    },
  };
}

test('texto simples: um envio, com quem aprovou', async () => {
  const { chamadas, deps } = depsFalsas();
  assert.equal(await executarEnvioAprovado('5527999990000', 'Olá!', { tipo: 'texto' }, 'Automação (aprovado por Jessica)', deps), true);
  assert.deepEqual(chamadas, [['texto', '5527999990000', 'Olá!', 'Automação (aprovado por Jessica)']]);
});

test('botões: manda o menu com o texto aprovado e só depois grava a pendência', async () => {
  const { chamadas, deps } = depsFalsas();
  const envio = { tipo: 'botoes', botoes: ['Sim|newsletter_sim', 'Não|newsletter_nao'],
    pendencia: { tipo: 'newsletter_opt_in', leadId: 7, clientId: null, propostaId: 3, expectedYes: 'newsletter_sim', expectedNo: 'newsletter_nao' } };
  assert.equal(await executarEnvioAprovado('5527999990000', 'Texto editado', envio, 'x', deps), true);
  assert.deepEqual(chamadas.map((c) => c[0]), ['menu', 'pendencia']);
  assert.deepEqual(chamadas[0].slice(1), ['5527999990000', 'Texto editado', ['Sim|newsletter_sim', 'Não|newsletter_nao']]);
  assert.equal(chamadas[1][1].phone, '5527999990000');
  assert.equal(chamadas[1][1].tipo, 'newsletter_opt_in');
  assert.equal(chamadas[1][1].propostaId, 3);
});

test('botões: se o WhatsApp falhar, não grava pendência e devolve falso', async () => {
  const { chamadas, deps } = depsFalsas({ falhaMenu: true });
  const envio = { tipo: 'botoes', botoes: ['Sim|a', 'Não|b'], pendencia: { tipo: 't', expectedYes: 'a', expectedNo: 'b' } };
  assert.equal(await executarEnvioAprovado('5527999990000', 'x', envio, 'x', deps), false);
  assert.deepEqual(chamadas.map((c) => c[0]), ['menu']);
});

test('texto com PIX: o botão de PIX só vai se o texto foi', async () => {
  const ok = depsFalsas();
  const envio = { tipo: 'texto_pix', pix: { chave: '00000000000', nome: 'Fulana Teste', tipoChave: 'CPF' } };
  assert.equal(await executarEnvioAprovado('5527999990000', 'Aceite', envio, 'x', ok.deps), true);
  assert.deepEqual(ok.chamadas.map((c) => c[0]), ['texto', 'pix']);
  const falha = depsFalsas({ falhaTexto: true });
  assert.equal(await executarEnvioAprovado('5527999990000', 'Aceite', envio, 'x', falha.deps), false);
  assert.deepEqual(falha.chamadas.map((c) => c[0]), ['texto']);
});

test('lerEnvio: vazio, inválido ou desconhecido vira texto simples', () => {
  assert.deepEqual(lerEnvio(null), { tipo: 'texto' });
  assert.deepEqual(lerEnvio('{quebrado'), { tipo: 'texto' });
  assert.deepEqual(lerEnvio({ tipo: 'outro' }), { tipo: 'texto' });
  assert.deepEqual(lerEnvio({ tipo: 'botoes', botoes: [] }), { tipo: 'texto' }, 'menu sem botão não existe');
  assert.equal(lerEnvio('{"tipo":"botoes","botoes":["Sim|a"]}').tipo, 'botoes');
});
