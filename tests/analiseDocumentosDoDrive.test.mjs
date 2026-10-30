// tests/analiseDocumentosDoDrive.test.mjs — incidente de 30/10/2026: a "Análise dos documentos"
// do Valmirio (Itaú) dizia "O cliente ainda não mandou nenhuma foto ou PDF", mas os documentos
// do caso estavam todos no CRM só como link do Google Drive (sem o arquivo guardado). A
// Dra. Helena só lia arquivos guardados; agora lê também os do Drive (baixados na hora).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { comoLerDocumento, lidoPelaAnalise } from '../dist/services/analistaDocumentos.js';

const DRIVE = 'https://drive.google.com/file/d/1AbC-xyz_09/view?usp=drivesdk';

test('documento com foto ou PDF guardado no CRM é lido do banco', () => {
  assert.strictEqual(comoLerDocumento({ mime: 'application/pdf', tem_arquivo: 1, file_url: null }), 'guardado');
  assert.strictEqual(comoLerDocumento({ mime: 'image/jpeg', tem_arquivo: true, file_url: DRIVE }), 'guardado');
});

test('documento só com link do Drive é baixado de lá, mesmo sem tipo conhecido', () => {
  assert.strictEqual(comoLerDocumento({ mime: 'application/pdf', tem_arquivo: 0, file_url: DRIVE }), 'drive');
  assert.strictEqual(comoLerDocumento({ mime: null, tem_arquivo: 0, file_url: DRIVE }), 'drive');
  assert.strictEqual(comoLerDocumento({ mime: 'application/octet-stream', tem_arquivo: 0, file_url: DRIVE }), 'drive');
});

test('fica fora o que não é foto nem PDF, ou não tem arquivo nem link do Drive', () => {
  assert.strictEqual(comoLerDocumento({ mime: 'text/plain', tem_arquivo: 0, file_url: null }), null); // peça, relatório
  assert.strictEqual(comoLerDocumento({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tem_arquivo: 1, file_url: null }), null);
  assert.strictEqual(comoLerDocumento({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tem_arquivo: 0, file_url: DRIVE }), null);
  assert.strictEqual(comoLerDocumento({ mime: 'application/pdf', tem_arquivo: 0, file_url: 'https://exemplo.com/a.pdf' }), null);
});

test('depois de baixar, só foto ou PDF vai para a leitura', () => {
  assert.ok(lidoPelaAnalise('application/pdf'));
  assert.ok(lidoPelaAnalise('image/png'));
  assert.ok(!lidoPelaAnalise('application/vnd.google-apps.folder'));
  assert.ok(!lidoPelaAnalise(null));
});

test('a barra da análise não pode esconder a trava do pedido de reenvio (marcar)', () => {
  const src = fs.readFileSync(new URL('../src/services/analistaServico.ts', import.meta.url), 'utf8');
  const corpo = src.slice(src.indexOf('export async function analisarCaso'));
  assert.ok(!/const\s+marcar\s*=/.test(corpo), 'analisarCaso redeclara "marcar" e o reenvio deixa de ser travado');
});
