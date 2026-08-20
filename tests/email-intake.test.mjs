// tests/email-intake.test.mjs — cobre lógica pura do fluxo de intake de e-mail
// (não depende de banco/Groq/Gmail/Drive): título de caso e validação de anexos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { tituloCaso } = await import('../dist/services/emailIntake.js');
const { rejectAttachment, attachmentExtension } = await import('../dist/services/partnerInboxService.js');

// ── tituloCaso ───────────────────────────────────────────────────────────
test('tituloCaso: combina tipo e banco quando ambos existem', () => {
  const t = tituloCaso('Maria Benedita', { area: 'consumidor', tipo: 'RCC', banco: 'Banco PAN' });
  assert.equal(t, 'Maria Benedita · RCC — Banco PAN');
});

test('tituloCaso: cai no nome puro quando não há tipo nem banco', () => {
  const t = tituloCaso('João', { area: 'outro' });
  assert.equal(t, 'João');
});

test('tituloCaso: usa só o tipo quando falta o banco', () => {
  const t = tituloCaso('João', { area: 'consumidor', tipo: 'empréstimo pessoal' });
  assert.equal(t, 'João · empréstimo pessoal');
});

// ── rejectAttachment / attachmentExtension (item 2: validação de anexo) ────
test('attachmentExtension: extrai a extensão em minúsculas', () => {
  assert.equal(attachmentExtension('Laudo.PDF'), '.pdf');
  assert.equal(attachmentExtension('script.EXE'), '.exe');
  assert.equal(attachmentExtension('sem_extensao'), '');
  assert.equal(attachmentExtension(undefined), '');
});

test('rejectAttachment: bloqueia extensões perigosas independente do tamanho', () => {
  assert.ok(rejectAttachment('virus.exe', 100));
  assert.ok(rejectAttachment('script.bat', undefined));
  assert.ok(rejectAttachment('run.sh', 10));
  assert.ok(rejectAttachment('macro.js', 10));
  assert.ok(rejectAttachment('installer.msi', 10));
});

test('rejectAttachment: aceita PDF/imagem/docx de tamanho normal', () => {
  assert.equal(rejectAttachment('contrato.pdf', 2 * 1024 * 1024), null);
  assert.equal(rejectAttachment('foto.jpg', 500 * 1024), null);
  assert.equal(rejectAttachment('peticao.docx', 1024), null);
});

test('rejectAttachment: bloqueia arquivo acima de 25MB mesmo com extensão permitida', () => {
  const r = rejectAttachment('video.mp4', 26 * 1024 * 1024);
  assert.ok(r, 'deve rejeitar');
  assert.match(r, /25MB/);
});

test('rejectAttachment: sem sizeBytes conhecido ainda, só valida extensão (tamanho checado depois)', () => {
  assert.equal(rejectAttachment('contrato.pdf', undefined), null);
});
