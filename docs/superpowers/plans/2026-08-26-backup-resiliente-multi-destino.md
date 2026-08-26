# Backup Resiliente Multi-Destino Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backup do CRM passa a rodar 3x/dia, gravando em dois destinos independentes (MEGA + disco local da VPS), com download manual disponível, para que a falha de um destino (como o bloqueio recente da conta MEGA) nunca mais apague toda a proteção sem alerta específico.

**Architecture:** `backupService.ts` é refatorado para separar "gerar o dump cifrado" (função pura, um `mysqldump` por execução) de "enviar para um destino" (MEGA e disco local, cada um com seu próprio try/catch). `runBackup()` orquestra os dois destinos independentemente e devolve um resultado combinado. O cron em `crons/index.ts` passa a rodar 3x/dia e decide o nível de alerta (crítico só se ambos falharem) a partir desse resultado combinado. Uma rota nova serve o arquivo local mais recente para download.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysqldump), fs/path nativos para o destino local, node-cron para agendamento, `node --test` para os testes.

## Global Constraints

- Backup automático roda 3x/dia: 02h, 09h, 19h (`America/Sao_Paulo`).
- Um único `mysqldump` + cifragem por execução, entregue aos 2 destinos automáticos (MEGA, local) — o download manual serve o arquivo já gravado localmente, não gera um terceiro dump.
- Destino local em `~/backups-crm`, fora da árvore do deploy (`~/app`), sobrevive a `git reset --hard`.
- Retenção local: 14 arquivos mais recentes. Retenção MEGA: mantém 30 (já existente, sem mudança).
- MEGA e local falham/reportam independentemente — nunca a falha de um impede a tentativa do outro.
- Alerta crítico apenas quando ambos os destinos falham na mesma execução; alerta de aviso (não-crítico) quando só um falha, nomeando qual.
- Arquivo servido para download manual permanece cifrado (nunca decifra no servidor antes de entregar).
- Sem testes automatizados de e2e contra o MEGA real; a lógica de rotação/seleção/independência de destino é testável com filesystem local, sem credenciais reais.

---

## File Structure

- **Modify** `src/services/backupService.ts` — separa geração do dump (`gerarDumpCifrado`) de envio por destino (`enviarParaMega`, `enviarParaLocal`), `runBackup()` orquestra os dois e retorna resultado combinado. Adiciona `listLocalBackups`/`getLatestLocalBackupPath` para a rota de download.
- **Modify** `src/crons/index.ts` — cron 3x/dia, lógica de alerta crítico-só-se-ambos-falharem.
- **Modify** `src/routes/backup.ts` — nova rota `GET /download-local`.
- **Modify** `public/app.js` — botão "Baixar backup local" na tela de Backup.
- **Create** `tests/backupService.test.mjs` — testes reais da lógica de destino local (rotação, independência, ordenação).

---

### Task 1: Backup multi-destino em `backupService.ts`

**Files:**
- Modify: `src/services/backupService.ts` (arquivo inteiro será reescrito — 91 linhas hoje)
- Test: `tests/backupService.test.mjs`

**Interfaces:**
- Produces: `runBackup(): Promise<{ mega: DestinoResultado; local: DestinoResultado }>` — tipo novo, substitui o antigo `Promise<BackupResult>`. `DestinoResultado = { ok: boolean; file?: string; sizeKB?: number; message?: string }`.
- Produces: `listBackups(): Promise<{ name: string; sizeKB: number }[]>` — mantém assinatura atual (lista o MEGA, usado pela rota `GET /api/backup` existente).
- Produces: `listLocalBackups(): { name: string; sizeKB: number }[]` — síncrona, lista o conteúdo de `~/backups-crm`.
- Produces: `getLatestLocalBackupPath(): string | null` — caminho absoluto do backup local mais recente, ou `null` se não houver nenhum. Usado pela Task 3 (rota de download).
- Produces: `LOCAL_BACKUP_DIR: string` — constante exportada com o caminho absoluto de `~/backups-crm` (resolvido via `os.homedir()`), para a rota de download não duplicar essa lógica.

