# Briefing Jurídico Matinal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o resumo matinal do CRM (e-mail 07h + WhatsApp 08h) num painel de comando
priorizado por gravidade, com agenda confiável, movimentações processuais interpretadas por IA,
financeiro/comercial granulares e um fechamento de fim de expediente.

**Architecture:** Corrige dois bugs de sincronização de agenda (pré-requisito bloqueante),
adiciona 3 colunas/tabelas pequenas, extrai um classificador de severidade puro e testável,
reaproveita o padrão de IA já existente (Groq via `aiAssistant.ts`) para interpretar
movimentações, estende as queries de dados existentes em `morningBriefingService.ts`, reescreve
os dois construtores de template (HTML e WhatsApp) e adiciona um novo serviço de fechamento
diário. Radar Jurídico fica só na fase de spike (provar a fonte, não automatizar).

**Tech Stack:** Node + TypeScript + Express + MySQL (mysql2), `node --test` para testes
(compila `tsc` → `dist/` antes de importar), node-cron para agendamento, Groq/Gemini via
`aiAssistant.ts`, Resend (e-mail) e Uazapi (WhatsApp) já configurados.

## Global Constraints

- Toda mudança de schema é uma migration nova em `migrations/`, numerada sequencialmente a
  partir de `095` (a última hoje é `094_whatsapp_reply.sql`).
- Toda função nova com lógica testável ganha teste em `tests/*.test.mjs`, seguindo o padrão
  existente: compila com `npx tsc` se `dist/` não existir, importa de `../dist/...js`.
- Nenhuma mudança pode quebrar `npm test` (77 testes hoje) nem `npm run build`.
- Rotinas automáticas (cron) usam sempre `runJob(nome, fn, opts)` de `src/crons/runner.ts` —
  nunca `catch {}` cru. `critica: true` só para prazos/backup/financeiro.
- IA: usar `aiComplete(prompt, 'groq')` de `src/services/aiAssistant.ts` para
  análise/triagem — nunca chamar a API externa direto.
- Cores/tipografia do e-mail: manter `NAVY = '#1f3047'`, `GOLD = '#c19a4e'`,
  `NAVY_SOFT = '#eef1f6'`, `GOLD_SOFT = '#f2ead3'` (já definidos em
  `morningBriefingService.ts`) e adicionar `CRITICAL = '#b3432f'`,
  `CRITICAL_SOFT = '#fbeae6'`, `WARNING = '#a67626'`, `WARNING_SOFT = '#faf1e0'`,
  `OK = '#2f8f63'` (já usado em outro lugar do arquivo), `OK_SOFT = '#eaf3ee'`. Fonte:
  Georgia nos títulos de seção, Arial no corpo — não trocar.
- Nunca commitar com `--no-verify`; sempre `git add` arquivos específicos, nunca `-A`.

---

## Task 1: Paginação em `listUpcomingEvents` (bug de agenda incompleta)

**Files:**
- Modify: `src/services/GoogleCalendarService.ts:180-219`
- Test: `tests/googleCalendarPagination.test.mjs` (criar)

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores.
- Produces: `listUpcomingEvents(userId, maxResults)` continua com a mesma assinatura pública —
  quem chama (`CalendarSyncService.syncFromGoogle`) não muda.

O método hoje (linhas 206-211) faz uma única chamada `calendar.events.list({..., maxResults})`
por calendário, sem checar `response.data.nextPageToken`. Se houver mais eventos do que
`maxResults` no período (mês passado → +24 meses, ordenado do mais antigo pro mais novo),
eventos futuros ficam de fora silenciosamente.

- [ ] **Step 1: Escrever o teste que reproduz o corte**

Como o método fala com a API real do Google, o teste cobre a lógica de paginação isolada
extraindo-a para uma função pura testável. Antes de mexer no service, crie
`src/services/googlePagination.ts`:

```typescript
// src/services/googlePagination.ts
/**
 * Junta todas as páginas de uma listagem paginada no estilo Google Calendar API
 * (cada página devolve `items` + opcionalmente `nextPageToken`).
 * Extraído do GoogleCalendarService para ser testável sem falar com a API real.
 */
export async function collectAllPages<T>(
  fetchPage: (pageToken?: string) => Promise<{ items?: T[]; nextPageToken?: string | null }>
): Promise<T[]> {
  const all: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    all.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return all;
}
```

Agora o teste, em `tests/googlePagination.test.mjs`:

```javascript
// Testa a paginação genérica usada para não cortar eventos do Google Calendar
// em 100 resultados (bug: compromissos futuros somiam quando havia mais de
// 100 eventos no período de 25 meses varrido).
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/googlePagination.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { collectAllPages } = await import('../dist/services/googlePagination.js');

test('uma única página sem nextPageToken devolve só os itens dela', async () => {
  const r = await collectAllPages(async () => ({ items: [1, 2, 3] }));
  assert.deepEqual(r, [1, 2, 3]);
});

test('duas páginas são concatenadas na ordem', async () => {
  let calls = 0;
  const r = await collectAllPages(async (token) => {
    calls++;
    if (!token) return { items: [1, 2], nextPageToken: 'abc' };
    assert.equal(token, 'abc');
    return { items: [3, 4] };
  });
  assert.deepEqual(r, [1, 2, 3, 4]);
  assert.equal(calls, 2);
});

test('mais de 100 itens (3 páginas de ~50) não corta nada — reproduz o bug original', async () => {
  const totalPaginas = 3;
  let pagina = 0;
  const r = await collectAllPages(async () => {
    pagina++;
    const items = Array.from({ length: 50 }, (_, i) => `evento-${pagina}-${i}`);
    return { items, nextPageToken: pagina < totalPaginas ? `p${pagina}` : null };
  });
  assert.equal(r.length, 150);
  assert.equal(r[0], 'evento-1-0');
  assert.equal(r[149], 'evento-3-49');
});

test('página vazia sem items não quebra (items ausente)', async () => {
  const r = await collectAllPages(async () => ({}));
  assert.deepEqual(r, []);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test tests/googlePagination.test.mjs`
Expected: FAIL — `Cannot find module '../dist/services/googlePagination.js'` (o arquivo fonte
ainda não existe, então o `tsc` do bloco de setup não vai gerar o `.js`).

- [ ] **Step 3: Criar o arquivo fonte** (o código do Step 1 acima, em
  `src/services/googlePagination.ts`) e rodar o build

Run: `npx tsc`
Expected: sem erros.

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `node --test tests/googlePagination.test.mjs`
Expected: PASS nos 4 testes.

- [ ] **Step 5: Usar `collectAllPages` dentro de `listUpcomingEvents`**

Em `src/services/GoogleCalendarService.ts`, importe no topo:

```typescript
import { collectAllPages } from './googlePagination';
```

Troque o miolo do loop `for (const cal of calendars)` (linhas 204-217) de:

```typescript
      try {
        const response = await calendar.events.list({
          calendarId: cal.id!,
          timeMin, timeMax, maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        });
        for (const ev of response.data.items ?? []) {
          (ev as any)._calendarName = cal.summary ?? null;
          all.push(ev);
        }
      } catch { /* calendário sem acesso de leitura: ignora */ }
```

para:

```typescript
      try {
        // Paginação: sem isso, calendários com muitos eventos no período de 25
        // meses varrido perdiam compromissos futuros — a API só devolve
        // `maxResults` por página, e a antiga chamada única ignorava
        // `nextPageToken` (bug confirmado: eventos ordenados do mais antigo pro
        // mais novo, então o corte comia justamente o que estava por vir).
        const items = await collectAllPages<calendar_v3.Schema$Event>(async (pageToken) => {
          const response = await calendar.events.list({
            calendarId: cal.id!,
            timeMin, timeMax, maxResults,
            singleEvents: true,
            orderBy: 'startTime',
            pageToken,
          });
          return { items: response.data.items ?? undefined, nextPageToken: response.data.nextPageToken };
        });
        for (const ev of items) {
          (ev as any)._calendarName = cal.summary ?? null;
          all.push(ev);
        }
      } catch { /* calendário sem acesso de leitura: ignora */ }
```

- [ ] **Step 6: Build completo e suíte inteira**

Run: `npx tsc && node --test "tests/**/*.test.mjs"`
Expected: build sem erro; todos os testes (os novos + os 77 existentes) passando.

- [ ] **Step 7: Commit**

```bash
git add src/services/googlePagination.ts src/services/GoogleCalendarService.ts tests/googlePagination.test.mjs
git commit -m "fix: pagina a listagem do Google Calendar — compromissos futuros somiam após 100 resultados"
```

---

## Task 2: Timezone correto em `syncFromGoogle` (bug de horário errado vindo do Google)

**Files:**
- Modify: `src/services/CalendarSyncService.ts:12-70`
- Test: `tests/calendarSyncTimezone.test.mjs` (criar)

**Interfaces:**
- Consumes: nenhuma.
- Produces: `toUtcMysqlFromGoogleDateTime(value: string | null | undefined): string | null`,
  exportada de `src/services/CalendarSyncService.ts`, usada nos dois `db.query` de
  `syncFromGoogle` (INSERT e UPDATE).

`ev.start?.dateTime` (vindo do Google) é uma string RFC3339 com offset (ex.:
`"2026-08-25T14:00:00-03:00"`) ou `"Z"` para UTC. Hoje ela é gravada direto no banco sem
conversão — a coluna é lida de volta como UTC (pool `timezone:'Z'`), então o horário sai
deslocado. Eventos de dia inteiro (`ev.start?.date`, só `"2026-08-25"`, sem hora) devem virar
meia-noite UTC do dia — não precisam de conversão de fuso, só de formatação.

- [ ] **Step 1: Escrever o teste da função de conversão**

```javascript
// tests/calendarSyncTimezone.test.mjs
// Google Calendar devolve dateTime com offset embutido (RFC3339). Gravar essa
// string direto no banco (pool timezone:'Z', tudo lido como UTC) desloca o
// horário — mesma classe de bug já corrigida em calendar.ts (commit a305ad0)
// e no sentido CRM→Google (commit 97983b6), nunca corrigida no sentido
// Google→CRM.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/CalendarSyncService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { toUtcMysqlFromGoogleDateTime } = await import('../dist/services/CalendarSyncService.js');

test('14:00 em -03:00 (Brasília) vira 17:00 em UTC no formato MySQL', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime('2026-08-25T14:00:00-03:00'), '2026-08-25 17:00:00');
});

test('horário já em Z (UTC) passa direto, só troca o formato', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime('2026-08-25T17:00:00Z'), '2026-08-25 17:00:00');
});

test('evento de dia inteiro (só data, sem hora) vira meia-noite UTC daquele dia', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime('2026-08-25'), '2026-08-25 00:00:00');
});

test('nulo/indefinido devolve null', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime(null), null);
  assert.equal(toUtcMysqlFromGoogleDateTime(undefined), null);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/calendarSyncTimezone.test.mjs`
