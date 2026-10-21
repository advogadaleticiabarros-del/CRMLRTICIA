// tests/assistenteConsultaLei.test.mjs — "art 482 clt" no WhatsApp da Dra. responde com o texto oficial,
// direto do acervo de leis, sem passar pela IA do assistente.
import { test } from 'node:test';
import assert from 'node:assert';
import { criarAssistente } from '../dist/services/assistenteWhatsapp.js';
import { abrirAcervo } from '../dist/services/leisAcervo.js';
import { criarPesquisa } from '../dist/services/leisPesquisa.js';

const LETICIA = '5544991011402';

function montar(leis) {
  const enviados = [];
  let iaChamada = false;
  const repo = { async comandantes() { return [LETICIA]; }, async pendencias() { return []; }, async historico() { return []; } };
  const ia = { async interpretar() { iaChamada = true; return null; }, async lerDocumento() { return null; }, async transcrever() { return null; } };
  const a = criarAssistente({ repo, ia, leis, enviar: async (phone, texto) => { enviados.push(texto); } });
  return { a, enviados, iaChamada: () => iaChamada };
}

function pesquisa() {
  const ac = abrirAcervo(':memory:');
  ac.indexarArquivo('federal/decretos-lei/1943/del-5452-1943-05-01.md', '---\ntitulo: "Decreto-Lei nº 5.452 de 01/05/1943"\ntipo: "Decreto-Lei"\nnumero: "5452"\ndata: 1943-05-01\nfonte: "https://normas.leg.br/clt"\n---\n# CLT\n\n**Art. 482.** Constituem justa causa para rescisão do contrato: i) abandono de emprego.\n');
  return criarPesquisa({ acervo: ac, ia: async () => ({ ok: false }), registrar: () => {} });
}

test('consultaRapida: só responde o que é pedido de lei; devolve texto oficial com a citação e a fonte', () => {
  const p = pesquisa();
  const r = p.consultaRapida('art 482 clt');
  assert.match(r, /art\. 482 da CLT/);
  assert.match(r, /abandono de emprego/);
  assert.match(r, /normas\.leg\.br\/clt/);
  assert.match(p.consultaRapida('lei art. 482 da CLT'), /abandono/);
  assert.match(p.consultaRapida('art 999 clt'), /Não achei/);
  assert.strictEqual(p.consultaRapida('qual minha agenda amanhã?'), null);
  assert.strictEqual(p.consultaRapida('recebi 500 da Fulana'), null);
});

test('assistente: pedido de lei responde direto, sem chamar a IA', async () => {
  const p = pesquisa();
  const t = montar({ consultar: async (texto) => p.consultaRapida(texto) });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'art 482 clt' });
  assert.match(t.enviados[0], /abandono de emprego/);
  assert.strictEqual(t.iaChamada(), false);
});

test('assistente: o resto segue para a IA, e sem acervo ligado nada muda', async () => {
  const p = pesquisa();
  const t = montar({ consultar: async (texto) => p.consultaRapida(texto) });
  await t.a.atenderComandante({ phone: LETICIA, texto: 'qual minha agenda amanhã?' });
  assert.strictEqual(t.iaChamada(), true);
  const t2 = montar(undefined);
  await t2.a.atenderComandante({ phone: LETICIA, texto: 'art 482 clt' });
  assert.strictEqual(t2.iaChamada(), true);
});