O nome do arquivo (`crm-backup-<timestamp>.sql.gz.enc`) e o prefixo (`crm-backup-`) continuam idênticos aos já usados no MEGA — mesmo padrão de ordenação lexicográfica por timestamp ISO no nome.

- [ ] **Step 1: Escrever o teste real da lógica de destino local**

Cria `tests/backupService.test.mjs`. Este teste não toca o MEGA (não tem como sem credenciais reais) — cobre só a parte que roda 100% no filesystem local: rotação, ordenação, e a garantia de que a função de destino local não lança mesmo se o disco falhar.

```javascript
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
```

- [ ] **Step 2: Rodar o teste e verificar que falha (funções ainda não existem)**

```bash
npm run build 2>&1 | tail -20
node --test tests/backupService.test.mjs
```
Expected: build falha ou os testes falham com "is not a function" — `listLocalBackups`/`getLatestLocalBackupPath`/`LOCAL_BACKUP_DIR` ainda não existem em `backupService.ts`.

- [ ] **Step 3: Reescrever `src/services/backupService.ts` completo**

```typescript
import os from 'os';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import mysqldump from 'mysqldump';
import { env } from '../config/env';
import { encryptBuffer } from '../utils/crypto';

// megajs publica os tipos só via "exports"; sob moduleResolution "node" o TS não
// os resolve, então carregamos via require (tipado como any) para evitar TS7016.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Storage } = require('megajs');

const RETENTION_MEGA = 30;        // mantém os últimos N backups no MEGA
const RETENTION_LOCAL = 14;       // mantém os últimos N backups na VPS (camada rápida de emergência)
const PREFIX = 'crm-backup-';

// Fora de ~/app: o deploy roda `git reset --hard origin/main` dentro de
// ~/app a cada push (.github/workflows/deploy.yml) — qualquer coisa salva
// ali seria apagada no próximo deploy. Este caminho sobrevive a isso.
export const LOCAL_BACKUP_DIR = path.join(os.homedir(), 'backups-crm');

export interface DestinoResultado {
  ok: boolean;
  file?: string;
  sizeKB?: number;
  message?: string;
}

export interface BackupMultiDestino {
  mega: DestinoResultado;
  local: DestinoResultado;
}

/** Abre a sessão MEGA e devolve a pasta de destino (por node id da URL, ou a raiz). */
async function openMega(): Promise<{ storage: any; folder: any } | null> {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;
  if (!email || !password) return null;

  const storage = await new Storage({ email, password }).ready;
  const folderId = process.env.MEGA_FOLDER_ID;
  const folder = folderId && storage.files[folderId] ? storage.files[folderId] : storage.root;
  return { storage, folder };
}

/**
 * Gera o dump lógico do MySQL, comprime e cifra — UM único dump por
 * execução, reaproveitado pelos dois destinos (evita dobrar a carga no
 * banco a cada backup). Sempre limpa o .sql temporário, mesmo se falhar.
 */
async function gerarDumpCifrado(stamp: string): Promise<{ buffer: Buffer; filename: string }> {
  const cifrado = !!(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET);
  // .enc no nome deixa explícito que o arquivo está cifrado (a restauração
  // detecta pelo conteúdo, não pelo nome — o sufixo é só para o humano).
  const filename = `${PREFIX}${stamp}.sql.gz${cifrado ? '.enc' : ''}`;
  const tmpPath = path.join(os.tmpdir(), `${PREFIX}${stamp}.sql`);

  try {
    await mysqldump({
      connection: {
        host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME,
        user: env.DB_USER, password: env.DB_PASSWORD,
      },
      dumpToFile: tmpPath,
    });

    // LGPD: cifra o dump ANTES de sair daqui. O arquivo carrega CPF, laudos
    // médicos e conversas — quem tiver acesso a qualquer um dos destinos não
    // pode lê-lo sem a ENCRYPTION_KEY.
    const buffer = encryptBuffer(zlib.gzipSync(fs.readFileSync(tmpPath)));
    return { buffer, filename };
  } finally {
    // O .sql temporário está em CLARO no disco — apagar sempre, mesmo se falhar.
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/** Envia o dump para o MEGA e faz a rotação (mantém só os RETENTION_MEGA mais recentes). */
async function enviarParaMega(buffer: Buffer, filename: string): Promise<DestinoResultado> {
  let session: { storage: any; folder: any } | null = null;
  try {
    session = await openMega();
    if (!session) return { ok: false, message: 'MEGA_EMAIL/MEGA_PASSWORD não configurados' };
    const { folder } = session;

    await folder.upload({ name: filename, size: buffer.length }, buffer).complete;

    try {
      const backups = (folder.children || []).filter((f: any) => f.name && f.name.startsWith(PREFIX));
      backups.sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
      for (const old of backups.slice(RETENTION_MEGA)) await old.delete(true);
    } catch { /* rotação é best-effort */ }

    return { ok: true, file: filename, sizeKB: Math.round(buffer.length / 1024) };
  } catch (e: any) {
    return { ok: false, message: 'Falha ao enviar para o MEGA: ' + (e?.message || String(e)) };
  } finally {
    try { if (session) await session.storage.close(); } catch { /* ignore */ }
  }
}

/** Grava o dump em ~/backups-crm e faz a rotação (mantém só os RETENTION_LOCAL mais recentes). */
async function enviarParaLocal(buffer: Buffer, filename: string): Promise<DestinoResultado> {
  try {
    fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
    const destino = path.join(LOCAL_BACKUP_DIR, filename);
    fs.writeFileSync(destino, buffer);

    try {
      const arquivos = fs.readdirSync(LOCAL_BACKUP_DIR).filter((f) => f.startsWith(PREFIX));
      arquivos.sort((a, b) => b.localeCompare(a));
      for (const old of arquivos.slice(RETENTION_LOCAL)) {
        fs.unlinkSync(path.join(LOCAL_BACKUP_DIR, old));
      }
    } catch { /* rotação é best-effort */ }

    return { ok: true, file: filename, sizeKB: Math.round(buffer.length / 1024) };
  } catch (e: any) {
    return { ok: false, message: 'Falha ao gravar backup local: ' + (e?.message || String(e)) };
  }
}

/**
 * Gera um dump comprimido e cifrado do MySQL e envia para os DOIS destinos
 * (MEGA e disco local da VPS) de forma INDEPENDENTE — a falha de um nunca
 * impede a tentativa do outro. Quem chama decide o nível de alerta a partir
 * do resultado combinado (ver src/crons/index.ts, job 'backup:diario').
 */
export async function runBackup(): Promise<BackupMultiDestino> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-06-22T18-30-00
  const { buffer, filename } = await gerarDumpCifrado(stamp);

  const [mega, local] = await Promise.all([
    enviarParaMega(buffer, filename),
    enviarParaLocal(buffer, filename),
  ]);

  return { mega, local };
}

/** Lista os backups existentes na pasta do MEGA. */
export async function listBackups(): Promise<{ name: string; sizeKB: number }[]> {
  const session = await openMega();
  if (!session) return [];
  const { storage, folder } = session;
  try {
    return (folder.children || [])
      .filter((f: any) => f.name && f.name.startsWith(PREFIX))
      .sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)))
      .map((f: any) => ({ name: f.name, sizeKB: Math.round((f.size || 0) / 1024) }));
  } finally {
    try { await storage.close(); } catch { /* ignore */ }
  }
}

/** Lista os backups existentes localmente (~/backups-crm), mais recente primeiro. */
export function listLocalBackups(): { name: string; sizeKB: number }[] {
  if (!fs.existsSync(LOCAL_BACKUP_DIR)) return [];
  return fs.readdirSync(LOCAL_BACKUP_DIR)
    .filter((f) => f.startsWith(PREFIX))
    .sort((a, b) => b.localeCompare(a))
    .map((f) => {
      const stat = fs.statSync(path.join(LOCAL_BACKUP_DIR, f));
      return { name: f, sizeKB: Math.round(stat.size / 1024) };
    });
}

/** Caminho absoluto do backup local mais recente, ou null se não houver nenhum. */
export function getLatestLocalBackupPath(): string | null {
  const backups = listLocalBackups();
  if (!backups.length) return null;
  return path.join(LOCAL_BACKUP_DIR, backups[0].name);
}
```