Expected: FAIL — `toUtcMysqlFromGoogleDateTime` não existe ainda em `dist/`.

- [ ] **Step 3: Implementar a função em `CalendarSyncService.ts`**

No topo do arquivo, depois dos imports existentes (`import { db } ...` e
`import { googleCalendarService } ...`):

```typescript
/**
 * Converte o dateTime do Google (RFC3339 com offset, ex. "2026-08-25T14:00:00-03:00",
 * ou "date" puro pra evento de dia inteiro) para o formato "YYYY-MM-DD HH:mm:ss" em
 * UTC real, pronto para gravar numa coluna DATETIME com pool timezone:'Z'. Sem isso,
 * o offset do Google era ignorado e o horário saía deslocado ao ler de volta.
 */
export function toUtcMysqlFromGoogleDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  // "date" puro (evento de dia inteiro) não tem hora nem offset — vira meia-noite.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} 00:00:00`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/calendarSyncTimezone.test.mjs`
Expected: PASS nos 4 testes.

- [ ] **Step 5: Usar a função dentro de `syncFromGoogle`**

Ainda em `CalendarSyncService.ts`, dentro de `syncFromGoogle` (por volta da linha 31), troque:

```typescript
        const start = ev.start?.dateTime ?? ev.start?.date;
        const end   = ev.end?.dateTime   ?? ev.end?.date;
```

por:

```typescript
        const start = toUtcMysqlFromGoogleDateTime(ev.start?.dateTime ?? ev.start?.date);
        const end   = toUtcMysqlFromGoogleDateTime(ev.end?.dateTime   ?? ev.end?.date);
```

(`start`/`end` já são passados como parâmetros `?` nos dois `db.query` — INSERT e UPDATE —
logo abaixo; nenhuma outra linha muda.)

- [ ] **Step 6: Build completo e suíte inteira**

Run: `npx tsc && node --test "tests/**/*.test.mjs"`
Expected: build sem erro; todos os testes passando (incluindo os do Task 1).

- [ ] **Step 7: Commit**

```bash
git add src/services/CalendarSyncService.ts tests/calendarSyncTimezone.test.mjs
git commit -m "fix: converte o horário do Google para UTC real ao sincronizar pro CRM (syncFromGoogle)"
```

---

## Task 3: Migrations de schema (birth_date, ai_summary, briefing_snapshots)

**Files:**
- Create: `migrations/095_client_birth_date.sql`
- Create: `migrations/096_movement_ai_summary.sql`
- Create: `migrations/097_briefing_snapshots.sql`
- Test: `tests/migrations.test.mjs` (já existe — verificar se passa sem mudança de código,
  só validando que as migrations novas são bem formadas)

**Interfaces:**
- Produces: coluna `clients.birth_date DATE NULL`, coluna
  `process_movements.ai_summary JSON NULL`, tabela `briefing_snapshots` — usadas pelas
  Tasks 4, 8 e 9-12.

- [ ] **Step 1: Criar `migrations/095_client_birth_date.sql`**

```sql
-- ============================================================
-- Migration 095 — Data de nascimento do cliente (aniversariantes no briefing)
-- Campo novo, opcional — preenchido aos poucos conforme o cadastro é
-- atualizado. Sem retroatividade: clientes antigos ficam sem aniversário
-- no briefing até alguém preencher.
-- ============================================================

ALTER TABLE clients ADD COLUMN birth_date DATE NULL;
```

- [ ] **Step 2: Criar `migrations/096_movement_ai_summary.sql`**

```sql
-- ============================================================
-- Migration 096 — Interpretação por IA de movimentações processuais
-- Guarda o resultado da análise (resumo/ação/prazo interno/prioridade)
-- gerada pelo Estagiário IA (Groq) para o briefing matinal. JSON, não
-- colunas separadas — o formato pode evoluir sem migration nova.
-- ============================================================

ALTER TABLE process_movements ADD COLUMN ai_summary JSON NULL;
```

- [ ] **Step 3: Criar `migrations/097_briefing_snapshots.sql`**

```sql
-- ============================================================
-- Migration 097 — Snapshot do briefing matinal (para o fechamento do dia)
-- Guarda o que saiu no resumo das 07h para o fechamento das 18:30 comparar
-- e mostrar o que foi concluído/ficou pendente/passa pro dia seguinte.
-- ============================================================

