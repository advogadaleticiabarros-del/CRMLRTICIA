// tests/whatsappFalhasVisiveis.test.mjs
// Auditoria de fluxos do WhatsApp (22/09/2026) apontou 3 falhas invisíveis:
// transcrição/descrição que falha, erro genérico do webhook, e queda de
// conexão detectada só manualmente. Este teste audita o SQL novo desses 3
// pontos contra o schema real (mesmo mecanismo de whatsappChatsQuery), sem
// precisar de banco.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const arquivos = [
  'src/services/whatsappTranscricao.ts',
  'src/routes/whatsapp-webhook.ts',
  'src/routes/whatsapp-instance.ts',
  'src/crons/index.ts',
].map((f) => path.resolve(f));

test('SQL novo (falhas de transcrição/webhook/conexão) não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(arquivos);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('falha de transcrição/descrição vira aviso, não só console.error', () => {
  const src = fs.readFileSync(path.resolve('src/services/whatsappTranscricao.ts'), 'utf8');
  assert.match(src, /avisarFalhaTranscricao/);
  assert.match(src, /whatsapp_transcricao_falhou/);
});

test('erro não tratado no webhook vira aviso, não só console.error', () => {
  const src = fs.readFileSync(path.resolve('src/routes/whatsapp-webhook.ts'), 'utf8');
  assert.match(src, /avisarErroWebhook/);
  assert.match(src, /whatsapp_webhook_erro/);
});

test('watchdog de conexão roda periodicamente (não só uma vez no boot)', () => {
  const src = fs.readFileSync(path.resolve('src/crons/index.ts'), 'utf8');
  assert.match(src, /whatsapp:verificar-conexao/);
  // precisa de um cron.schedule de verdade associado a este job — não um setTimeout único
  const bloco = src.match(/cron\.schedule\([^)]*\)[\s\S]{0,400}whatsapp:verificar-conexao/);
  assert.ok(bloco, 'whatsapp:verificar-conexao precisa estar dentro de um cron.schedule periódico');
});

test('Painel de Saúde expõe as novas contagens de falha', () => {
  const src = fs.readFileSync(path.resolve('src/routes/whatsapp-instance.ts'), 'utf8');
  assert.match(src, /transcricao_7d/);
  assert.match(src, /webhook_7d/);
  assert.match(src, /conexao_7d/);
});