- [ ] **Step 4: Build e rodar os testes**

```bash
npm run build
node --test tests/backupService.test.mjs
```
Expected: build limpo, 3/3 testes `PASS` (ou o 3º `SKIP`-equivalente se já houver backups reais na máquina — nesse caso ele retorna sem assert, o que o runner reporta como passou).

- [ ] **Step 5: Rodar o typecheck do projeto inteiro (a assinatura de `runBackup` mudou — outros arquivos que a chamam precisam ser conferidos)**

```bash
npm run typecheck
```
Expected: nesta task ainda vai FALHAR — `src/crons/index.ts:223-224` chama `runBackup()` esperando o formato antigo (`r.ok`, `r.message`). Isso é esperado e corrigido na Task 2. Confirme que o único erro reportado é em `src/crons/index.ts` (linha do `if (!r.ok)`), não em nenhum outro arquivo — se aparecer erro em outro lugar, investigue antes de prosseguir.

- [ ] **Step 6: Commit**

```bash
git add src/services/backupService.ts tests/backupService.test.mjs
git commit -m "feat: backup grava em dois destinos independentes (MEGA + disco local)"
```

---

### Task 2: Cron 3x/dia + alerta por nível de severidade

**Files:**
- Modify: `src/crons/index.ts:220-227`

