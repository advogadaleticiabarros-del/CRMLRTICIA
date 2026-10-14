// tests/assistenteComandoProposta.test.mjs — "aprovar 123" no WhatsApp vai direto
// para o Produtor de proposta, sem passar pela IA nem pelas confirmações.
import { test } from 'node:test';
import assert from 'node:assert';
import { criarAssistente } from '../dist/services/assistenteWhatsapp.js';

const LETICIA = '5544991011402';

function montar(comercial) {
  const enviados = [];
  let iaChamada = false;
  const repo = {
    async comandantes() { return [LETICIA]; },
    async pendencias() { return []; },
    async historico() { return []; },
  };
  const ia = { async interpretar() { iaChamada = true; return null; }, async lerDocumento() { return null; }, async transcrever() { return null; } };
  const a = criarAssistente({ repo, ia, comercial, enviar: async (phone, texto) => { enviados.push({ phone, texto }); } });
  return { a, enviados, iaChamada: () => iaChamada };
}

test('comando de proposta: responde com o que o Produtor devolveu e não chama a IA', async () => {
  const recebidos = [];
  const t = montar({ async comando(phone, texto) { recebidos.push({ phone, texto }); return '✅ Proposta nº 123 enviada.'; } });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'aprovar 123' });
  assert.deepStrictEqual(recebidos, [{ phone: LETICIA, texto: 'aprovar 123' }]);
  assert.strictEqual(t.enviados[0].texto, '✅ Proposta nº 123 enviada.');
  assert.strictEqual(t.iaChamada(), false);
});

test('mensagem que não é comando de proposta segue o caminho normal do assistente', async () => {
  const t = montar({ async comando() { return null; } });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'qual minha agenda amanhã?' });
  assert.strictEqual(t.iaChamada(), true);
});

test('sem o Produtor ligado, nada muda', async () => {
  const t = montar(undefined);
  await t.a.atenderComandante({ phone: LETICIA, texto: 'aprovar 123' });
  assert.strictEqual(t.iaChamada(), true);
});
