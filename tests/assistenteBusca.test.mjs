// Busca tolerante a erro de digitação do assistente do WhatsApp (08/10/2026):
// "mesmo que eu escreva errado ele consiga entender". Nomes de cliente, contas
// a pagar e documentos são achados por semelhança, não por igualdade.
import { test } from 'node:test';
import assert from 'node:assert';
import { encontrarClientes, escolherConta, escolherDocumento, normalizar } from '../dist/services/assistenteBusca.js';

const CLIENTES = [
  { id: 1, name: 'MAILZA DOS SANTOS COSTA' },
  { id: 2, name: 'JOSE LOURENCO RIBEIRO' },
  { id: 3, name: 'José de Paulo Silva' },
  { id: 4, name: 'ANA PAULA DOS SANTOS MAIA TERRA' },
  { id: 5, name: 'ANA MARIA DA SILVA' },
  { id: 6, name: 'Ana Clara Reis Siqueira' },
  { id: 7, name: 'Rachel Cristina Silva de Andrade' },
  { id: 8, name: 'Jéssica Layana dos Santos Araújo' },
];

test('normalizar: sem acento, minúsculo, só letras/números', () => {
  assert.strictEqual(normalizar('  JOSÉ  Lourenço-Ribeiro! '), 'jose lourenco ribeiro');
});

test('clientes: acha com erro de digitação e sem acento', () => {
  assert.strictEqual(encontrarClientes('Mailsa', CLIENTES).unico?.id, 1);
  assert.strictEqual(encontrarClientes('mailza costa', CLIENTES).unico?.id, 1);
  assert.strictEqual(encontrarClientes('jose lorenço', CLIENTES).unico?.id, 2);
  assert.strictEqual(encontrarClientes('raquel', CLIENTES).unico?.id, 7);
  assert.strictEqual(encontrarClientes('jessica layana', CLIENTES).unico?.id, 8);
  assert.strictEqual(encontrarClientes('ana paula', CLIENTES).unico?.id, 4);
  assert.strictEqual(encontrarClientes('ana maira', CLIENTES).unico?.id, 5);
});

test('clientes: nome ambíguo devolve opções, não chuta', () => {
  const r = encontrarClientes('ana', CLIENTES);
  assert.strictEqual(r.unico, null);
  assert.deepStrictEqual(r.opcoes.map((o) => o.id).sort(), [4, 5, 6]);
  const j = encontrarClientes('jose', CLIENTES);
  assert.strictEqual(j.unico, null);
  assert.ok(j.opcoes.length >= 2);
});

test('clientes: nada parecido → sem resultado', () => {
  const r = encontrarClientes('Fulano Beltrano', CLIENTES);
  assert.strictEqual(r.unico, null);
  assert.strictEqual(r.opcoes.length, 0);
});

const CONTAS = [
  { id: 10, descricao: 'Conta de luz EDP', valor: 312.4, vencimento: '2026-10-15' },
  { id: 11, descricao: 'Condomínio outubro', valor: 850, vencimento: '2026-10-10' },
  { id: 12, descricao: 'Internet Vivo', valor: 120, vencimento: '2026-10-20' },
];

test('conta a pagar: acha pela descrição com erro ou pelo valor', () => {
  assert.strictEqual(escolherConta({ descricao: 'conta de lus', valor: null }, CONTAS).unico?.id, 10);
  assert.strictEqual(escolherConta({ descricao: 'condominio', valor: null }, CONTAS).unico?.id, 11);
  assert.strictEqual(escolherConta({ descricao: '', valor: 120 }, CONTAS).unico?.id, 12);
  assert.strictEqual(escolherConta({ descricao: 'internet', valor: 120 }, CONTAS).unico?.id, 12);
  assert.strictEqual(escolherConta({ descricao: 'aluguel', valor: null }, CONTAS).unico, null);
});

const DOCS = [
  { id: 1, name: 'Procuração — Mailza', type: 'gerado', created_at: '2026-10-01' },
  { id: 2, name: 'Contrato de honorários assinado', type: 'anexo', created_at: '2026-10-02' },
  { id: 3, name: 'Petição inicial — proc. 5033118', type: 'peticao_inicial', created_at: '2026-09-02' },
  { id: 4, name: 'RG frente e verso', type: 'anexo', created_at: '2026-09-01' },
];

test('documento: entende sinônimos e erros (procuracao, contrato, inicial, identidade)', () => {
  assert.strictEqual(escolherDocumento('procuracao', DOCS)?.id, 1);
  assert.strictEqual(escolherDocumento('a procurassão', DOCS)?.id, 1);
  assert.strictEqual(escolherDocumento('contrato', DOCS)?.id, 2);
  assert.strictEqual(escolherDocumento('peticao inicial', DOCS)?.id, 3);
  assert.strictEqual(escolherDocumento('inicial', DOCS)?.id, 3);
  assert.strictEqual(escolherDocumento('identidade', DOCS)?.id, 4);
  assert.strictEqual(escolherDocumento('sentença', DOCS), null);
});