**Interfaces:**
- Consumes de Task 1: `runBackup(): Promise<{ mega: DestinoResultado; local: DestinoResultado }>`, tipo `DestinoResultado = { ok: boolean; file?: string; sizeKB?: number; message?: string }`.
- Consumes já existente: `runJob(job: string, fn: () => Promise<any>, opts?: { critica?: boolean; silencioso?: boolean }): Promise<void>` de `./runner` (já importado em `src/crons/index.ts`).

Leia `src/crons/index.ts` linhas 1-30 (imports) e 215-230 (job atual) antes de editar — o import de `runBackup` já existe na linha 8, não precisa adicionar de novo.

- [ ] **Step 1: Substituir o job único por 3 agendamentos + lógica de severidade**

Encontre em `src/crons/index.ts` o bloco (por volta da linha 220-227):

```typescript
  // ── backup diário do banco: 02h (dump comprimido → MEGA) ── CRÍTICO ───────
  cron.schedule('0 2 * * *', () => {
    runJob('backup:diario', async () => {
      const r = await runBackup();
      if (!r.ok) throw new Error(`Backup não realizado: ${r.message}`);
      return { arquivo: r.file, kb: r.sizeKB };
    }, { critica: true });
  });
```

Substitua por:

```typescript
  // ── backup 3x/dia: 02h, 09h, 19h (dump comprimido → MEGA + disco local) ───
  // CRÍTICO só quando os DOIS destinos falham na mesma execução — a falha de
  // só um deles ainda protege os dados (o outro destino segue funcionando),
  // mas precisa de aviso específico: foi assim que o bloqueio de uma conta
  // MEGA (EBLOCKED) passou dias sem ninguém notar, quando havia um único
  // destino e a rotina inteira "falhava" de forma genérica.
  const executarBackup = () => {
    runJob('backup:diario', async () => {
      const { mega, local } = await runBackup();

      if (!mega.ok && !local.ok) {
        throw new Error(`Backup NÃO realizado em nenhum destino — MEGA: ${mega.message} · Local: ${local.message}`);
      }

      if (!mega.ok || !local.ok) {
        const falhou = !mega.ok ? 'MEGA' : 'disco local';
        const motivo = !mega.ok ? mega.message : local.message;
        await runJob('backup:diario:aviso-destino-parcial', async () => {
          throw new Error(`Backup rodando em UM destino só — ${falhou} falhou: ${motivo}. O outro destino está protegendo os dados normalmente, mas isto precisa ser corrigido antes que também falhe.`);
        }, { critica: false });
      }

      return {
        mega: mega.ok ? { arquivo: mega.file, kb: mega.sizeKB } : { erro: mega.message },
        local: local.ok ? { arquivo: local.file, kb: local.sizeKB } : { erro: local.message },
      };
    }, { critica: true });
  };
  cron.schedule('0 2 * * *', executarBackup, { timezone: 'America/Sao_Paulo' });
  cron.schedule('0 9 * * *', executarBackup, { timezone: 'America/Sao_Paulo' });
  cron.schedule('0 19 * * *', executarBackup, { timezone: 'America/Sao_Paulo' });
```