CREATE TABLE IF NOT EXISTS briefing_snapshots (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  snapshot_date DATE         NOT NULL,
  payload       JSON         NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_briefing_snapshot (user_id, snapshot_date),
  CONSTRAINT fk_briefing_snapshot_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Validar as 3 migrations com o parser de migrations do projeto**

Run: `node --test tests/migrations.test.mjs`
Expected: PASS — `tests/migrations.test.mjs` varre `migrations/*.sql` e valida sintaxe/
parsing; as 3 novas devem passar pelas mesmas checagens das existentes sem ajuste de código.

- [ ] **Step 5: Rodar as migrations localmente (se houver banco de dev acessível)**

Run: `npm run migrate` (ou o script equivalente do `package.json`)
Expected: as 3 novas aparecem no log de migrations aplicadas, sem erro. **Se não houver banco
local acessível nesta máquina**, pule este step — as migrations rodam automaticamente no boot
do deploy (`src/config/migrations.ts`), já confirmado em sessão anterior (ver
`docs/superpowers/specs/2026-08-21-briefing-matinal-design.md`).

- [ ] **Step 6: Commit**

```bash
git add migrations/095_client_birth_date.sql migrations/096_movement_ai_summary.sql migrations/097_briefing_snapshots.sql
git commit -m "feat(schema): adiciona birth_date, ai_summary de movimentação e briefing_snapshots"
```

---

## Task 4: Classificador de severidade (lógica pura, sem I/O)

**Files:**
- Create: `src/services/briefingSeverity.ts`
- Test: `tests/briefingSeverity.test.mjs`

**Interfaces:**
- Consumes: nenhuma dependência de tasks anteriores (módulo puro).
- Produces:
  - `type Severity = 'critica' | 'atencao' | 'acompanhamento' | 'pode_esperar'`
  - `type BriefingItem = { id: string; kind: 'prazo' | 'agenda' | 'pagamento' | 'movimentacao' | 'esteira' | 'lead' | 'email_parceria'; label: string; severity: Severity; ordemDesempate: number }`
  - `classificarPrazo(diasParaVencer: number): Severity`
  - `classificarAgenda(ehHoje: boolean): Severity`
  - `classificarPagamento(diasParaVencer: number): Severity`
  - `classificarMovimentacao(prioridadeIA: 'Alta' | 'Média' | 'Baixa' | null): Severity`
  - `classificarEsteira(diasParado: number): Severity`
  - `classificarLead(horasSemResposta: number): Severity`
  - `top3(itens: BriefingItem[]): BriefingItem[]` — usada pela Task 13 (template).

Usado pelas Tasks 9-12 (montagem dos blocos de conteúdo) e Task 13 (template).

- [ ] **Step 1: Escrever os testes de classificação**

```javascript
// tests/briefingSeverity.test.mjs
// Regra fixa por tipo de item (não delegada a IA) — ver seção 3 do spec
// docs/superpowers/specs/2026-08-21-briefing-matinal-design.md.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/briefingSeverity.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const {
  classificarPrazo, classificarAgenda, classificarPagamento,
  classificarMovimentacao, classificarEsteira, classificarLead, top3,
} = await import('../dist/services/briefingSeverity.js');

test('prazo hoje ou amanhã é crítico', () => {
  assert.equal(classificarPrazo(0), 'critica');
  assert.equal(classificarPrazo(1), 'critica');
});
test('prazo em 3 dias é atenção, em mais de 3 é acompanhamento', () => {
  assert.equal(classificarPrazo(3), 'atencao');
  assert.equal(classificarPrazo(7), 'acompanhamento');
});

test('compromisso de agenda hoje é crítico, senão acompanhamento', () => {
  assert.equal(classificarAgenda(true), 'critica');
  assert.equal(classificarAgenda(false), 'acompanhamento');
});

test('pagamento vencendo hoje é crítico; em breve é atenção; futuro é pode_esperar', () => {
  assert.equal(classificarPagamento(0), 'critica');
  assert.equal(classificarPagamento(2), 'atencao');
  assert.equal(classificarPagamento(10), 'pode_esperar');
});

test('movimentação com prioridade Alta é crítica, Média é atenção, Baixa/nula é acompanhamento', () => {
  assert.equal(classificarMovimentacao('Alta'), 'critica');
  assert.equal(classificarMovimentacao('Média'), 'atencao');
  assert.equal(classificarMovimentacao('Baixa'), 'acompanhamento');
  assert.equal(classificarMovimentacao(null), 'acompanhamento');
});

test('caso parado na esteira > 10 dias é atenção; <= 10 é pode_esperar', () => {
  assert.equal(classificarEsteira(11), 'atencao');
  assert.equal(classificarEsteira(10), 'pode_esperar');
  assert.equal(classificarEsteira(3), 'pode_esperar');
});

test('lead sem resposta < 48h é acompanhamento; >= 48h é pode_esperar (já frio)', () => {
  assert.equal(classificarLead(10), 'acompanhamento');
  assert.equal(classificarLead(48), 'pode_esperar');
  assert.equal(classificarLead(72), 'pode_esperar');
});

test('top3 pega só os críticos, ordenados por ordemDesempate, no máximo 3', () => {
  const itens = [
    { id: 'a', kind: 'movimentacao', label: 'A', severity: 'critica', ordemDesempate: 4 },
    { id: 'b', kind: 'prazo', label: 'B', severity: 'critica', ordemDesempate: 1 },
    { id: 'c', kind: 'agenda', label: 'C', severity: 'critica', ordemDesempate: 2 },
    { id: 'd', kind: 'pagamento', label: 'D', severity: 'critica', ordemDesempate: 5 },
    { id: 'e', kind: 'esteira', label: 'E', severity: 'atencao', ordemDesempate: 1 },
  ];
  const r = top3(itens);
  assert.deepEqual(r.map((i) => i.id), ['b', 'c', 'a']);
});

test('top3 com menos de 3 críticos devolve só os que existem', () => {
  const itens = [
    { id: 'a', kind: 'prazo', label: 'A', severity: 'critica', ordemDesempate: 1 },
  ];
  assert.deepEqual(top3(itens).map((i) => i.id), ['a']);
});

test('top3 sem nenhum crítico devolve lista vazia', () => {
  const itens = [
    { id: 'a', kind: 'esteira', label: 'A', severity: 'atencao', ordemDesempate: 1 },
  ];
  assert.deepEqual(top3(itens), []);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/briefingSeverity.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/services/briefingSeverity.ts`**

```typescript
/**
 * Classificador de severidade do briefing matinal — regra fixa por tipo de
 * item (não delegada a IA), para ser previsível e auditável. Ver seção 3 do
 * spec docs/superpowers/specs/2026-08-21-briefing-matinal-design.md.
 */
export type Severity = 'critica' | 'atencao' | 'acompanhamento' | 'pode_esperar';

export interface BriefingItem {
  id: string;
  kind: 'prazo' | 'agenda' | 'pagamento' | 'movimentacao' | 'esteira' | 'lead' | 'email_parceria';
  label: string;
  severity: Severity;
  /** Menor valor = mais urgente dentro do mesmo kind. Usado só para desempatar o top3. */
  ordemDesempate: number;
}

export function classificarPrazo(diasParaVencer: number): Severity {
  if (diasParaVencer <= 1) return 'critica';
  if (diasParaVencer <= 3) return 'atencao';
  return 'acompanhamento';
}

export function classificarAgenda(ehHoje: boolean): Severity {
  return ehHoje ? 'critica' : 'acompanhamento';
}

export function classificarPagamento(diasParaVencer: number): Severity {
  if (diasParaVencer <= 0) return 'critica';
  if (diasParaVencer <= 3) return 'atencao';
  return 'pode_esperar';
}

export function classificarMovimentacao(prioridadeIA: 'Alta' | 'Média' | 'Baixa' | null): Severity {
  if (prioridadeIA === 'Alta') return 'critica';
  if (prioridadeIA === 'Média') return 'atencao';
  return 'acompanhamento';
}

export function classificarEsteira(diasParado: number): Severity {
  return diasParado > 10 ? 'atencao' : 'pode_esperar';
}

export function classificarLead(horasSemResposta: number): Severity {
  return horasSemResposta < 48 ? 'acompanhamento' : 'pode_esperar';
}

// Ordem de prioridade entre TIPOS de item quando dois itens críticos empatam
// em ordemDesempate — ver seção 3 do spec: "prazo fatal > audiência/reunião >
// tutela/liminar > movimentação prioridade alta > pagamento".
const PESO_KIND: Record<BriefingItem['kind'], number> = {
  prazo: 0, agenda: 1, movimentacao: 2, pagamento: 3, esteira: 4, lead: 5, email_parceria: 6,
};

/** Os até 3 itens críticos de maior urgência, para o fecho "3 prioridades do dia". Determinístico. */
export function top3(itens: BriefingItem[]): BriefingItem[] {
  return itens
    .filter((i) => i.severity === 'critica')
    .sort((a, b) => a.ordemDesempate - b.ordemDesempate || PESO_KIND[a.kind] - PESO_KIND[b.kind])
    .slice(0, 3);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/briefingSeverity.test.mjs`
Expected: PASS em todos.

- [ ] **Step 5: Suíte inteira**

Run: `node --test "tests/**/*.test.mjs"`
Expected: todos passando (Tasks 1-4 combinadas).

- [ ] **Step 6: Commit**

```bash
git add src/services/briefingSeverity.ts tests/briefingSeverity.test.mjs
git commit -m "feat: classificador de severidade do briefing (regra fixa, testável isoladamente)"
```

---

## Task 5: Interpretação de movimentações por IA

**Files:**
- Modify: `src/services/aiAssistant.ts` (adicionar função nova; não mexer nas existentes)
- Modify: `src/services/monitoringService.ts:219-227` (chamar a interpretação após novas
  movimentações)
- Test: `tests/movementInterpretation.test.mjs`

**Interfaces:**
- Consumes: `aiComplete(prompt, prefer)` de `aiAssistant.ts` (já existe, Task não muda).
- Produces: `interpretarMovimentacao(movementId: number, texto: string): Promise<{ ok: boolean; summary?: MovementAiSummary }>`,
  exportada de `aiAssistant.ts`. `MovementAiSummary = { resumo: string; acao: string; prazo_interno: string; prioridade: 'Alta' | 'Média' | 'Baixa' }`.
  Usada pela Task 9 (montagem do bloco de movimentações no briefing) e pelo cron da Task 12.

- [ ] **Step 1: Escrever o teste com mock (sem chamar Groq de verdade)**

```javascript
// tests/movementInterpretation.test.mjs
// Testa o parser da resposta da IA isoladamente — não faz chamada de rede.
// A chamada real a aiComplete() é coberta por teste manual (documentado no
// PR), já que depende de GROQ_API_KEY em ambiente.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/aiAssistant.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { parseMovementAiResponse } = await import('../dist/services/aiAssistant.js');

test('parseia resposta bem formada da IA', () => {
  const texto = `RESUMO: Juízo determinou apresentação dos cálculos em 8 dias.
AÇÃO: preparar liquidação no PJe-Calc
PRAZO INTERNO: 25/08/2026
PRIORIDADE: Alta`;
  const r = parseMovementAiResponse(texto);
  assert.equal(r.resumo, 'Juízo determinou apresentação dos cálculos em 8 dias.');
  assert.equal(r.acao, 'preparar liquidação no PJe-Calc');
  assert.equal(r.prazo_interno, '25/08/2026');
  assert.equal(r.prioridade, 'Alta');
});

test('prioridade fora do vocabulário esperado cai para Baixa (nunca quebra)', () => {
  const texto = `RESUMO: teste
AÇÃO: nenhuma
PRAZO INTERNO: sem prazo
PRIORIDADE: Urgentíssimo`;
  assert.equal(parseMovementAiResponse(texto).prioridade, 'Baixa');
});

test('resposta sem os marcadores esperados devolve valores vazios, sem lançar', () => {
  const r = parseMovementAiResponse('texto solto sem formato nenhum');
  assert.equal(r.resumo, '');
  assert.equal(r.prioridade, 'Baixa');
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/movementInterpretation.test.mjs`
Expected: FAIL — `parseMovementAiResponse` não existe.

- [ ] **Step 3: Implementar em `src/services/aiAssistant.ts`**

Adicionar ao final do arquivo (depois de `runEstagiarioForDeadline` e suas funções
auxiliares, sem tocar nelas):

```typescript
export interface MovementAiSummary {
  resumo: string;
  acao: string;
  prazo_interno: string;
  prioridade: 'Alta' | 'Média' | 'Baixa';
}

/** Extrai os 4 campos da resposta em texto da IA. Nunca lança — na dúvida, devolve valores vazios/Baixa. */
export function parseMovementAiResponse(texto: string): MovementAiSummary {
  const campo = (rotulo: string) => {
    const m = texto.match(new RegExp(`${rotulo}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const prioridadeRaw = campo('PRIORIDADE');
  const prioridade: MovementAiSummary['prioridade'] =
    prioridadeRaw === 'Alta' || prioridadeRaw === 'Média' ? prioridadeRaw : 'Baixa';
  return {
    resumo: campo('RESUMO'),
    acao: campo('AÇÃO'),
    prazo_interno: campo('PRAZO INTERNO'),
    prioridade,
  };
}

/**
 * Interpreta UMA movimentação processual para o briefing matinal (seção 4 do
 * spec) — reaproveita o mesmo padrão de análise do Estagiário IA
 * (runEstagiarioForDeadline), mas roda para toda movimentação nova do dia,
 * não só as que geram prazo detectado.
 */
export async function interpretarMovimentacao(
  movementId: number,
  texto: string
): Promise<{ ok: boolean; summary?: MovementAiSummary; message?: string }> {
  const teor = (texto || '').trim();
  if (!teor) return { ok: false, message: 'Sem texto da movimentação' };
  const prompt = `Você é assistente jurídico(a) experiente. Leia a movimentação processual abaixo e responda EXATAMENTE neste formato, sem texto fora dele:
RESUMO: <1-2 linhas, linguagem simples>
AÇÃO: <ação necessária, ou "nenhuma" se for andamento de rotina sem exigir providência>
PRAZO INTERNO: <data sugerida dd/mm/aaaa, ou "sem prazo">
PRIORIDADE: <Alta, Média ou Baixa>

MOVIMENTAÇÃO:
${teor}`;
  const r = await aiComplete(prompt, 'groq');
  if (!r.ok || !r.text) return { ok: false, message: r.message || 'IA indisponível' };
  const summary = parseMovementAiResponse(r.text);
  await db.query('UPDATE process_movements SET ai_summary = ? WHERE id = ?', [JSON.stringify(summary), movementId]);
  return { ok: true, summary };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/movementInterpretation.test.mjs`
Expected: PASS nos 3 testes.

- [ ] **Step 5: Chamar a interpretação após inserir movimentação nova**

Em `src/services/monitoringService.ts`, dentro de `syncProcess` (por volta da linha 205),
onde já existe a chamada a `detectDeadline` logo após um INSERT bem-sucedido em
`process_movements`:

```typescript
      if (ins.affectedRows) {
        novas++;
        if (m.movement_date && (!latest || m.movement_date > latest)) latest = m.movement_date;
        await detectDeadline(processId, proc.client_id, m, proc.process_number, ins.insertId, provider.name);
      }
```

Adicione a chamada de interpretação logo depois de `detectDeadline`, no mesmo bloco (best
effort — nunca pode travar a sincronização se a IA falhar):

```typescript
      if (ins.affectedRows) {
        novas++;
        if (m.movement_date && (!latest || m.movement_date > latest)) latest = m.movement_date;
        await detectDeadline(processId, proc.client_id, m, proc.process_number, ins.insertId, provider.name);
        // Interpretação para o briefing matinal — best-effort, nunca trava a sincronização.
        const { interpretarMovimentacao } = await import('./aiAssistant');
        await interpretarMovimentacao(ins.insertId, `${m.title || ''}\n${m.description || ''}`.trim())
          .catch((e) => console.error(`[movimentação ${ins.insertId}] falha ao interpretar:`, e?.message || e));
      }
```

- [ ] **Step 6: Build e suíte inteira**

Run: `npx tsc && node --test "tests/**/*.test.mjs"`
Expected: todos passando.

- [ ] **Step 7: Commit**

```bash
git add src/services/aiAssistant.ts src/services/monitoringService.ts tests/movementInterpretation.test.mjs
git commit -m "feat: interpreta movimentações processuais por IA (resumo/ação/prazo/prioridade) para o briefing"
```

---

## Task 6: Agenda de 3 dias, financeiro granular, comercial e esteira/documentos pendentes

**Files:**
- Modify: `src/services/morningBriefingService.ts` (adicionar funções novas; as existentes
  `getWeather`, `fraseDoDia`, `getPulsoNegocio` continuam existindo e sendo usadas)
- Test: `tests/briefingDataBlocks.test.mjs`

**Interfaces:**
- Consumes: nada de tasks anteriores diretamente (é SQL novo), mas usa
  `classificarAgenda`/`classificarPagamento`/`classificarEsteira`/`classificarLead` da
  Task 4 para anotar a severidade de cada linha retornada.
- Produces:
  - `getAgenda3Dias(userId: number): Promise<AgendaItem[]>` —
    `AgendaItem = { titulo: string; tipo: string; data: string; hora: string; local: string | null; videoLink: string | null; severity: Severity }`
  - `getFinanceiroGranular(): Promise<FinanceiroGranular>` —
    `FinanceiroGranular = { aReceberHoje: number; rpvSemana: number; recebido7d: number; alvarasAguardando: number }`
  - `getComercialDoDia(): Promise<{ leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] }>`
  - `getEsteiraEDocumentos(): Promise<{ pecasAProduzir: PecaPendente[]; documentosPendentes: DocumentoPendente[] }>`

Estas 4 funções alimentam o template novo (Task 7).

- [ ] **Step 1: Escrever os testes (queries testadas contra o schema real via `tests/dashboards.test.mjs`-style, ou como funções puras onde possível)**

Como estas funções fazem `db.query`, seguindo o padrão já usado em
`tests/dashboards.test.mjs` (cruza a query com o schema real, sem precisar de dados), o teste
valida que as colunas/tabelas referenciadas existem e que o SQL é sintaticamente válido —
não valida resultado de dado real (isso é smoke-test manual pós-deploy).

```javascript
// tests/briefingDataBlocks.test.mjs
// Valida que as 4 novas funções de dado do briefing referenciam colunas/
// tabelas que de fato existem no schema — mesmo padrão de tests/dashboards.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/morningBriefingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const mod = await import('../dist/services/morningBriefingService.js');

