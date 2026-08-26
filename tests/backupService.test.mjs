// tests/backupService.test.mjs
// Ver docs/superpowers/specs/2026-08-26-backup-resiliente-multi-destino.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (!existsSync(new URL('../dist/services/backupService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { LOCAL_BACKUP_DIR, listLocalBackups, getLatestLocalBackupPath } = await import('../dist/services/backupService.js');

// Isola cada teste num diretório-fake dentro do próprio LOCAL_BACKUP_DIR,
// limpando antes/depois — não mexe em backups reais que possam já existir
// lá (usa um prefixo de teste que nenhum backup real usaria).
const PREFIXO_TESTE = 'crm-backup-TESTE-';

function limparArquivosDeTeste() {
  if (!existsSync(LOCAL_BACKUP_DIR)) return;
  for (const f of readdirSync(LOCAL_BACKUP_DIR)) {
    if (f.startsWith(PREFIXO_TESTE)) rmSync(path.join(LOCAL_BACKUP_DIR, f));
  }
}

test('listLocalBackups ordena do mais recente para o mais antigo pelo timestamp no nome', () => {
  mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  limparArquivosDeTeste();
  try {
    const nomes = [
      `${PREFIXO_TESTE}2026-01-01T02-00-00.sql.gz.enc`,
      `${PREFIXO_TESTE}2026-03-01T02-00-00.sql.gz.enc`,
      `${PREFIXO_TESTE}2026-02-01T02-00-00.sql.gz.enc`,
    ];
    for (const n of nomes) writeFileSync(path.join(LOCAL_BACKUP_DIR, n), 'conteudo-fake');

    const listados = listLocalBackups().filter((b) => b.name.startsWith(PREFIXO_TESTE));
    assert.deepEqual(listados.map((b) => b.name), [
      `${PREFIXO_TESTE}2026-03-01T02-00-00.sql.gz.enc`,
      `${PREFIXO_TESTE}2026-02-01T02-00-00.sql.gz.enc`,
      `${PREFIXO_TESTE}2026-01-01T02-00-00.sql.gz.enc`,
    ]);
  } finally {
    limparArquivosDeTeste();
  }
});

test('getLatestLocalBackupPath devolve o arquivo mais recente pelo prefixo real crm-backup-', () => {
  mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  const nomeAntigo = 'crm-backup-2020-01-01T02-00-00.sql.gz.enc';
  const nomeRecente = 'crm-backup-2099-01-01T02-00-00.sql.gz.enc';
  writeFileSync(path.join(LOCAL_BACKUP_DIR, nomeAntigo), 'a');
  writeFileSync(path.join(LOCAL_BACKUP_DIR, nomeRecente), 'b');
  try {
    const maisRecente = getLatestLocalBackupPath();
    assert.equal(path.basename(maisRecente), nomeRecente);
  } finally {
    rmSync(path.join(LOCAL_BACKUP_DIR, nomeAntigo));
    rmSync(path.join(LOCAL_BACKUP_DIR, nomeRecente));
  }
});

test('getLatestLocalBackupPath devolve null quando não há nenhum backup local', () => {
  mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  limparArquivosDeTeste();
  const existentes = readdirSync(LOCAL_BACKUP_DIR).filter((f) => f.startsWith('crm-backup-'));
  if (existentes.length > 0) {
    // Há backups reais nesta máquina (ex.: já rodou em produção) — não dá
    // pra testar o caso vazio sem apagar dados reais. Pula com segurança.
    return;
  }
  assert.equal(getLatestLocalBackupPath(), null);
});