Note que o job `backup:diario` principal só lança (e dispara alerta crítico) quando AMBOS falham — quando só um falha, ele retorna normalmente (sucesso do ponto de vista do job principal, já que ao menos um destino protegeu os dados), mas dispara uma segunda chamada `runJob` aninhada com nome próprio (`backup:diario:aviso-destino-parcial`) e `critica: false`, que sempre lança para gerar o registro em `job_runs` e o aviso no sino — sem duplicar a lógica de registro/aviso que `runJob`/`avisarAdmins` já implementam.

- [ ] **Step 2: Rodar o typecheck (agora deve passar, a assinatura bate)**

```bash
npm run typecheck
```
Expected: sem erros.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/crons/index.ts
git commit -m "feat: backup roda 3x/dia, alerta critico so quando os dois destinos falham"
```

---

### Task 3: Download manual do backup local

**Files:**
- Modify: `src/routes/backup.ts` (arquivo inteiro, 24 linhas hoje)
- Modify: `public/app.js` (tela de Backup — localizar via busca por `/api/backup` no arquivo)

**Interfaces:**
- Consumes de Task 1: `getLatestLocalBackupPath(): string | null` de `../services/backupService`.
- Consumes já existente: `listBackups(): Promise<{name,sizeKB}[]>`, `runBackup(): Promise<BackupMultiDestino>` de `../services/backupService`; middleware `authenticate, requireAdmin` já aplicado na montagem da rota em `src/app.ts:194` (`app.use('/api/backup', authenticate, requireAdmin, backupRoutes)`) — a rota nova herda essa proteção automaticamente, não precisa adicionar auth de novo dentro do arquivo.

- [ ] **Step 1: Reescrever `src/routes/backup.ts` completo**

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { runBackup, listBackups, listLocalBackups, getLatestLocalBackupPath } from '../services/backupService';

const router = Router();

// ── GET /api/backup — lista os backups no MEGA e localmente ────────────────
router.get('/', async (_req: Request, res: Response) => {
  const backups = await listBackups();
  const local = listLocalBackups();
  res.json({ backups, total: backups.length, local, totalLocal: local.length });
});

// ── POST /api/backup/run — dispara um backup agora (MEGA + local) ──────────
router.post('/run', async (_req: Request, res: Response) => {
  try {
    const result = await runBackup();
    const okAoMenosUm = result.mega.ok || result.local.ok;
    res.status(okAoMenosUm ? 200 : 400).json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ── GET /api/backup/download-local — baixa o backup local mais recente ─────
// O arquivo permanece CIFRADO (mesma postura de encryptBuffer) — não decifra
// no servidor antes de entregar; quem baixar precisa da ENCRYPTION_KEY para
// abrir, igual a qualquer outro backup.
router.get('/download-local', (_req: Request, res: Response) => {
  const caminho = getLatestLocalBackupPath();
  if (!caminho || !fs.existsSync(caminho)) {
    res.status(404).json({ error: 'Nenhum backup local disponível' });
    return;
  }
  res.download(caminho, path.basename(caminho));
});

export default router;
```

