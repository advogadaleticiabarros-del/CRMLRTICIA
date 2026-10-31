// tests/transcricaoDocumento.test.mjs — incidente de 31/10/2026 (Valmirio/Itaú, demonstrativo
// com R$ 0,00 "mesmo com todos os documentos"). Os documentos do caso são links do Google
// Drive, e o Drive era lido com um pedido de RESUMO ("em tópicos curtos"): do extrato de
// empréstimos (HISCON) sobrava o cabeçalho, sem parcela, início e data de inclusão de cada
// contrato; do histórico de créditos, alguns valores "entre outros". Sem isso o Calculista
// não liga desconto a contrato. A transcrição integral só valia para arquivo guardado no banco.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { promptLeituraArquivo, rotuloLeitura, resumoAntigoDeExtrato, PROMPT_TRANSCRICAO } from '../dist/services/transcricaoDocumento.js';

test('PDF e foto do Drive: transcrição integral, com as colunas do HISCON', () => {
  for (const mime of ['application/pdf', 'image/jpeg']) {
    const p = promptLeituraArquivo(mime);
    assert.strictEqual(p, PROMPT_TRANSCRICAO);
    assert.match(p, /INTEGRALMENTE/);
    assert.match(p, /valor da parcela/);
    assert.doesNotMatch(p, /tópicos curtos/);
  }
});

test('áudio continua com a transcrição de áudio', () => {
  assert.match(promptLeituraArquivo('audio/ogg'), /ÁUDIO/);
});

test('rótulo novo distingue a transcrição do resumo antigo', () => {
  assert.strictEqual(rotuloLeitura('application/pdf', 'HISCON.pdf'), '[Transcrito por IA de "HISCON.pdf"]');
  assert.strictEqual(rotuloLeitura('audio/ogg', 'audio.ogg'), '[Transcrição por IA de "audio.ogg"]');
});

test('resumo antigo de extrato do INSS é relido; o resto fica como está', () => {
  const resumo = (t) => `[Extraído por IA de "x.pdf"]\n${t}`;
  assert.ok(resumoAntigoDeExtrato(resumo('- Tipo: extrato'), 'EXTRATO_DE_EMPRESTIMO_CONSIGNADO.pdf'));
  assert.ok(resumoAntigoDeExtrato(resumo('- Tipo: Histórico de Créditos do INSS'), 'doc 12.pdf'));
  assert.ok(resumoAntigoDeExtrato(resumo('- Documento: HISCON, 10 contratos ativos'), 'arquivo.pdf'));
  assert.ok(resumoAntigoDeExtrato(resumo('- Rubrica 216 CONSIGNACAO EMPRESTIMO BANCARIO'), 'arquivo.pdf'));
  assert.ok(!resumoAntigoDeExtrato(resumo('- Tipo: RG, nome do titular'), 'RG.pdf'), 'RG não precisa de nova leitura');
  assert.ok(!resumoAntigoDeExtrato('[Transcrito por IA de "HISCON.pdf"]\nTIPO: HISCON', 'HISCON.pdf'), 'já transcrito');
  assert.ok(!resumoAntigoDeExtrato(null, 'HISCON.pdf'));
});

test('peticaoBuilder lê o Drive com o pedido de transcrição (não com o resumo)', () => {
  const src = fs.readFileSync(new URL('../src/services/peticaoBuilder.ts', import.meta.url), 'utf8');
  assert.ok(/promptLeituraArquivo\(/.test(src));
  assert.ok(!/tópicos curtos/.test(src), 'o pedido de resumo voltou para a leitura do Drive');
  assert.ok(/resumoAntigoDeExtrato\(/.test(src), 'os resumos antigos de extrato precisam ser relidos');
});
