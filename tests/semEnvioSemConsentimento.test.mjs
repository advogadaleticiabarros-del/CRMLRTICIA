// tests/semEnvioSemConsentimento.test.mjs — trava permanente.
// Ordem da Jessica (19/10/2026): "Não envie mais nenhuma mensagem sem consentimento.
// Principalmente sem contexto." Agente NUNCA manda mensagem direto ao cliente: só
// para a Dra. (avisos internos) ou depois de aprovação humana. O resto vira rascunho
// (prepararParaAprovacao). Desde 20/10/2026 vale também para as automações antigas
// (acompanhamento de proposta, recusa, expiração, aceite, newsletter, e-book).
// Se este teste falhar, o deploy não acontece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SEM_ENVIO_DIRETO = [
  // agentes
  'src/services/esteiraComercialServico.ts', 'src/services/analistaServico.ts', 'src/services/fichaServico.ts',
  'src/services/copilotoServico.ts', 'src/services/negociadorServico.ts', 'src/services/atendenteServico.ts',
  'src/services/sociedadeServico.ts', 'src/services/cerebroServico.ts', 'src/services/visaoClienteServico.ts',
  'src/services/errosServico.ts', 'src/services/partesContratoServico.ts',
  // automações antigas a cliente
  'src/services/propostaFollowupService.ts', 'src/services/pendingWhatsappReminderService.ts',
  'src/routes/leads.ts', 'src/routes/propostas.ts', 'src/routes/propostas-public.ts',
  'src/routes/lead-public.ts', 'src/routes/whatsapp-webhook.ts',
];
// Envio permitido: para a Dra. (NUMERO_DRA) ou depois de aprovação explícita de uma pessoa.
const PERMITIDO = /sendText\(\s*NUMERO_DRA\b|aprovado por \$\{quem\}|aprovada pela Dra\./;
const ENVIO = /sendText\(|sendPixButton\(|sendMedia\(|sendMenu\(/;

test('nenhum agente nem automação envia mensagem ao cliente sem aprovação humana', () => {
  const problemas = [];
  for (const arq of SEM_ENVIO_DIRETO) {
    const f = path.resolve(arq);
    assert.ok(fs.existsSync(f), `arquivo da trava sumiu (renomeado?): ${arq}`);
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((linha, i) => {
      if (ENVIO.test(linha) && !PERMITIDO.test(linha) && !/^\s*(\/\/|\*)/.test(linha) && !/import /.test(linha)) {
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

test('quem envia a mensagem aprovada (envioAprovado) só é chamado pelo "enviar" da equipe', () => {
  const quemUsa = [];
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const f = path.join(dir, nome);
      if (fs.statSync(f).isDirectory()) varrer(f);
      else if (f.endsWith('.ts') && !f.endsWith('envioAprovado.ts') && /executarEnvioAprovado/.test(fs.readFileSync(f, 'utf8'))) quemUsa.push(path.relative('.', f).replace(/\\/g, '/'));
    }
  };
  varrer(path.resolve('src'));
  assert.deepEqual(quemUsa, ['src/services/atendenteServico.ts']);
  const atendente = fs.readFileSync(path.resolve('src/services/atendenteServico.ts'), 'utf8');
  const enviar = atendente.slice(atendente.indexOf('export async function enviarRascunho'));
  assert.match(enviar.slice(0, enviar.indexOf('\n}\n')), /executarEnvioAprovado\(/);
});