- [ ] **Step 2: Rodar o typecheck e o build**

```bash
npm run typecheck
npm run build
```
Expected: sem erros.

- [ ] **Step 3: Adicionar o botão de download no frontend**

Abra `public/app.js` e localize a tela de Backup buscando por `/api/backup` (a rota `GET /api/backup` já é chamada de algum lugar — leia a função inteira que a envolve antes de editar, para replicar o mesmo estilo de botão/classe CSS já usado nas outras telas do CRM, ex.: `btn-sm`, `btn-gold`, conforme visto nas telas de Leads e Agendamento desta mesma sessão).

Dentro dessa função, logo após o HTML que já lista os backups do MEGA (onde estiver o botão "Rodar backup agora" que chama `POST /api/backup/run`), adicione um botão novo:

```html
<button class="btn-sm" id="btn-baixar-backup-local">Baixar backup local</button>
```

E o handler correspondente, no mesmo bloco `onclick`/`addEventListener` dos outros botões dessa tela:

```javascript
$('#btn-baixar-backup-local').onclick = async (ev) => {
  const btn = ev.target;
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Baixando…';
  try {
    const resp = await fetch(API + '/api/backup/download-local', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Falha ao baixar o backup');
    }
    const disposition = resp.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'backup.sql.gz.enc';
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
};
```

`fetch` com o header `Authorization: Bearer` normal (não `window.open`/link direto) — o token de sessão nunca aparece na URL, no histórico do navegador nem em logs de acesso do servidor. A resposta chega como `blob`, e o download é disparado criando um link temporário via `URL.createObjectURL`, removido logo em seguida. `res.download()` (na rota, Step 1) já manda o header `Content-Disposition: attachment; filename="..."` automaticamente — o frontend só precisa lê-lo para nomear o arquivo baixado corretamente.

- [ ] **Step 4: Teste manual (checklist, sem automação de frontend — mesmo padrão já usado nesta sessão)**

Suba o servidor local, faça login no CRM, vá na tela de Backup:
1. Clique "Rodar backup agora" — confirme que a resposta mostra tanto o resultado do MEGA quanto do local.
2. Clique "Baixar backup local" — confirme que um arquivo `.sql.gz.enc` é baixado.
3. Rode `GET /api/backup` novamente e confirme que a lista `local` aparece com o arquivo recém-criado.

- [ ] **Step 5: Commit**

```bash
git add src/routes/backup.ts public/app.js
git commit -m "feat: rota e botao de download do backup local mais recente"
```

---

## Após as 3 tasks

1. Revisão final de branch inteira (subagent-driven-development: `scripts/review-package` do commit anterior à Task 1 até HEAD, dispatch no modelo mais capaz — dar atenção especial a: o `Promise.all` em `runBackup()` realmente isola falhas de um destino sem que uma rejeição de um `throw` dentro de `enviarParaMega`/`enviarParaLocal` vaze e derrube o outro; se `fs.mkdirSync(LOCAL_BACKUP_DIR, {recursive:true})` roda toda vez ou só quando necessário; se o download via blob no frontend trata corretamente o caso de erro 404/500 sem tentar criar um blob de um JSON de erro).
2. Corrigir achados Critical/Important.
3. Push + `gh run watch` do deploy — **verificar em produção que `~/backups-crm` foi criado na VPS e que o primeiro backup automático das 02h/09h/19h realmente grava lá** (não só confiar no build limpo).
4. Como é urgente (proteção de dados sensíveis), depois do deploy confirmado, disparar `POST /api/backup/run` manualmente em produção uma vez (mesmo antes do próximo horário agendado) para confirmar que os dois destinos — MEGA (conta nova) e disco local — funcionam de verdade contra o ambiente real, não só em teste local.