test('getAgenda3Dias, getFinanceiroGranular, getComercialDoDia e getEsteiraEDocumentos são exportadas', () => {
  assert.equal(typeof mod.getAgenda3Dias, 'function');
  assert.equal(typeof mod.getFinanceiroGranular, 'function');
  assert.equal(typeof mod.getComercialDoDia, 'function');
  assert.equal(typeof mod.getEsteiraEDocumentos, 'function');
});

// Colunas referenciadas pelas novas queries precisam existir nas migrations.
const schemaSql = readdirSync(new URL('../migrations', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'))
  .join('\n');

test('clients.birth_date existe (migration 095)', () => {
  assert.match(schemaSql, /birth_date\s+DATE/i);
});
test('cases.checklist_checked existe (migration 065, reaproveitada)', () => {
  assert.match(schemaSql, /checklist_checked\s+JSON/i);
});
test('cases.production_stage e production_started_at existem (migrations 010/044)', () => {
  assert.match(schemaSql, /production_stage\s+ENUM/i);
  assert.match(schemaSql, /production_started_at/i);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/briefingDataBlocks.test.mjs`
Expected: FAIL — as 4 funções ainda não existem.

- [ ] **Step 3: Implementar as 4 funções em `morningBriefingService.ts`**

Adicionar depois de `getPulsoNegocio` (linha 233), antes de `pulsoHtml`:

```typescript
import { classificarAgenda, classificarPagamento, classificarEsteira, classificarLead, Severity } from './briefingSeverity';

interface AgendaItem {
  titulo: string; tipo: string; data: string; hora: string;
  local: string | null; videoLink: string | null; severity: Severity;
}

/** Agenda de hoje + 3 dias (antes só trazia hoje). */
export async function getAgenda3Dias(userId: number): Promise<AgendaItem[]> {
  const [rows] = await db.query(
    `SELECT title, event_type, location, video_link,
            DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00')) AS data,
            TIME_FORMAT(CONVERT_TZ(start_datetime,'+00:00','-03:00'),'%H:%i') AS hora,
            DATEDIFF(DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00')), DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))) AS diasAteEvento
       FROM calendar_events
      WHERE user_id = ?
        AND DATE(CONVERT_TZ(start_datetime,'+00:00','-03:00'))
            BETWEEN DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')) AND DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')), INTERVAL 3 DAY)
      ORDER BY start_datetime ASC`, [userId]) as any;
  return rows.map((r: any) => ({
    titulo: r.title, tipo: r.event_type, data: r.data, hora: r.hora,
    local: r.location, videoLink: r.video_link,
    severity: classificarAgenda(Number(r.diasAteEvento) === 0),
  }));
}

interface FinanceiroGranular {
  aReceberHoje: number; rpvSemana: number; recebido7d: number; alvarasAguardando: number;
}

/** Financeiro desagregado por tipo (antes era um único total no "Pulso"). */
export async function getFinanceiroGranular(): Promise<FinanceiroGranular> {
  const one = async (sql: string) => { const [[r]] = await db.query(sql) as any; return r; };
  const r = await one(`
    SELECT
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE status='pendente' AND due_date = CURDATE())
      + (SELECT COALESCE(SUM(valor_final),0) FROM parcelas WHERE status IN ('aberto','atrasado') AND data_vencimento = CURDATE())
        AS a_receber_hoje,
      (SELECT COALESCE(SUM(valor_escritorio),0) FROM case_awards WHERE status='aguardando' AND previsao_pagamento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY))
        AS rpv_semana,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE status='pago' AND updated_at >= NOW() - INTERVAL 7 DAY)
      + (SELECT COALESCE(SUM(valor_final),0) FROM parcelas WHERE status='pago' AND updated_at >= NOW() - INTERVAL 7 DAY)
        AS recebido_7d,
      (SELECT COUNT(*) FROM case_awards WHERE status='aguardando' AND alvara_recebido = 0)
        AS alvaras_aguardando
  `).catch(() => ({ a_receber_hoje: 0, rpv_semana: 0, recebido_7d: 0, alvaras_aguardando: 0 }));
  return {
    aReceberHoje: Number(r.a_receber_hoje) || 0,
    rpvSemana: Number(r.rpv_semana) || 0,
    recebido7d: Number(r.recebido_7d) || 0,
    alvarasAguardando: Number(r.alvaras_aguardando) || 0,
  };
}

interface LeadNovo { nome: string; area: string; origem: string; criadoEm: string; }
interface Aniversariante { nome: string; }

/** Leads criados desde o último briefing + aniversariantes de clientes hoje. */
export async function getComercialDoDia(): Promise<{ leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] }> {
  const [leads] = await db.query(`
    SELECT name AS nome, COALESCE(area, 'não informada') AS area, COALESCE(source, 'não informado') AS origem, created_at AS criadoEm
      FROM leads
     WHERE created_at >= NOW() - INTERVAL 1 DAY
     ORDER BY created_at DESC`).catch(() => [[]]) as any;
  const [aniversariantes] = await db.query(`
    SELECT name AS nome FROM clients
     WHERE birth_date IS NOT NULL
       AND MONTH(birth_date) = MONTH(CURDATE()) AND DAY(birth_date) = DAY(CURDATE())`).catch(() => [[]]) as any;
  return { leadsNovos: leads, aniversariantes };
}

interface PecaPendente { caso: string; fase: string; diasParado: number; severity: Severity; }
interface DocumentoPendente { caso: string; itensFaltando: string[]; }

/** Casos parados na esteira de produção + documentos ainda não marcados no checklist. */
export async function getEsteiraEDocumentos(): Promise<{ pecasAProduzir: PecaPendente[]; documentosPendentes: DocumentoPendente[] }> {
  const [casos] = await db.query(`
    SELECT title AS caso, production_stage AS fase, checklist_checked,
           DATEDIFF(NOW(), production_started_at) AS diasParado
      FROM cases
     WHERE production_stage IN ('separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')
       AND production_started_at IS NOT NULL
     ORDER BY production_started_at ASC`) as any;

  const pecasAProduzir: PecaPendente[] = casos.map((c: any) => ({
    caso: c.caso, fase: c.fase, diasParado: Number(c.diasParado) || 0,
    severity: classificarEsteira(Number(c.diasParado) || 0),
  }));

  const documentosPendentes: DocumentoPendente[] = casos
    .filter((c: any) => c.fase === 'separacao_documentos' && c.checklist_checked)
    .map((c: any) => {
      let checklist: Record<string, boolean> = {};
      try { checklist = JSON.parse(c.checklist_checked); } catch { /* checklist mal formado — trata como vazio */ }
      const itensFaltando = Object.entries(checklist).filter(([, marcado]) => !marcado).map(([item]) => item);
      return { caso: c.caso, itensFaltando };
    })
    .filter((d: DocumentoPendente) => d.itensFaltando.length > 0);

  return { pecasAProduzir, documentosPendentes };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/briefingDataBlocks.test.mjs`
Expected: PASS nos 5 testes.

- [ ] **Step 5: Suíte inteira**

Run: `node --test "tests/**/*.test.mjs"`
Expected: todos passando (Tasks 1-6 combinadas).

- [ ] **Step 6: Commit**

```bash
git add src/services/morningBriefingService.ts tests/briefingDataBlocks.test.mjs
git commit -m "feat: agenda de 3 dias, financeiro granular, comercial e esteira/documentos pendentes para o briefing"
```

---

## Task 7: Reescrever o template do e-mail (`buildHtml`)

**Files:**
- Modify: `src/services/morningBriefingService.ts:267-318` (função `buildHtml`)
- Test: `tests/briefingHtmlTemplate.test.mjs`

**Interfaces:**
- Consumes: `AgendaItem[]`, `FinanceiroGranular`, `LeadNovo[]`, `Aniversariante[]`,
  `PecaPendente[]`, `DocumentoPendente[]` (Task 6); `classificarPrazo`, `classificarPagamento`,
  `top3`, `BriefingItem` (Task 4); `MovementAiSummary` (Task 5).
- Produces: `buildHtml` com assinatura nova (mais parâmetros) — quem chama
  (`sendMorningBriefings`, Task 9) precisa ser atualizado junto.

Design visual já validado no protótipo (link no spec, seção 9): paleta navy/dourado mantida,
3 cores semânticas novas, faixa de contadores clicável, cabeçalhos de severidade com fundo
tingido, divisor entre triagem e referência, financeiro com friso por tipo, "Pode esperar"
discreto, fecho com "3 prioridades".

- [ ] **Step 1: Escrever o teste estrutural do HTML gerado**

```javascript
// tests/briefingHtmlTemplate.test.mjs
// Não testa pixel-a-pixel — valida que os blocos obrigatórios aparecem no
// HTML gerado e que a severidade decide em qual bloco cada item cai.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/morningBriefingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { buildHtml } = await import('../dist/services/morningBriefingService.js');

const agendaExemplo = [
  { titulo: 'Audiência Usiminas', tipo: 'audiencia', data: '2026-08-21', hora: '16:20', local: 'Vara do Trabalho', videoLink: null, severity: 'critica' },
];
const financeiroExemplo = { aReceberHoje: 480, rpvSemana: 2150, recebido7d: 6300, alvarasAguardando: 0 };
const comercialExemplo = { leadsNovos: [{ nome: 'Camila R.', area: 'trabalhista', origem: 'site', criadoEm: '2026-08-21' }], aniversariantes: [{ nome: 'Sérgio M.' }] };
const esteiraExemplo = { pecasAProduzir: [{ caso: 'Roberta L.', fase: 'criacao_inicial', diasParado: 6, severity: 'pode_esperar' }], documentosPendentes: [] };
const movimentacoesExemplo = [
  { processo: '0031224-88.2025.5.17.0007', clienteVsParte: 'Maria Aparecida × Rodotex', resumo: 'Decisão publicada.', acao: 'preparar liquidação', prazoInterno: '25/08', severity: 'critica' },
];

test('buildHtml inclui o nome do escritório e a saudação', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(html, /Bom dia, Dra\. Letícia/);
});

test('item crítico (audiência hoje) aparece no bloco de Atenção imediata', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  const idxAtencao = html.indexOf('Atenção imediata');
  const idxAudiencia = html.indexOf('Audiência Usiminas');
  assert.ok(idxAtencao > -1 && idxAudiencia > idxAtencao, 'audiência deve vir depois do cabeçalho de Atenção imediata');
});

test('movimentação interpretada mostra resumo, ação e prazo interno', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(html, /Maria Aparecida × Rodotex/);
  assert.match(html, /preparar liquidação/);
  assert.match(html, /25\/08/);
});

test('financeiro granular mostra os 4 valores', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(html, /480,00/);
  assert.match(html, /2\.150,00/);
  assert.match(html, /6\.300,00/);
});

