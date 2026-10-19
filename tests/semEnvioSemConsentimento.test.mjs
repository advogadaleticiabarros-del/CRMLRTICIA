// tests/semEnvioSemConsentimento.test.mjs — trava permanente.
// Ordem da Jessica (19/10/2026): "Não envie mais nenhuma mensagem sem consentimento.
// Principalmente sem contexto." Agente NUNCA manda mensagem direto ao cliente: só
// para a Dra. (avisos internos) ou depois de aprovação humana. O resto vira rascunho
// (prepararParaAprovacao). Se este teste falhar, o deploy não acontece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const AGENTES = [
  'esteiraComercialServico.ts', 'analistaServico.ts', 'fichaServico.ts', 'copilotoServico.ts', 'negociadorServico.ts',
  'atendenteServico.ts', 'sociedadeServico.ts', 'cerebroServico.ts', 'visaoClienteServico.ts', 'errosServico.ts', 'partesContratoServico.ts',
];
// Envio permitido: para a Dra. (NUMERO_DRA) ou depois de aprovação explícita de uma pessoa.
const PERMITIDO = /sendText\(\s*NUMERO_DRA\b|aprovado por \$\{quem\}|aprovada pela Dra\./;

test('nenhum agente envia mensagem ao cliente sem aprovação humana', () => {
  const problemas = [];
  for (const arq of AGENTES) {
    const f = path.resolve('src/services', arq);
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((linha, i) => {
      if (/sendText\(|sendPixButton\(|sendMedia\(/.test(linha) && !PERMITIDO.test(linha) && !/^\s*(\/\/|\*)/.test(linha) && !/import /.test(linha)) {
        problemas.push(`${arq}:${i + 1}: ${linha.trim().slice(0, 120)}`);
      }
    });
  }
  assert.deepEqual(problemas, [], `envio direto ao cliente sem aprovação:\n${problemas.join('\n')}`);
});

test('a fila de aprovação existe e guarda o contexto', () => {
  const src = fs.readFileSync(path.resolve('src/services/aprovacaoMensagens.ts'), 'utf8');
  assert.match(src, /export async function prepararParaAprovacao/);
  assert.match(src, /CONTEXTO:/);
  assert.doesNotMatch(src, /sendText/, 'a fila só prepara, nunca envia');
});