test('sem nenhum item crítico, o bloco "3 prioridades" não aparece', () => {
  const html = buildHtml('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, [], financeiroExemplo, { leadsNovos: [], aniversariantes: [] }, { pecasAProduzir: [], documentosPendentes: [] }, []);
  assert.doesNotMatch(html, /3 coisas hoje/);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/briefingHtmlTemplate.test.mjs`
Expected: FAIL — assinatura antiga de `buildHtml` não aceita os novos parâmetros.

- [ ] **Step 3: Reescrever `buildHtml`**

Substituir a função inteira (linhas 267-318) por:

```typescript
// Adicionar ao import já existente da Task 6: `classificarPrazo` e `top3`.
// import { classificarAgenda, classificarPagamento, classificarEsteira, classificarLead, classificarPrazo, top3, Severity, BriefingItem } from './briefingSeverity';

const CRITICAL = '#b3432f', CRITICAL_SOFT = '#fbeae6';
const WARNING = '#a67626', WARNING_SOFT = '#faf1e0';
const OK_STRONG = '#2f8f63', OK_SOFT = '#eaf3ee';

interface MovimentacaoBriefing {
  processo: string; clienteVsParte: string; resumo: string; acao: string;
  prazoInterno: string; severity: import('./briefingSeverity').Severity;
}

function buildHtml(
  name: string, weather: Weather | null, agenda: any, pulso: any, meta: GoalProgress,
  agenda3d: AgendaItem[], financeiro: FinanceiroGranular,
  comercial: { leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] },
  esteira: { pecasAProduzir: PecaPendente[]; documentosPendentes: DocumentoPendente[] },
  movimentacoes: MovimentacaoBriefing[]
): string {
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const tipoLabel: Record<string, string> = { reuniao: '🤝 Reunião', audiencia: '⚖️ Audiência', compromisso: '📌 Compromisso' };

  // Monta os itens tipados (Task 4: briefingSeverity) para agrupar por severidade.
  const itensAgenda = agenda3d.map((a) => ({
    html: `<div class="item item-${a.severity === 'critica' ? 'critical' : a.severity === 'atencao' ? 'warning' : 'ok'}">
      <p class="item-title">${tipoLabel[a.tipo] || '📌'} ${a.titulo}</p>
      <p class="item-meta">${a.data} ${a.hora}${a.local ? ` · ${a.local}` : ''}${a.videoLink ? ' · online' : ''}</p>
    </div>`,
    severity: a.severity,
  }));
  const itensMovimentacao = movimentacoes.map((m) => ({
    html: `<div class="item item-${m.severity === 'critica' ? 'critical' : m.severity === 'atencao' ? 'warning' : 'ok'}">
      <p class="item-title">${m.clienteVsParte}</p>
      <p class="item-meta">Proc. ${m.processo} · ${m.resumo}</p>
      ${m.acao && m.acao !== 'nenhuma' ? `<div class="item-action"><b>Ação:</b> ${m.acao}${m.prazoInterno && m.prazoInterno !== 'sem prazo' ? ` · <b>prazo interno ${m.prazoInterno}</b>` : ''}</div>` : ''}
    </div>`,
    severity: m.severity,
  }));
  const itensPagamento = financeiro.aReceberHoje > 0 ? [{
    html: `<div class="item item-critical"><p class="item-title">${money(financeiro.aReceberHoje)} a receber vencendo hoje</p></div>`,
    severity: 'critica' as const,
  }] : [];
  // Prazos processuais de hoje (agenda.prazos já vem de getDayAgenda, existente) —
  // classificarPrazo(0) força 'critica' porque getDayAgenda só traz o dia de hoje.
  const itensPrazo = (agenda.prazos || []).map((p: any) => ({
    html: `<div class="item item-critical">
      <p class="item-title">⏰ Prazo: ${p.description}</p>
      <p class="item-meta">${p.case_number ? `Proc. ${p.case_number}` : ''}</p>
    </div>`,
    severity: classificarPrazo(0) as const,
  }));
  const itensEsteira = esteira.pecasAProduzir.map((p) => ({
    html: `<div class="item item-${p.severity === 'critica' ? 'critical' : p.severity === 'atencao' ? 'warning' : 'ok'}">
      <p class="item-title">${p.caso} — parado há ${p.diasParado} dia(s)</p>
      <p class="item-meta">Fase: ${p.fase}</p>
    </div>`,
    severity: p.severity,
  }]);

  const todosItens = [...itensAgenda, ...itensPrazo, ...itensMovimentacao, ...itensPagamento, ...itensEsteira];
  const criticos = todosItens.filter((i) => i.severity === 'critica');
  const atencao = todosItens.filter((i) => i.severity === 'atencao');
  const acompanhamento = todosItens.filter((i) => i.severity === 'acompanhamento');

  const sevBlock = (titulo: string, emoji: string, cls: string, itens: typeof todosItens, id: string) =>
    itens.length ? `
    <div class="sev-block sev-${cls}" id="${id}">
      <div class="sev-head"><span class="sev-dot"></span><h2 class="sev-title">${emoji} ${titulo}</h2><span class="sev-count">${itens.length}</span></div>
      ${itens.map((i) => i.html).join('')}
    </div>` : '';

  const agendaListaHtml = agenda3d.map((a) =>
    `<div class="agenda-row"><div class="agenda-day">${a.data}</div><div class="agenda-time">${a.hora}</div><div>${tipoLabel[a.tipo] || '📌'} ${a.titulo}${a.local ? ` <span class="pill pill-presencial">presencial</span>` : a.videoLink ? ` <span class="pill pill-online">online</span>` : ''}</div></div>`
  ).join('') || '<p style="color:#6b6252;font-size:13px">Sem compromissos nos próximos 3 dias.</p>';

  const comercialHtml = [
    ...comercial.leadsNovos.map((l) => `<div class="agenda-row"><div class="agenda-day">Novo lead</div><div>${l.nome} — ${l.area} · ${l.origem}</div></div>`),
    ...comercial.aniversariantes.map((a) => `<div class="agenda-row"><div class="agenda-day">🎂 Hoje</div><div>Aniversário de ${a.nome} (cliente)</div></div>`),
  ].join('') || '<p style="color:#6b6252;font-size:13px">Nada novo hoje.</p>';

  const podeEsperarPartes: string[] = [];
  if (esteira.pecasAProduzir.some((p) => p.severity === 'pode_esperar'))
    podeEsperarPartes.push(`${esteira.pecasAProduzir.filter((p) => p.severity === 'pode_esperar').length} caso(s) na esteira sem prazo em risco.`);
  const podeEsperarHtml = podeEsperarPartes.length
    ? `<h3 class="section" style="color:#6b6252;font-size:12px;margin-bottom:5px">⚪ Pode esperar</h3><p class="quiet-block">${podeEsperarPartes.map((p) => `<span>${p}</span>`).join('')}</p>`
    : '';

  // "3 prioridades do dia" — usa o classificador determinístico (Task 4), não uma nova síntese por IA.
  const briefingItems: import('./briefingSeverity').BriefingItem[] = [
    ...movimentacoes.filter((m) => m.severity === 'critica').map((m, idx) => ({ id: `mov-${idx}`, kind: 'movimentacao' as const, label: `${m.acao} — ${m.clienteVsParte}`, severity: m.severity, ordemDesempate: idx })),
    ...agenda3d.filter((a) => a.severity === 'critica').map((a, idx) => ({ id: `ag-${idx}`, kind: 'agenda' as const, label: `${a.titulo}, ${a.hora}`, severity: a.severity, ordemDesempate: idx })),
  ];
  const top3Items = top3(briefingItems);
  const top3Html = top3Items.length ? `
    <div class="top3">
      <div class="top3-label">🎯 Se você fizer só 3 coisas hoje</div>
      <ol>${top3Items.map((i: import('./briefingSeverity').BriefingItem) => `<li>${i.label}</li>`).join('')}</ol>
    </div>` : '';

  const body = `
    <div style="font-size:12px;color:${GOLD};text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:2px">${hoje}</div>
    <p style="font-size:19px;font-weight:700;color:${NAVY};margin:0 0 16px">Bom dia, Dra. ${name}! ☀️</p>

    <div style="background:${GOLD_SOFT};border-radius:8px;padding:16px 18px;margin-bottom:16px">
      <div style="font-size:9px;color:#8a6d1a;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px">Frase de força do dia</div>
      <p style="margin:0;font-size:14.5px;line-height:1.6;color:#4a3d1d;font-style:italic">"${fraseDoDia()}"</p>
    </div>

    ${criticos.length || atencao.length || acompanhamento.length ? `
    <div style="display:flex;gap:8px;margin:0 0 26px">
      <a href="#atencao" style="flex:1;text-align:center;text-decoration:none;padding:9px 4px 8px;border-radius:8px;background:${CRITICAL_SOFT};color:${CRITICAL}"><span style="display:block;font-size:17px;font-weight:700">${criticos.length}</span><span style="display:block;font-size:9.5px;text-transform:uppercase">atenção</span></a>
      <a href="#atencao2" style="flex:1;text-align:center;text-decoration:none;padding:9px 4px 8px;border-radius:8px;background:${WARNING_SOFT};color:${WARNING}"><span style="display:block;font-size:17px;font-weight:700">${atencao.length}</span><span style="display:block;font-size:9.5px;text-transform:uppercase">prioridade</span></a>
      <a href="#acompanhamento" style="flex:1;text-align:center;text-decoration:none;padding:9px 4px 8px;border-radius:8px;background:${OK_SOFT};color:${OK_STRONG}"><span style="display:block;font-size:17px;font-weight:700">${acompanhamento.length}</span><span style="display:block;font-size:9.5px;text-transform:uppercase">acompanhar</span></a>
    </div>` : ''}

    ${sevBlock('Atenção imediata', '🔴', 'critical', criticos, 'atencao')}
    ${sevBlock('Prioridade do dia', '🟠', 'warning', atencao, 'atencao2')}
    ${sevBlock('Acompanhamento', '🟢', 'ok', acompanhamento, 'acompanhamento')}

    <hr style="border:none;border-top:1px solid #e2ddd1;margin:26px 0">

    <h3 style="color:${NAVY};font-size:15px;margin:0 0 8px;font-family:Georgia,serif">📅 Agenda — hoje e próximos 3 dias</h3>
    ${agendaListaHtml}

    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">💰 Financeiro</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:6px 0 4px">
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${CRITICAL}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${money(financeiro.aReceberHoje)}</div><div style="font-size:11px;color:#6b6252">a receber vencendo hoje</div></div>
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${NAVY}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${money(financeiro.rpvSemana)}</div><div style="font-size:11px;color:#6b6252">RPV prevista esta semana</div></div>
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${OK_STRONG}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${money(financeiro.recebido7d)}</div><div style="font-size:11px;color:#6b6252">recebido nos últimos 7 dias</div></div>
      <div style="background:${NAVY_SOFT};border-radius:8px;padding:12px 14px;border-left:3px solid ${NAVY}"><div style="font-size:16px;font-weight:700;color:${NAVY}">${financeiro.alvarasAguardando}</div><div style="font-size:11px;color:#6b6252">alvarás aguardando conferência</div></div>
    </div>

    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">📲 Comercial</h3>
    ${comercialHtml}

    <h3 style="color:${NAVY};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">⚖️ Radar jurídico</h3>
    <div style="border:1px dashed #e2ddd1;border-radius:8px;padding:12px 16px;font-size:12.5px;color:#6b6252">Em construção — só vai trazer algo quando houver Informativo do STJ relevante às suas áreas. Nada aqui hoje.</div>

    ${podeEsperarHtml}
    ${top3Html}

    <div style="border:1px solid #e2ddd1;border-radius:8px;padding:16px 18px;margin-top:20px;text-align:center">
      <p style="margin:0;font-size:13px;color:#6b6252">🧘 Antes de começar: já bebeu água hoje? Um alongamento de 2 minutos também conta.</p>
    </div>

    <p style="margin-top:22px;text-align:center"><a href="https://crm.advogadaleticiabarros.com.br" style="display:inline-block;background:${GOLD};color:#231e17;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold;font-family:Arial,sans-serif">Abrir o CRM</a></p>`;

  return layout(`Resumo de ${hoje}`, body);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/briefingHtmlTemplate.test.mjs`
Expected: PASS nos 5 testes.

- [ ] **Step 5: Suíte inteira**

Run: `node --test "tests/**/*.test.mjs"`
Expected: todos passando.

- [ ] **Step 6: Commit**

```bash
git add src/services/morningBriefingService.ts tests/briefingHtmlTemplate.test.mjs
git commit -m "feat: reescreve o template do e-mail do briefing com hierarquia por severidade"
```

---

## Task 8: Reescrever o template do WhatsApp (`buildWhatsappText`) com paridade total

**Files:**
- Modify: `src/services/morningBriefingService.ts` (função `buildWhatsappText`, linhas
  originais 377-411 antes das mudanças anteriores)
- Test: `tests/briefingWhatsappTemplate.test.mjs`

**Interfaces:**
- Consumes: os mesmos tipos da Task 7 (`AgendaItem[]`, `FinanceiroGranular`, etc.).
- Produces: `buildWhatsappText` com a mesma assinatura estendida de `buildHtml`.

Decisão do spec (seção 9): paridade total de conteúdo entre e-mail e WhatsApp — sem versão
resumida.

- [ ] **Step 1: Escrever o teste**

```javascript
// tests/briefingWhatsappTemplate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/morningBriefingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { buildWhatsappText } = await import('../dist/services/morningBriefingService.js');

const agendaExemplo = [
  { titulo: 'Audiência Usiminas', tipo: 'audiencia', data: '2026-08-21', hora: '16:20', local: 'Vara do Trabalho', videoLink: null, severity: 'critica' },
];
const financeiroExemplo = { aReceberHoje: 480, rpvSemana: 2150, recebido7d: 6300, alvarasAguardando: 0 };
const comercialExemplo = { leadsNovos: [], aniversariantes: [] };
const esteiraExemplo = { pecasAProduzir: [], documentosPendentes: [] };
const movimentacoesExemplo = [
  { processo: '0031224-88.2025.5.17.0007', clienteVsParte: 'Maria Aparecida × Rodotex', resumo: 'Decisão publicada.', acao: 'preparar liquidação', prazoInterno: '25/08', severity: 'critica' },
];

test('WhatsApp tem os mesmos blocos de severidade do e-mail (paridade total)', () => {
  const texto = buildWhatsappText('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.match(texto, /ATENÇÃO IMEDIATA/);
  assert.match(texto, /Maria Aparecida × Rodotex/);
  assert.match(texto, /preparar liquidação/);
  assert.match(texto, /Financeiro/);
  assert.match(texto, /480/);
});

test('não usa HTML — só texto/markdown do WhatsApp (*negrito*, _itálico_)', () => {
  const texto = buildWhatsappText('Letícia', null, { eventos: [], prazos: [], tarefas: [] }, {}, { current: 0, target: 1, percent: 0, faltam: 1, contratos_fechados_mes: 0 }, agendaExemplo, financeiroExemplo, comercialExemplo, esteiraExemplo, movimentacoesExemplo);
  assert.doesNotMatch(texto, /<[a-z]+>/i);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/briefingWhatsappTemplate.test.mjs`
Expected: FAIL — assinatura antiga.

- [ ] **Step 3: Reescrever `buildWhatsappText`**

Substituir a função (que hoje recebe só `name, weather, agenda, pulso, meta`) para aceitar os
mesmos parâmetros novos de `buildHtml` (Task 7) e espelhar a mesma estrutura de blocos:

```typescript
function buildWhatsappText(
  name: string, weather: Weather | null, agenda: any, pulso: any, meta: GoalProgress,
  agenda3d: AgendaItem[], financeiro: FinanceiroGranular,
  comercial: { leadsNovos: LeadNovo[]; aniversariantes: Aniversariante[] },
  esteira: { pecasAProduzir: PecaPendente[]; documentosPendentes: DocumentoPendente[] },
  movimentacoes: MovimentacaoBriefing[]
): string {
  const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  const tipoLabel: Record<string, string> = { reuniao: '🤝', audiencia: '⚖️', compromisso: '📌' };

  const criticos = [
    ...agenda3d.filter((a) => a.severity === 'critica').map((a) => `${tipoLabel[a.tipo] || '📌'} ${a.titulo} — ${a.hora}${a.local ? ` (${a.local})` : ''}`),
    ...movimentacoes.filter((m) => m.severity === 'critica').map((m) => `⚖️ *${m.clienteVsParte}* — ${m.resumo}${m.acao && m.acao !== 'nenhuma' ? `\n*Ação:* ${m.acao}${m.prazoInterno && m.prazoInterno !== 'sem prazo' ? ` · prazo interno ${m.prazoInterno}` : ''}` : ''}`),
    ...(financeiro.aReceberHoje > 0 ? [`💰 ${money(financeiro.aReceberHoje)} vencendo hoje`] : []),
  ];
  const prioridade = [
    ...esteira.pecasAProduzir.filter((p) => p.severity === 'atencao').map((p) => `📝 ${p.caso} — parado há ${p.diasParado} dia(s)`),
  ];
  const acompanhar = [
    ...agenda3d.filter((a) => a.severity === 'acompanhamento').map((a) => `${tipoLabel[a.tipo] || '📌'} ${a.titulo} — ${a.data} ${a.hora}`),
  ];

  const blocos: string[] = [];
  blocos.push(`☀️ *Bom dia, Dra. ${name}!*\n${hoje}`);
  blocos.push(`💛 _"${fraseDoDia()}"_`);
  if (criticos.length) blocos.push(`🔴 *ATENÇÃO IMEDIATA (${criticos.length})*\n\n${criticos.join('\n\n')}`);
  if (prioridade.length) blocos.push(`🟠 *PRIORIDADE DO DIA (${prioridade.length})*\n\n${prioridade.join('\n')}`);
  if (acompanhar.length) blocos.push(`🟢 *ACOMPANHAMENTO (${acompanhar.length})*\n\n${acompanhar.join('\n')}`);

  const agendaLinhas = agenda3d.map((a) => `${tipoLabel[a.tipo] || '📌'} ${a.data} ${a.hora} — ${a.titulo}`);
  blocos.push(`📅 *Agenda*\n${agendaLinhas.length ? agendaLinhas.join('\n') : 'Sem compromissos nos próximos 3 dias.'}`);

  blocos.push(`💰 *Financeiro*\n${money(financeiro.aReceberHoje)} a receber hoje · ${money(financeiro.rpvSemana)} RPV esta semana · ${money(financeiro.recebido7d)} recebidos (7d)`);

  const comercialLinhas = [
    ...comercial.leadsNovos.map((l) => `Novo lead: ${l.nome} (${l.area})`),
    ...comercial.aniversariantes.map((a) => `🎂 Aniversário hoje: ${a.nome}`),
  ];
  if (comercialLinhas.length) blocos.push(`📲 *Comercial*\n${comercialLinhas.join('\n')}`);

  blocos.push(`⚖️ *Radar jurídico*\nEm construção — nada relevante hoje.`);

  const briefingItems: import('./briefingSeverity').BriefingItem[] = [
    ...movimentacoes.filter((m) => m.severity === 'critica').map((m, idx) => ({ id: `mov-${idx}`, kind: 'movimentacao' as const, label: `${m.acao} — ${m.clienteVsParte}`, severity: m.severity, ordemDesempate: idx })),
    ...agenda3d.filter((a) => a.severity === 'critica').map((a, idx) => ({ id: `ag-${idx}`, kind: 'agenda' as const, label: `${a.titulo}, ${a.hora}`, severity: a.severity, ordemDesempate: idx })),
  ];
  const top = top3(briefingItems);
  if (top.length) blocos.push(`🎯 *Se você fizer só 3 coisas hoje:*\n${top.map((i, idx) => `${idx + 1}. ${i.label}`).join('\n')}`);

  blocos.push(`🧘 Já bebeu água hoje? Qual é o seu objetivo pra hoje?`);
  return blocos.join('\n\n');
}
```

(Importar `top3` de `./briefingSeverity` no topo do arquivo, junto com os classificadores já
importados na Task 7.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/briefingWhatsappTemplate.test.mjs`
Expected: PASS nos 2 testes.

- [ ] **Step 5: Suíte inteira**

Run: `node --test "tests/**/*.test.mjs"`
Expected: todos passando.

- [ ] **Step 6: Commit**

```bash
git add src/services/morningBriefingService.ts tests/briefingWhatsappTemplate.test.mjs
git commit -m "feat: reescreve o template do WhatsApp do briefing com paridade total ao e-mail"
```

---

## Task 9: Conectar os dados novos em `sendMorningBriefings` e `sendMorningBriefingWhatsapp`

**Files:**
- Modify: `src/services/morningBriefingService.ts:330-441` (`sendMorningBriefings`,
  `sendMorningBriefingWhatsapp`)
- Test: nenhum novo — cobertura via `npm test` completo (estas funções fazem I/O real de
  e-mail/WhatsApp, não são unit-testáveis sem mock pesado; a lógica que importa já foi testada
  nas Tasks 4-8)

**Interfaces:**
- Consumes: `getAgenda3Dias`, `getFinanceiroGranular`, `getComercialDoDia`,
  `getEsteiraEDocumentos` (Task 6); `buildHtml`, `buildWhatsappText` com assinatura nova
  (Tasks 7-8); movimentações do dia vindas de `process_movements` (nova query nesta task).
- Produces: nenhuma interface nova — é o ponto de junção final.

- [ ] **Step 1: Adicionar a query de movimentações do dia**

Em `morningBriefingService.ts`, antes de `sendMorningBriefings`, adicionar:

```typescript
/** Movimentações processuais de hoje já interpretadas pela IA (Task 5), para o briefing. */
async function getMovimentacoesDoDia(): Promise<MovimentacaoBriefing[]> {
  const [rows] = await db.query(`
    SELECT lp.process_number AS processo, cl.name AS cliente, pm.ai_summary
      FROM process_movements pm
      JOIN legal_processes lp ON lp.id = pm.process_id
      LEFT JOIN clients cl ON cl.id = lp.client_id
     WHERE DATE(CONVERT_TZ(pm.created_at,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))
       AND pm.ai_summary IS NOT NULL
     ORDER BY pm.created_at DESC`) as any;
  return rows.map((r: any) => {
    let s: any = {};
    try { s = JSON.parse(r.ai_summary); } catch { /* ai_summary mal formado — trata como vazio */ }
    return {
      processo: r.processo,
      clienteVsParte: r.cliente || r.processo,
      resumo: s.resumo || '',
      acao: s.acao || '',
      prazoInterno: s.prazo_interno || '',
      severity: classificarMovimentacao(s.prioridade ?? null),
    };
  });
}
```

(Importar `classificarMovimentacao` no topo, junto com os outros classificadores.)

- [ ] **Step 2: Atualizar `sendMorningBriefings` para buscar e passar os dados novos**

Dentro do loop `for (const u of users)` em `sendMorningBriefings` (linha 343), antes da
chamada a `sendEmail`:

```typescript
    const agenda = await getDayAgenda(u.id);
    const agenda3d = await getAgenda3Dias(u.id);
    const financeiro = await getFinanceiroGranular();
    const comercial = await getComercialDoDia();
    const esteira = await getEsteiraEDocumentos();
    const movimentacoes = await getMovimentacoesDoDia();
    const firstName = (u.name || 'Dra.').split(' ')[0];
    const r = await sendEmail({
      to: u.email,
      subject: `☀️ Bom dia! Sua agenda de hoje`,
      html: buildHtml(firstName, weather, agenda, pulso, meta, agenda3d, financeiro, comercial, esteira, movimentacoes),
    });
```

- [ ] **Step 3: Atualizar `sendMorningBriefingWhatsapp` da mesma forma**

```typescript
  const agenda = userId ? await getDayAgenda(userId) : { eventos: [], prazos: [], tarefas: [] };
  const agenda3d = userId ? await getAgenda3Dias(userId) : [];
  const financeiro = await getFinanceiroGranular();
  const comercial = await getComercialDoDia();
  const esteira = await getEsteiraEDocumentos();
  const movimentacoes = await getMovimentacoesDoDia();
  const texto = buildWhatsappText(firstName, weather, agenda, pulso, meta, agenda3d, financeiro, comercial, esteira, movimentacoes);
```

- [ ] **Step 4: Build completo**

Run: `npx tsc`
Expected: sem erros de tipo (todos os parâmetros batendo com as assinaturas das Tasks 6-8).

- [ ] **Step 5: Suíte inteira**

Run: `node --test "tests/**/*.test.mjs"`
Expected: todos os testes passando (Tasks 1-9 combinadas — nenhuma regressão nos 77
originais).

- [ ] **Step 6: Commit**

```bash
git add src/services/morningBriefingService.ts
git commit -m "feat: conecta agenda/financeiro/comercial/esteira/movimentações aos envios de e-mail e WhatsApp"
```

---

## Task 10: Reordenar o cron (DJEN adiantado + interpretação de movimentação)

**Files:**
- Modify: `src/crons/index.ts:33-41` (horários do briefing, já existentes) e a região do
  monitoramento DJEN (linhas 247-249)

**Interfaces:**
- Consumes: `runMonitoringJob` (já existe, `monitoringService.ts`), `runJob` (já existe,
  `runner.ts`).
- Produces: nenhuma interface nova — só reagendamento.

- [ ] **Step 1: Adicionar o cron de 06:15 (monitoramento adiantado só pro briefing)**

Em `src/crons/index.ts`, antes do bloco `// ── Resumo matinal por e-mail às 07:00` (linha
33), adicionar:

```typescript
  // ── 06:15: monitoramento DJEN adiantado — garante movimentação fresca ANTES
  // do briefing das 07h. Mantém os horários 08h/16h já existentes (linha ~248);
  // este é ADICIONAL, não substitui.
  cron.schedule('15 6 * * *', () => {
    runJob('monitoramento:processos-pre-briefing', () => runMonitoringJob(), { critica: true });
  }, { timezone: 'America/Sao_Paulo' });
```

- [ ] **Step 2: Confirmar que o cron de 08h/16h existente não muda**

Verificar que a linha (hoje por volta de 247-249):

```typescript
  cron.schedule('0 8,16 * * *', () => {
    runJob('monitoramento:processos', () => runMonitoringJob(), { critica: true });
```

continua exatamente como está — não remover, só o novo de 06:15 foi adicionado.

- [ ] **Step 3: Build**

Run: `npx tsc`
Expected: sem erros.

- [ ] **Step 4: Suíte inteira**

Run: `node --test "tests/**/*.test.mjs"`
Expected: todos passando (nenhum teste cobre agendamento de cron diretamente — é
verificação de regressão).

- [ ] **Step 5: Commit**

```bash
git add src/crons/index.ts
git commit -m "feat: adianta o monitoramento DJEN para 06:15 — movimentação fresca antes do briefing das 07h"
```

---

## Task 11: Fechamento do dia (18:30)

**Files:**
- Create: `src/services/eveningClosingService.ts`
- Modify: `src/services/morningBriefingService.ts` (salvar snapshot ao enviar o briefing da
  manhã)
- Modify: `src/crons/index.ts` (novo cron 18:30)
- Test: `tests/eveningClosing.test.mjs`

**Interfaces:**
- Consumes: `briefing_snapshots` (Task 3); `sendEmail`, `layout` (`EmailService.ts`,
  existentes); `sendText` (`uazapiInstance.ts`, existente).
- Produces: `salvarSnapshotDoDia(userId: number, payload: object): Promise<void>`
  (chamada pela Task 9 dentro de `sendMorningBriefings`); `compararComSnapshot(userId: number): Promise<{ concluidos: string[]; pendentes: string[]; amanha: string[] }>`;
  `sendEveningClosing(): Promise<{ sent: number; failed: number }>`.

Definição de "concluído" (spec, seção 6, decisão da usuária): **tudo que mudou de status
hoje** — não só o que estava no snapshot da manhã.

- [ ] **Step 1: Escrever o teste da comparação (lógica pura sobre dados mockados)**

```javascript
// tests/eveningClosing.test.mjs
// A comparação em si (snapshot da manhã vs. estado agora) é testada isolada,
// sem depender de banco — recebe os dois conjuntos já prontos.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/eveningClosingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { compararSnapshotComEstadoAtual } = await import('../dist/services/eveningClosingService.js');

test('item que estava pendente de manhã e virou concluído aparece em concluidos', () => {
  const manha = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const agora = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'concluida' }] };
  const r = compararSnapshotComEstadoAtual(manha, agora);
  assert.deepEqual(r.concluidos, ['Petição X']);
  assert.deepEqual(r.pendentes, []);
});

test('item que continua pendente aparece em pendentes', () => {
  const manha = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const agora = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const r = compararSnapshotComEstadoAtual(manha, agora);
  assert.deepEqual(r.pendentes, ['Petição X']);
});

test('item novo que não estava no snapshot da manhã e já foi concluído também conta (regra: tudo que mudou hoje)', () => {
  const manha = { tarefas: [] };
  const agora = { tarefas: [{ id: 2, titulo: 'Tarefa nova', status: 'concluida' }] };
  const r = compararSnapshotComEstadoAtual(manha, agora);
  assert.deepEqual(r.concluidos, ['Tarefa nova']);
});

test('sem snapshot da manhã (usuária não recebeu briefing hoje), compara contra vazio sem lançar', () => {
  const r = compararSnapshotComEstadoAtual(null, { tarefas: [{ id: 1, titulo: 'X', status: 'concluida' }] });
  assert.deepEqual(r.concluidos, ['X']);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `node --test tests/eveningClosing.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/services/eveningClosingService.ts`**

```typescript
import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';
import { sendText } from './uazapiInstance';

interface TarefaSnapshot { id: number; titulo: string; status: string; }
interface SnapshotPayload { tarefas: TarefaSnapshot[]; }

/**
 * Compara o snapshot salvo de manhã com o estado atual. Regra (decisão da
 * usuária, spec seção 6): "concluído" é TUDO que mudou de status hoje — não
 * só o que já estava no snapshot da manhã. Pura, sem I/O — fácil de testar.
 */
export function compararSnapshotComEstadoAtual(
  manha: SnapshotPayload | null,
  agora: SnapshotPayload
): { concluidos: string[]; pendentes: string[] } {
  const statusConcluido = new Set(['concluida', 'concluido', 'pago', 'protocolado']);
  const concluidos: string[] = [];
  const pendentes: string[] = [];
  for (const t of agora.tarefas) {
    if (statusConcluido.has(t.status)) concluidos.push(t.titulo);
    else pendentes.push(t.titulo);
  }
  return { concluidos, pendentes };
}

/** Salva o retrato do que saiu no briefing da manhã, para comparar às 18:30. */
export async function salvarSnapshotDoDia(userId: number, payload: SnapshotPayload): Promise<void> {
  await db.query(
    `INSERT INTO briefing_snapshots (user_id, snapshot_date, payload)
     VALUES (?, CURDATE(), ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [userId, JSON.stringify(payload)]
  );
}

async function buscarSnapshotDeHoje(userId: number): Promise<SnapshotPayload | null> {
  const [[row]] = await db.query(
    'SELECT payload FROM briefing_snapshots WHERE user_id = ? AND snapshot_date = CURDATE()',
    [userId]
  ) as any;
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

async function estadoAtualDasTarefas(userId: number): Promise<SnapshotPayload> {
  const [rows] = await db.query(
    `SELECT id, title AS titulo, status FROM tasks
      WHERE user_id = ? AND due_date IS NOT NULL
        AND DATE(CONVERT_TZ(due_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`,
    [userId]
  ) as any;
  return { tarefas: rows };
}

/** Envia o fechamento do dia (18:30) — e-mail + WhatsApp, para quem recebe o briefing matinal. */
export async function sendEveningClosing(): Promise<{ sent: number; failed: number }> {
  const [users] = await db.query(
    `SELECT id, name, email FROM users WHERE active = 1 AND role IN ('admin','advogado') AND email IS NOT NULL AND email <> ''`
  ) as any;

  let sent = 0, failed = 0;
  for (const u of users) {
    const manha = await buscarSnapshotDeHoje(u.id);
    const agora = await estadoAtualDasTarefas(u.id);
    const { concluidos, pendentes } = compararSnapshotComEstadoAtual(manha, agora);
    const firstName = (u.name || 'Dra.').split(' ')[0];

    const body = `
      <p style="font-size:19px;font-weight:700;color:#1f3047;margin:0 0 16px">Fechamento do dia, Dra. ${firstName} 🌙</p>
      <h3 style="color:#1f3047;font-size:15px">✅ Concluído hoje</h3>
      <p>${concluidos.length ? concluidos.join('<br>') : 'Nada marcado como concluído hoje.'}</p>
      <h3 style="color:#1f3047;font-size:15px">⏳ Ficou pendente</h3>
      <p>${pendentes.length ? pendentes.join('<br>') : 'Nada pendente — dia limpo!'}</p>`;
    const r = await sendEmail({ to: u.email, subject: '🌙 Fechamento do dia', html: layout('Fechamento do dia', body) });
    if (r.ok) sent++; else failed++;
  }
  return { sent, failed };
}
```

- [ ] **Step 4: Rodar e confirmar que os testes de comparação passam**

Run: `npx tsc && node --test tests/eveningClosing.test.mjs`
Expected: PASS nos 4 testes.

- [ ] **Step 5: Salvar o snapshot ao enviar o briefing da manhã**

Em `morningBriefingService.ts`, dentro de `sendMorningBriefings`, logo após buscar
`agenda`/`agenda3d`/etc. para cada usuário (Task 9, Step 2), adicionar:

```typescript
    const { salvarSnapshotDoDia } = await import('./eveningClosingService');
    const [tarefasHoje] = await db.query(
      `SELECT id, title AS titulo, status FROM tasks
        WHERE user_id = ? AND due_date IS NOT NULL
          AND DATE(CONVERT_TZ(due_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`,
      [u.id]
    ) as any;
    await salvarSnapshotDoDia(u.id, { tarefas: tarefasHoje }).catch((e) => console.error('[briefing] falha ao salvar snapshot:', e?.message || e));
```

- [ ] **Step 6: Adicionar o cron de 18:30**

Em `src/crons/index.ts`, depois do bloco do WhatsApp matinal (linha ~41):

```typescript
  // ── Fechamento do dia às 18:30 (Brasília) ──────────────────────────────────
  cron.schedule('30 18 * * *', () => {
    runJob('briefing:fechamento-dia', async () => {
      const { sendEveningClosing } = await import('../services/eveningClosingService');
      return await sendEveningClosing();
    });
  }, { timezone: 'America/Sao_Paulo' });
```

- [ ] **Step 7: Build completo e suíte inteira**

Run: `npx tsc && node --test "tests/**/*.test.mjs"`
Expected: build sem erro; todos os testes passando (Tasks 1-11 combinadas).

- [ ] **Step 8: Commit**

```bash
git add src/services/eveningClosingService.ts src/services/morningBriefingService.ts src/crons/index.ts tests/eveningClosing.test.mjs
git commit -m "feat: fechamento do dia às 18:30 — compara snapshot da manhã com o que mudou de status"
```

---

## Task 12: Radar Jurídico — spike de validação da fonte STJ (não automatizar ainda)

**Files:**
- Create: `scripts/spike-radar-stj.mjs` (script avulso, não faz parte do build/deploy)

**Interfaces:**
- Consumes: nada.
- Produces: nenhuma interface de produção — o resultado é um relatório (console + arquivo)
  que decide SE vale automatizar, não código de produção.

Conforme o spec (seção 8) e a decisão já registrada em sessão anterior: **provar a fonte
antes de construir o sistema todo**. Este task só investiga.

- [ ] **Step 1: Escrever o script de spike**

```javascript
// scripts/spike-radar-stj.mjs
// Spike: testa se dá pra extrair de forma confiável os Informativos de
// Jurisprudência do STJ (tema, número, data, resumo) de forma programática.
// NÃO automatizar em cima disso até este spike confirmar estabilidade —
// decisão registrada no spec docs/superpowers/specs/2026-08-21-briefing-matinal-design.md.
//
// Uso: node scripts/spike-radar-stj.mjs
// Saída: imprime o que conseguiu extrair da página mais recente de
// Informativos do STJ e grava scripts/spike-radar-stj-resultado.json com o
// veredito (estável/instável) e a amostra bruta, para revisão manual.

import { writeFileSync } from 'node:fs';

const URL_INFORMATIVOS = 'https://www.stj.jus.br/publicacaoinstitucional/index.php/informjurisprudencia';

async function main() {
  const resultado = { testadoEm: new Date().toISOString(), url: URL_INFORMATIVOS, veredito: null, amostra: null, erro: null };
  try {
    const res = await fetch(URL_INFORMATIVOS, { headers: { 'User-Agent': 'Mozilla/5.0 (spike CRMLRTICIA)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Checagem mínima: a página tem uma estrutura reconhecível de lista de edições?
    const temLinksDeEdicao = /informativo/i.test(html) && /\d{4}/.test(html);
    resultado.amostra = html.slice(0, 2000);
    resultado.veredito = temLinksDeEdicao
      ? 'PRECISA REVISÃO MANUAL — página respondeu e parece ter conteúdo de informativos, mas a extração estruturada (tema/número/data) não foi tentada neste spike. Abrir scripts/spike-radar-stj-resultado.json e inspecionar a amostra.'
      : 'INSTÁVEL — a página respondeu mas não bate o padrão esperado. Não prosseguir sem investigar outra fonte (ex.: Jurisprudência em Teses).';
  } catch (e) {
    resultado.erro = e.message;
    resultado.veredito = 'FALHOU — não foi possível acessar a fonte. Ver campo "erro".';
  }
  writeFileSync(new URL('./spike-radar-stj-resultado.json', import.meta.url), JSON.stringify(resultado, null, 2));
  console.log(resultado.veredito);
  console.log('Detalhes em scripts/spike-radar-stj-resultado.json');
}

main();
```

- [ ] **Step 2: Rodar o spike**

Run: `node scripts/spike-radar-stj.mjs`
Expected: imprime um veredito (PRECISA REVISÃO MANUAL / INSTÁVEL / FALHOU) e grava
`scripts/spike-radar-stj-resultado.json`.

- [ ] **Step 3: Revisar manualmente o resultado**

Abrir `scripts/spike-radar-stj-resultado.json`, ler a amostra de HTML capturada e decidir:
a página tem uma estrutura extraível (lista de edições com link, data, tema) de forma
consistente? Documentar a decisão como comentário no início do próprio arquivo de resultado
ou, se for prosseguir, abrir um novo spec específico para "Radar Jurídico — Fase B
(automação)". **Não seguir para automação dentro deste plano** — isso é, por decisão
explícita, um spec futuro separado.

- [ ] **Step 4: Commit do script de spike (não do resultado, que é output local)**

```bash
git add scripts/spike-radar-stj.mjs
git commit -m "chore: spike de validação da fonte STJ para o Radar Jurídico (não automatiza ainda)"
```

---

## Final Check

- [ ] **Rodar a suíte completa uma última vez**

Run: `npx tsc && node --test "tests/**/*.test.mjs"`
Expected: build limpo; todos os testes (77 originais + os novos das Tasks 1-11) passando,
zero falhas.

- [ ] **Conferir `git log` da branch — deve haver um commit por task, nenhum `--no-verify`**

Run: `git log --oneline -20`

- [ ] **Atualizar o spec** (`docs/superpowers/specs/2026-08-21-briefing-matinal-design.md`)
com uma nota no topo: "Implementado em [data] — ver commits a partir de aaaa." Não é preciso
reescrever o spec, só marcar como concluído.
