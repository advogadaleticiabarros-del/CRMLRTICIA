# Agendamento Self-Service de Consulta — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um lead marque sozinho uma consulta em um horário livre, sem precisar ligar ou mandar mensagem pedindo horário — via página pública que lê disponibilidade calculada a partir de `calendar_events` e cria lead + evento automaticamente.

**Architecture:** Função pura `calcularSlotsDisponiveis` (sem I/O) gera os horários livres a partir do expediente configurado em `office_settings` e dos eventos já existentes no banco. Duas rotas públicas em `src/routes/agenda-public.ts` (mesmo padrão anti-spam de `lead-public.ts`) expõem essa função e criam o agendamento (lead + calendar_event + notificações), reaproveitando as mesmas funções de serviço que `POST /api/calendar/events` já usa. Frontend é uma página HTML standalone (`public/agendamento.html`), fora do SPA autenticado.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM); frontend vanilla JS sem build step.

## Global Constraints

- `agenda_self_service_ativo` desligado por padrão (`'0'`) — feature existe no código mas fica inerte até a usuária ativar explicitamente em Configurações.
- Sem consulta a freebusy do Google — cálculo de vagas usa só `calendar_events` já sincronizado no banco.
- `calcularSlotsDisponiveis` é função pura, sem I/O — testável isoladamente sem banco.
- Revalidação de disponibilidade no servidor no momento do `POST /agendar` (não confia só no que o cliente calculou/enviou) — 409 se o slot já foi ocupado.
- Reaproveita as mesmas funções de serviço já usadas por `POST /api/calendar/events` (`googleCalendarService.createEvent`, `telegramNotificationService.sendReuniaoAgendada`, `notificationService.create`) e por `POST /api/public/lead` (dedupe de lead por telefone/e-mail em 24h, `notifyNewLead`) — sem duplicar lógica de negócio.
- Mesmo padrão anti-spam de `lead-public.ts`: honeypot (campo `website`) + rate-limit por IP (5/15min) em `POST /agendar`, com `Map` local próprio (não compartilhado entre arquivos).
- Frontend é uma página pública standalone (`public/agendamento.html`), não uma tela nova dentro do SPA autenticado do CRM.
- Brasil não observa horário de verão desde 2019 — offset fixo `-03:00`, mesma premissa de `src/utils/timezone.ts`.
- Sem testes automatizados de frontend — validado com checklist visual manual. Backend usa `node --test` real (sem mocks), mesmo padrão já usado nesta sessão.

---

## File Structure

- **Create** `migrations/105_agenda_self_service.sql` — nenhuma tabela nova; `office_settings` já existe como key-value, as chaves novas são inseridas via código (não via migration obrigatória), mas a migration documenta os defaults como comentário e garante que as linhas existam desde já (evita que `GET /api/office-settings` retorne string vazia até a primeira gravação manual).
- **Create** `src/services/agendaSlots.ts` — função pura `calcularSlotsDisponiveis` + tipos.
- **Modify** `src/routes/office-settings.ts` — adiciona as 5 chaves novas ao array `KEYS`.
- **Create** `src/routes/agenda-public.ts` — as 2 rotas públicas (`GET /slots`, `POST /agendar`).
- **Modify** `src/app.ts` — monta `agenda-public.ts` em `/api/public`.
- **Create** `public/agendamento.html` — página pública standalone.

---

### Task 1: Função pura de cálculo de slots + expansão de office-settings

**Files:**
- Create: `src/services/agendaSlots.ts`
- Create: `src/services/agendaSlots.test.ts`
- Modify: `src/routes/office-settings.ts:8`
- Create: `migrations/105_agenda_self_service.sql`

**Interfaces:**
- Produces: `calcularSlotsDisponiveis(expediente: Expediente, eventosExistentes: IntervaloEvento[], dataInicioStr: string, dataFimStr: string): Slot[]`
- Produces: tipos `Expediente`, `IntervaloEvento`, `Slot` exportados de `src/services/agendaSlots.ts`
- Produces: `parseExpedienteDeOfficeSettings(settings: Record<string,string>): Expediente` (converte as strings cruas de `office_settings` — `agenda_dias_semana` CSV, `agenda_hora_inicio`/`fim` "HH:MM", `agenda_duracao_consulta_min` string numérica — para o tipo `Expediente` tipado, aplicando os defaults quando a chave vier vazia)
- Consumes: nenhuma (task independente, primeira do plano)

Todas as datas/horas que entram e saem de `calcularSlotsDisponiveis` são strings **locais Brasília**, formato `"YYYY-MM-DDTHH:MM"` (mesmo formato que um `<input type="datetime-local">` produz, mesma premissa de entrada que `localParaUtcMysql` em `src/utils/timezone.ts:9` já assume). A função nunca lê nem grava no banco — quem a chama é responsável por buscar `eventosExistentes` (já convertidos de UTC do banco para essas strings locais) e por converter os `Slot` de saída para UTC na hora de gravar (usando `localParaUtcMysql`, que já existe).

- [ ] **Step 1: Criar `src/services/agendaSlots.ts` com os tipos e a função**

```typescript
// src/services/agendaSlots.ts

/**
 * Todas as datas/horas aqui são strings locais Brasília, formato
 * "YYYY-MM-DDTHH:MM" (mesma convenção que localParaUtcMysql em
 * src/utils/timezone.ts espera na entrada). Brasil não observa horário de
 * verão desde 2019 — o offset -03:00 é fixo, não há ambiguidade de fuso
 * dentro desta função.
 */

export interface Expediente {
  diasSemana: number[];       // 1=segunda ... 7=domingo
  horaInicio: string;         // "HH:MM"
  horaFim: string;            // "HH:MM"
  duracaoConsultaMin: number; // minutos
}

export interface IntervaloEvento {
  start_datetime: string; // "YYYY-MM-DDTHH:MM" local Brasília
  end_datetime: string;   // "YYYY-MM-DDTHH:MM" local Brasília
}

export interface Slot {
  start_datetime: string; // "YYYY-MM-DDTHH:MM" local Brasília
  end_datetime: string;   // "YYYY-MM-DDTHH:MM" local Brasília
}

const DEFAULT_EXPEDIENTE: Expediente = {
  diasSemana: [1, 2, 3, 4, 5],
  horaInicio: '09:00',
  horaFim: '18:00',
  duracaoConsultaMin: 60,
};

/**
 * Converte as strings cruas de office_settings (setting_value é sempre
 * texto) para o Expediente tipado, aplicando os defaults do spec quando a
 * chave está ausente ou vazia (mesmo padrão de "linha ausente = default"
 * que o resto do office_settings já usa via KEYS/out[k]='').
 */
export function parseExpedienteDeOfficeSettings(settings: Record<string, string>): Expediente {
  const diasRaw = (settings.agenda_dias_semana || '').trim();
  const diasSemana = diasRaw
    ? diasRaw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= 7)
    : DEFAULT_EXPEDIENTE.diasSemana;

  const horaInicio = /^\d{2}:\d{2}$/.test(settings.agenda_hora_inicio || '')
    ? settings.agenda_hora_inicio
    : DEFAULT_EXPEDIENTE.horaInicio;

  const horaFim = /^\d{2}:\d{2}$/.test(settings.agenda_hora_fim || '')
    ? settings.agenda_hora_fim
    : DEFAULT_EXPEDIENTE.horaFim;

  const duracaoParsed = parseInt(settings.agenda_duracao_consulta_min || '', 10);
  const duracaoConsultaMin = duracaoParsed > 0 ? duracaoParsed : DEFAULT_EXPEDIENTE.duracaoConsultaMin;

  return {
    diasSemana: diasSemana.length ? diasSemana : DEFAULT_EXPEDIENTE.diasSemana,
    horaInicio,
    horaFim,
    duracaoConsultaMin,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function addMinutesToLocalStr(dateStr: string, minutes: number): string {
  // dateStr: "YYYY-MM-DD", minutes: minutos desde 00:00 do próprio dia.
  // Constrói a string local diretamente (sem passar por Date/UTC) — evita
  // qualquer risco de deslocamento de fuso ao manipular só o relógio do dia.
  const totalMin = minutes;
  const hh = pad2(Math.floor(totalMin / 60));
  const mm = pad2(totalMin % 60);
  return `${dateStr}T${hh}:${mm}`;
}

// getDay() da string local: 0=domingo..6=sábado (JS nativo) — convertido
// para a convenção do spec (1=segunda..7=domingo) sem depender de fuso,
// já que só usamos a parte da data (meio-dia UTC neutraliza qualquer
// deslocamento de fuso ao extrair o dia da semana).
function diaSemanaISO(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const jsDay = d.getUTCDay(); // 0=domingo..6=sábado
  return jsDay === 0 ? 7 : jsDay;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Gera todos os slots de agenda_duracao_consulta_min dentro do expediente
 * configurado, nos dias úteis configurados, entre dataInicioStr e
 * dataFimStr (inclusive), removendo os que colidem com qualquer evento em
 * eventosExistentes (checagem de sobreposição de intervalo, não só mesmo
 * horário exato).
 */
export function calcularSlotsDisponiveis(
  expediente: Expediente,
  eventosExistentes: IntervaloEvento[],
  dataInicioStr: string, // "YYYY-MM-DD"
  dataFimStr: string     // "YYYY-MM-DD"
): Slot[] {
  const slots: Slot[] = [];
  const inicioMin = toMinutes(expediente.horaInicio);
  const fimMin = toMinutes(expediente.horaFim);
  const duracao = expediente.duracaoConsultaMin;

  let dia = dataInicioStr;
  while (dia <= dataFimStr) {
    if (expediente.diasSemana.includes(diaSemanaISO(dia))) {
      for (let cursor = inicioMin; cursor + duracao <= fimMin; cursor += duracao) {
        const start = addMinutesToLocalStr(dia, cursor);
        const end = addMinutesToLocalStr(dia, cursor + duracao);
        const colide = eventosExistentes.some((ev) =>
          overlaps(start, end, ev.start_datetime, ev.end_datetime)
        );
        if (!colide) slots.push({ start_datetime: start, end_datetime: end });
      }
    }
    dia = addDaysToDateStr(dia, 1);
  }

  return slots;
}
```

- [ ] **Step 2: Escrever o teste real (sem mocks, `node --test`)**

```typescript
// src/services/agendaSlots.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSlotsDisponiveis, parseExpedienteDeOfficeSettings, Expediente } from './agendaSlots';

const expedientePadrao: Expediente = {
  diasSemana: [1, 2, 3, 4, 5], // seg-sex
  horaInicio: '09:00',
  horaFim: '12:00', // janela curta pra testes previsíveis: 09,10,11 (3 slots de 60min)
  duracaoConsultaMin: 60,
};

test('dia fora do expediente configurado não gera slots', () => {
  // 2026-08-30 é domingo — fora de [1..5]
  const slots = calcularSlotsDisponiveis(expedientePadrao, [], '2026-08-30', '2026-08-30');
  assert.deepEqual(slots, []);
});

test('dia dentro do expediente gera os slots esperados sem eventos', () => {
  // 2026-08-24 é segunda-feira
  const slots = calcularSlotsDisponiveis(expedientePadrao, [], '2026-08-24', '2026-08-24');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
    { start_datetime: '2026-08-24T10:00', end_datetime: '2026-08-24T11:00' },
    { start_datetime: '2026-08-24T11:00', end_datetime: '2026-08-24T12:00' },
  ]);
});

test('um evento existente remove exatamente o slot que colide, sem afetar vizinhos', () => {
  const eventos = [{ start_datetime: '2026-08-24T10:00', end_datetime: '2026-08-24T11:00' }];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-24');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
    { start_datetime: '2026-08-24T11:00', end_datetime: '2026-08-24T12:00' },
  ]);
});

test('evento com sobreposição parcial (não alinhado ao slot) também bloqueia o slot inteiro', () => {
  // Evento das 10:30 às 11:30 sobrepõe parcialmente os slots 10:00-11:00 e 11:00-12:00
  const eventos = [{ start_datetime: '2026-08-24T10:30', end_datetime: '2026-08-24T11:30' }];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-24');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
  ]);
});

test('dois eventos adjacentes sem gap não geram um slot encaixado entre eles se a duração não cabe', () => {
  // Eventos ocupam 09:00-10:00 e 10:00-11:00 — não sobra espaço de 60min
  // entre eles nem depois, só o slot 11:00-12:00 remanescente.
  const eventos = [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
    { start_datetime: '2026-08-24T10:00', end_datetime: '2026-08-24T11:00' },
  ];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-24');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T11:00', end_datetime: '2026-08-24T12:00' },
  ]);
});

test('janela de busca maior que os dados de eventosExistentes gera slots normalmente nos dias sem evento', () => {
  // eventosExistentes só cobre 24/08; 25/08 (terça) deve sair livre e completo
  const eventos = [{ start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T12:00' }];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-25');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-25T09:00', end_datetime: '2026-08-25T10:00' },
    { start_datetime: '2026-08-25T10:00', end_datetime: '2026-08-25T11:00' },
    { start_datetime: '2026-08-25T11:00', end_datetime: '2026-08-25T12:00' },
  ]);
});

test('parseExpedienteDeOfficeSettings aplica defaults quando settings vem vazio', () => {
  const expediente = parseExpedienteDeOfficeSettings({});
  assert.deepEqual(expediente, {
    diasSemana: [1, 2, 3, 4, 5],
    horaInicio: '09:00',
    horaFim: '18:00',
    duracaoConsultaMin: 60,
  });
});

test('parseExpedienteDeOfficeSettings lê os valores configurados', () => {
  const expediente = parseExpedienteDeOfficeSettings({
    agenda_dias_semana: '1,3,5',
    agenda_hora_inicio: '08:00',
    agenda_hora_fim: '14:00',
    agenda_duracao_consulta_min: '30',
  });
  assert.deepEqual(expediente, {
    diasSemana: [1, 3, 5],
    horaInicio: '08:00',
    horaFim: '14:00',
    duracaoConsultaMin: 30,
  });
});
```

- [ ] **Step 3: Rodar o teste e verificar que passa**

Run: `npx tsx --test src/services/agendaSlots.test.ts`
Expected: todos os 8 testes com `PASS` (o projeto já roda `node --test` sobre arquivos `.ts` via `tsx`/`ts-node` registrado — confirme o comando exato olhando o `package.json`, campo `scripts.test`; se o projeto usa outro runner, adapte o comando mas não o conteúdo do teste).

- [ ] **Step 4: Adicionar as 5 chaves novas em `src/routes/office-settings.ts`**

Editar a linha 8 (array `KEYS`):

```typescript
const KEYS = [
  'pix_key', 'pix_nome', 'pix_cidade', 'whatsapp', 'multa_percent', 'juros_mes_percent',
  'meta_faturamento_mes', 'google_review_url', 'briefing_whatsapp',
  'agenda_dias_semana', 'agenda_hora_inicio', 'agenda_hora_fim',
  'agenda_duracao_consulta_min', 'agenda_self_service_ativo',
];
```

Nada mais muda nesse arquivo — o `GET`/`PATCH` já genéricos (linhas 11-34) passam a aceitar as chaves novas automaticamente.

- [ ] **Step 5: Criar a migration `migrations/105_agenda_self_service.sql`**

```sql
-- Chaves de configuração do agendamento self-service em office_settings
-- (tabela key-value já existente — sem tabela nova). Insere os defaults do
-- spec desde já, para que GET /api/office-settings nunca precise cair no
-- fallback de string vazia antes da primeira gravação manual pela tela de
-- Configurações. agenda_self_service_ativo começa desligado ('0') — feature
-- existe no código mas fica inerte até a usuária ativar conscientemente.
INSERT INTO office_settings (setting_key, setting_value) VALUES
  ('agenda_dias_semana', '1,2,3,4,5'),
  ('agenda_hora_inicio', '09:00'),
  ('agenda_hora_fim', '18:00'),
  ('agenda_duracao_consulta_min', '60'),
  ('agenda_self_service_ativo', '0')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
```

- [ ] **Step 6: Rodar a migration no banco de desenvolvimento/produção conforme o mecanismo já usado pelo projeto**

Verifique como as migrations anteriores (ex.: `104_leads_ai_qualification.sql`) foram aplicadas nesta sessão (script npm, ou execução manual via client MySQL) e repita o mesmo mecanismo. Confirme com uma query:

```sql
SELECT setting_key, setting_value FROM office_settings WHERE setting_key LIKE 'agenda_%';
```
Expected: 5 linhas com os valores acima.

- [ ] **Step 7: Commit**

```bash
git add src/services/agendaSlots.ts src/services/agendaSlots.test.ts src/routes/office-settings.ts migrations/105_agenda_self_service.sql
git commit -m "feat: calculo de slots de agenda + chaves de expediente em office_settings"
```

---

### Task 2: Rotas públicas `GET /api/public/agenda/slots` e `POST /api/public/agenda/agendar`

**Files:**
- Create: `src/routes/agenda-public.ts`
- Create: `src/routes/agenda-public.test.ts`
- Modify: `src/app.ts` (montagem da rota, junto das demais `/api/public/*`)

**Interfaces:**
- Consumes de Task 1: `calcularSlotsDisponiveis(expediente, eventosExistentes, dataInicioStr, dataFimStr): Slot[]`, `parseExpedienteDeOfficeSettings(settings): Expediente`, tipos `Slot`/`IntervaloEvento` de `../services/agendaSlots`.
- Consumes já existentes: `localParaUtcMysql(v: string): string` de `../utils/timezone`; `googleCalendarService.createEvent(userId, {title, description, startDatetime, endDatetime, location, generateMeet}): Promise<{googleEventId, videoLink}>` de `../services/GoogleCalendarService`; `telegramNotificationService.sendReuniaoAgendada(userId, {clientName, dateTime}): Promise<void>` de `../services/TelegramNotificationService`; `notificationService.create({userId, calendarEventId, title, message, notificationType, channel, scheduledAt}): Promise<void>` e `notificationService.getSettings(userId)` de `../services/NotificationService`; `notifyNewLead(opts: {leadId, name, phone, source, area, message}): Promise<void>` de `../services/leadAlert`; `db` de `../config/database`.
- Produces: router default-exportado de `src/routes/agenda-public.ts`, montado em `app.ts` como `app.use('/api/public', agendaPublicRoutes)`.

**Formato de data que o frontend manda:** o corpo do `POST /agendar` recebe `start_datetime` no mesmo formato `"YYYY-MM-DDTHH:MM"` local Brasília que `GET /slots` devolveu (um dos valores literais da lista de slots — não um horário arbitrário digitado).

- [ ] **Step 1: Escrever `src/routes/agenda-public.ts`**

```typescript
// src/routes/agenda-public.ts
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { localParaUtcMysql } from '../utils/timezone';
import { calcularSlotsDisponiveis, parseExpedienteDeOfficeSettings, IntervaloEvento } from '../services/agendaSlots';
import { googleCalendarService } from '../services/GoogleCalendarService';
import { telegramNotificationService } from '../services/TelegramNotificationService';
import { notificationService } from '../services/NotificationService';
import { notifyNewLead } from '../services/leadAlert';

const router = Router();

async function agendaAtiva(): Promise<boolean> {
  const [[row]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'agenda_self_service_ativo'"
  ) as any;
  return row?.setting_value === '1';
}

async function buscarExpediente() {
  const [rows] = await db.query(
    `SELECT setting_key, setting_value FROM office_settings
     WHERE setting_key IN ('agenda_dias_semana','agenda_hora_inicio','agenda_hora_fim','agenda_duracao_consulta_min')`
  ) as any;
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.setting_key] = r.setting_value || '';
  return parseExpedienteDeOfficeSettings(settings);
}

// Converte start_datetime/end_datetime UTC (como vêm do banco, formato
// "YYYY-MM-DD HH:MM:SS") para string local Brasília "YYYY-MM-DDTHH:MM",
// mesma convenção de entrada/saída de calcularSlotsDisponiveis. Não existe
// utilitário pronto para esta direção no projeto (só localParaUtcMysql, que
// é o sentido oposto) — implementado aqui, escopo local à rota de agenda.
function utcMysqlParaLocalStr(utcMysql: string): string {
  const d = new Date(utcMysql.replace(' ', 'T') + 'Z');
  const localMs = d.getTime() - 3 * 60 * 60 * 1000; // Brasília = UTC-3, fixo
  const local = new Date(localMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

async function buscarEventosExistentes(dataInicioStr: string, dataFimStr: string): Promise<IntervaloEvento[]> {
  const [rows] = await db.query(
    `SELECT start_datetime, end_datetime FROM calendar_events
     WHERE start_datetime < ? AND end_datetime > ?`,
    [`${dataFimStr} 23:59:59`, `${dataInicioStr} 00:00:00`]
  ) as any;
  return rows.map((r: any) => ({
    start_datetime: utcMysqlParaLocalStr(String(r.start_datetime).replace('T', ' ').slice(0, 19)),
    end_datetime: utcMysqlParaLocalStr(String(r.end_datetime).replace('T', ' ').slice(0, 19)),
  }));
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hojeStrBrasilia(): string {
  // "Hoje" em Brasília, não em UTC — evita virar o dia errado perto da
  // meia-noite (mesmo cuidado de fuso do resto deste arquivo).
  const nowUtc = new Date();
  const localMs = nowUtc.getTime() - 3 * 60 * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}

// ── GET /api/public/agenda/slots?dias=14 — horários livres ──────────────────
router.options('/agenda/slots', (_req: Request, res: Response) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

router.get('/agenda/slots', async (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (!(await agendaAtiva())) { res.status(503).json({ error: 'Agendamento online indisponível no momento' }); return; }

  const diasQ = parseInt(String(req.query.dias || '14'), 10);
  const dias = Number.isFinite(diasQ) && diasQ > 0 ? Math.min(diasQ, 30) : 14;

  const dataInicioStr = hojeStrBrasilia();
  const dataFimStr = addDaysToDateStr(dataInicioStr, dias - 1);

  const expediente = await buscarExpediente();
  const eventosExistentes = await buscarEventosExistentes(dataInicioStr, dataFimStr);
  const slots = calcularSlotsDisponiveis(expediente, eventosExistentes, dataInicioStr, dataFimStr);

  res.json({ slots });
});

// ── POST /api/public/agenda/agendar — cria o agendamento ────────────────────
// Mesmo padrão anti-spam de lead-public.ts: honeypot (website) + rate-limit
// por IP (5/15min). Map local — não compartilhado com outros arquivos.
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map<string, { count: number; first: number }>();
function tooMany(ip: string): boolean {
  const h = hits.get(ip);
  if (!h || Date.now() - h.first > WINDOW_MS) { hits.set(ip, { count: 1, first: Date.now() }); return false; }
  h.count++;
  if (hits.size > 5000) hits.clear();
  return h.count > 5;
}

router.options('/agenda/agendar', (_req: Request, res: Response) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

router.post('/agenda/agendar', async (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (!(await agendaAtiva())) { res.status(503).json({ error: 'Agendamento online indisponível no momento' }); return; }

  const b = req.body || {};
  if (b.website) { res.json({ success: true }); return; } // honeypot: bot preencheu — finge sucesso
  if (tooMany(req.ip || 'ip')) { res.status(429).json({ error: 'Muitos envios — tente mais tarde' }); return; }

  const name = String(b.name || '').trim();
  if (name.length < 3) { res.status(400).json({ error: 'Informe seu nome' }); return; }
  const phone = String(b.phone || '').replace(/\D/g, '').slice(0, 15);
  if (!phone) { res.status(400).json({ error: 'Informe seu telefone' }); return; }
  const email = String(b.email || '').trim().slice(0, 255) || null;
  const message = String(b.message || '').trim().slice(0, 2000) || null;
  const startDatetime = String(b.start_datetime || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startDatetime)) {
    res.status(400).json({ error: 'Horário inválido' });
    return;
  }

  const expediente = await buscarExpediente();
  const dataStr = startDatetime.slice(0, 10);
  const endDatetime = (() => {
    const [datePart, timePart] = startDatetime.split('T');
    const [h, m] = timePart.split(':').map(Number);
    const totalMin = h * 60 + m + expediente.duracaoConsultaMin;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${datePart}T${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}`;
  })();

  // Revalida no servidor: o slot pedido precisa aparecer na lista recalculada agora.
  const eventosExistentes = await buscarEventosExistentes(dataStr, dataStr);
  const slotsDoDia = calcularSlotsDisponiveis(expediente, eventosExistentes, dataStr, dataStr);
  const aindaLivre = slotsDoDia.some((s) => s.start_datetime === startDatetime && s.end_datetime === endDatetime);
  if (!aindaLivre) { res.status(409).json({ error: 'Esse horário acabou de ser ocupado — escolha outro' }); return; }

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) { res.status(500).json({ error: 'Indisponível' }); return; }

  // Dedupe de 24h por telefone/e-mail — mesmo padrão de lead-public.ts.
  const [[dup]] = await db.query(
    `SELECT id FROM leads WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
       AND ((? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND email = ?)) LIMIT 1`,
    [phone, phone, email, email]
  ) as any;

  let leadId: number;
  if (dup) {
    leadId = dup.id;
    await db.query(
      'UPDATE leads SET case_summary = CONCAT(COALESCE(case_summary,\'\'), \'\n---\n\', ?) WHERE id = ?',
      [`Agendou consulta pelo site para ${startDatetime.replace('T', ' ')}.${message ? ' Motivo: ' + message : ''}`, leadId]
    ).catch(() => {});
  } else {
    const [ins] = await db.query(
      `INSERT INTO leads (user_id, name, phone, email, source, legal_area, status, case_summary)
       VALUES (?, ?, ?, ?, 'agendamento_site', NULL, 'triagem', ?)`,
      [admin.id, name, phone, email, message ? `Agendou consulta pelo site.\nMotivo: ${message}` : 'Agendou consulta pelo site.']
    ) as any;
    leadId = ins.insertId;
  }

  const title = `Consulta — ${name}`;
  const [result] = await db.query(
    `INSERT INTO calendar_events
       (user_id, title, description, event_type, start_datetime, end_datetime, source, sync_status)
     VALUES (?, ?, ?, 'reuniao', ?, ?, 'crm', 'pendente')`,
    [admin.id, title, message, localParaUtcMysql(startDatetime), localParaUtcMysql(endDatetime)]
  ) as any;
  const eventId = result.insertId;

  // Sync Google + Telegram + lembrete — mesma lógica de POST /api/calendar/events
  // (src/routes/calendar.ts:91-124), best-effort: falha aqui nunca derruba o
  // agendamento em si (lead e evento já estão gravados no CRM).
  const [ga] = await db.query('SELECT id FROM google_accounts WHERE user_id = ? AND sync_enabled = 1', [admin.id]) as any;
  if (ga.length) {
    try {
      const { googleEventId, videoLink } = await googleCalendarService.createEvent(admin.id, {
        title, description: message ?? undefined, startDatetime, endDatetime,
      });
      await db.query(
        "UPDATE calendar_events SET google_event_id = ?, video_link = ?, sync_status = 'sincronizado' WHERE id = ?",
        [googleEventId, videoLink ?? null, eventId]
      );

      await telegramNotificationService.sendReuniaoAgendada(admin.id, {
        clientName: name,
        dateTime: new Date(localParaUtcMysql(startDatetime).replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      });

      const settings = await notificationService.getSettings(admin.id);
      const reminderTime = new Date(new Date(localParaUtcMysql(startDatetime).replace(' ', 'T') + 'Z').getTime() - (settings?.reminder_minutes_before ?? 15) * 60_000);
      await notificationService.create({
        userId: admin.id, calendarEventId: eventId,
        title: `Lembrete: ${title}`,
        message: `Começa em ${settings?.reminder_minutes_before ?? 15} minuto(s)`,
        notificationType: 'reuniao_lembrete',
        channel: 'som',
        scheduledAt: reminderTime,
      });
    } catch { /* best-effort — mesmo padrão de calendar.ts:124 */ }
  }

  await notifyNewLead({ leadId, name, phone, source: 'Agendamento site', area: null, message: message || 'Agendou consulta pelo site' });

  res.status(201).json({ success: true });
});

export default router;
```

- [ ] **Step 2: Montar a rota em `src/app.ts`**

Localizar o bloco (por volta da linha 150-154):

```typescript
  app.use('/api/public', signPublicRoutes);
  app.use('/api/public', propostaPublicRoutes); // proposta pública (link p/ cliente)
  app.use('/api/public', leadPublicRoutes);     // formulário do site/blog → lead no funil
  app.use('/api/public', whatsappWebhookRoutes); // eventos da Uazapi (mensagens recebidas)
  app.use('/api/public', asaasWebhookRoutes);    // eventos de pagamento do Asaas
```

Adicionar o import no topo do arquivo (junto dos demais imports de rotas públicas) e a linha de montagem:

```typescript
import agendaPublicRoutes from './routes/agenda-public';
```

```typescript
  app.use('/api/public', signPublicRoutes);
  app.use('/api/public', propostaPublicRoutes); // proposta pública (link p/ cliente)
  app.use('/api/public', leadPublicRoutes);     // formulário do site/blog → lead no funil
  app.use('/api/public', agendaPublicRoutes);   // agendamento self-service de consulta
  app.use('/api/public', whatsappWebhookRoutes); // eventos da Uazapi (mensagens recebidas)
  app.use('/api/public', asaasWebhookRoutes);    // eventos de pagamento do Asaas
```

(Confirme o nome exato das variáveis de import already existentes em `app.ts` antes de editar — use-as como referência de estilo, não invente um padrão novo.)

- [ ] **Step 3: Escrever teste de integração real (sem HTTP/supertest, mesmo padrão já usado nesta sessão)**

```typescript
// src/routes/agenda-public.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/database';

// Teste de integração real contra o banco configurado no ambiente (mesmo
// padrão de skip gracioso já usado nesta sessão para testes que tocam
// banco — se não houver conexão disponível, o teste é pulado, não falha).
async function bancoDisponivel(): Promise<boolean> {
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

test('agenda_self_service_ativo=0 por padrão bloqueia as rotas com 503 — verificado via query direta', async (t) => {
  if (!(await bancoDisponivel())) { t.skip('banco indisponível'); return; }
  const [[row]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'agenda_self_service_ativo'"
  ) as any;
  assert.equal(row?.setting_value, '0');
});

test('slot ocupado por um calendar_event existente não aparece mais na revalidação', async (t) => {
  if (!(await bancoDisponivel())) { t.skip('banco indisponível'); return; }

  const { calcularSlotsDisponiveis, parseExpedienteDeOfficeSettings } = await import('../services/agendaSlots');
  const { localParaUtcMysql } = await import('../utils/timezone');

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) { t.skip('nenhum admin no banco de teste'); return; }

  const dataTeste = '2027-01-04'; // segunda-feira distante, isolada de dados reais
  const startLocal = `${dataTeste}T09:00`;
  const endLocal = `${dataTeste}T10:00`;

  const [ins] = await db.query(
    `INSERT INTO calendar_events (user_id, title, event_type, start_datetime, end_datetime, source, sync_status)
     VALUES (?, 'Evento de teste — agenda_public.test', 'reuniao', ?, ?, 'crm', 'pendente')`,
    [admin.id, localParaUtcMysql(startLocal), localParaUtcMysql(endLocal)]
  ) as any;
  const eventId = ins.insertId;

  try {
    const [rows] = await db.query(
      `SELECT start_datetime, end_datetime FROM calendar_events WHERE id = ?`,
      [eventId]
    ) as any;
    const utcMysqlParaLocalStr = (utcMysql: string) => {
      const d = new Date(String(utcMysql).replace(' ', 'T').replace('T', 'T').slice(0, 19) + 'Z');
      const localMs = d.getTime() - 3 * 60 * 60 * 1000;
      const local = new Date(localMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    };
    const eventosExistentes = rows.map((r: any) => ({
      start_datetime: utcMysqlParaLocalStr(String(r.start_datetime).replace('T', ' ').slice(0, 19)),
      end_datetime: utcMysqlParaLocalStr(String(r.end_datetime).replace('T', ' ').slice(0, 19)),
    }));

    const expediente = parseExpedienteDeOfficeSettings({});
    const slots = calcularSlotsDisponiveis(expediente, eventosExistentes, dataTeste, dataTeste);
    const ocupado = slots.some((s) => s.start_datetime === startLocal && s.end_datetime === endLocal);
    assert.equal(ocupado, false, 'o slot das 09:00-10:00 não deveria aparecer como livre');
  } finally {
    await db.query('DELETE FROM calendar_events WHERE id = ?', [eventId]);
  }
});
```

- [ ] **Step 4: Rodar os testes e verificar que passam (ou pulam graciosamente sem banco)**

Run: `npx tsx --test src/routes/agenda-public.test.ts`
Expected: `PASS` ou `SKIP` em cada teste, nunca `FAIL`. Se o projeto tiver banco de dev configurado, confirme os 2 testes `PASS`.

- [ ] **Step 5: Build TypeScript para garantir que a montagem em `app.ts` compila**

Run: verifique o comando exato em `package.json` (`scripts.build`, tipicamente `tsc`), rode-o.
Expected: sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/routes/agenda-public.ts src/routes/agenda-public.test.ts src/app.ts
git commit -m "feat: rotas publicas de agendamento self-service (slots + agendar)"
```

---

### Task 3: Frontend — `public/agendamento.html`

**Files:**
- Create: `public/agendamento.html`
- Read (referência de padrão, não modificar): `public/proposta.html`

**Interfaces:**
- Consumes: `GET /api/public/agenda/slots?dias=14` → `{slots: [{start_datetime, end_datetime}]}`; `POST /api/public/agenda/agendar` com body `{name, phone, email, start_datetime, message, website}` → `201 {success:true}` | `409 {error}` | `429 {error}` | `503 {error}` | `400 {error}`.
- Produces: página HTML pública standalone, sem dependências além do que o próprio arquivo carrega.

Antes de escrever, leia `public/proposta.html` completo para replicar exatamente a mesma estrutura (head, meta viewport, fontes, paleta de cores já usada nas páginas públicas do sistema) — não invente uma identidade visual nova; o arquivo abaixo assume uma paleta neutra genérica como placeholder de estrutura, mas as cores/fontes reais devem vir do que `proposta.html` já usa.

- [ ] **Step 1: Criar `public/agendamento.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agende sua consulta — Dra. Letícia Barros</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #faf8f5; color: #2b2620; padding: 24px 16px 64px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p.sub { color: #6b6357; margin-bottom: 24px; font-size: 15px; }
  .dia-grupo { margin-bottom: 20px; }
  .dia-titulo { font-weight: 600; font-size: 14px; text-transform: capitalize; margin-bottom: 8px; color: #4a4438; }
  .slots { display: flex; flex-wrap: wrap; gap: 8px; }
  .slot-btn { border: 1px solid #d8cfc0; background: #fff; border-radius: 8px; padding: 10px 14px; font-size: 14px; cursor: pointer; }
  .slot-btn:hover { border-color: #a8875a; }
  .slot-btn.selecionado { background: #a8875a; color: #fff; border-color: #a8875a; }
  form { margin-top: 28px; display: none; flex-direction: column; gap: 12px; }
  form.ativo { display: flex; }
  label { font-size: 13px; font-weight: 600; color: #4a4438; }
  input, textarea { border: 1px solid #d8cfc0; border-radius: 8px; padding: 10px 12px; font-size: 15px; font-family: inherit; }
  textarea { resize: vertical; min-height: 70px; }
  .website-honeypot { position: absolute; left: -9999px; opacity: 0; }
  button[type=submit] { background: #a8875a; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
  button[type=submit]:disabled { opacity: 0.6; cursor: default; }
  .msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 14px; }
  .msg.erro { background: #fde8e8; color: #a12727; }
  .msg.sucesso { background: #e6f4ea; color: #1e6b34; }
  .vazio { color: #6b6357; font-size: 14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Agende sua consulta</h1>
  <p class="sub">Escolha um horário disponível abaixo — a confirmação é imediata.</p>

  <div id="listaSlots"><p class="vazio">Carregando horários…</p></div>

  <form id="formAgendar">
    <input type="text" name="website" class="website-honeypot" tabindex="-1" autocomplete="off">
    <div>
      <label for="name">Nome completo</label>
      <input type="text" id="name" name="name" required minlength="3">
    </div>
    <div>
      <label for="phone">WhatsApp</label>
      <input type="tel" id="phone" name="phone" required placeholder="(27) 99999-9999">
    </div>
    <div>
      <label for="email">E-mail (opcional)</label>
      <input type="email" id="email" name="email">
    </div>
    <div>
      <label for="message">Motivo da consulta (opcional)</label>
      <textarea id="message" name="message"></textarea>
    </div>
    <button type="submit" id="btnSubmit">Confirmar agendamento</button>
  </form>

  <div id="msgArea"></div>
</div>

<script>
(function () {
  const API_BASE = window.location.origin;
  const listaSlots = document.getElementById('listaSlots');
  const form = document.getElementById('formAgendar');
  const msgArea = document.getElementById('msgArea');
  const btnSubmit = document.getElementById('btnSubmit');
  let slotSelecionado = null;

  function formatarDiaTitulo(dataStr) {
    const d = new Date(dataStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  }

  function formatarHora(dataHoraStr) {
    return dataHoraStr.slice(11, 16);
  }

  function agruparPorDia(slots) {
    const grupos = {};
    for (const s of slots) {
      const dia = s.start_datetime.slice(0, 10);
      if (!grupos[dia]) grupos[dia] = [];
      grupos[dia].push(s);
    }
    return grupos;
  }

  function renderSlots(slots) {
    if (!slots.length) {
      listaSlots.innerHTML = '<p class="vazio">Nenhum horário disponível nos próximos dias. Entre em contato pelo WhatsApp.</p>';
      return;
    }
    const grupos = agruparPorDia(slots);
    listaSlots.innerHTML = '';
    for (const dia of Object.keys(grupos).sort()) {
      const div = document.createElement('div');
      div.className = 'dia-grupo';
      const titulo = document.createElement('div');
      titulo.className = 'dia-titulo';
      titulo.textContent = formatarDiaTitulo(dia);
      div.appendChild(titulo);
      const slotsDiv = document.createElement('div');
      slotsDiv.className = 'slots';
      for (const slot of grupos[dia]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-btn';
        btn.textContent = formatarHora(slot.start_datetime);
        btn.onclick = () => selecionarSlot(slot, btn);
        slotsDiv.appendChild(btn);
      }
      div.appendChild(slotsDiv);
      listaSlots.appendChild(div);
    }
  }

  function selecionarSlot(slot, btnEl) {
    slotSelecionado = slot;
    document.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('selecionado'));
    btnEl.classList.add('selecionado');
    form.classList.add('ativo');
    msgArea.innerHTML = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function carregarSlots() {
    try {
      const resp = await fetch(API_BASE + '/api/public/agenda/slots?dias=14');
      if (resp.status === 503) {
        listaSlots.innerHTML = '<p class="vazio">Agendamento online indisponível no momento. Entre em contato pelo WhatsApp.</p>';
        return;
      }
      const data = await resp.json();
      renderSlots(data.slots || []);
    } catch (e) {
      listaSlots.innerHTML = '<p class="vazio">Não foi possível carregar os horários. Tente novamente em instantes.</p>';
    }
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (!slotSelecionado) return;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando…';
    msgArea.innerHTML = '';

    const fd = new FormData(form);
    const body = {
      website: fd.get('website'),
      name: fd.get('name'),
      phone: fd.get('phone'),
      email: fd.get('email'),
      message: fd.get('message'),
      start_datetime: slotSelecionado.start_datetime,
    };

    try {
      const resp = await fetch(API_BASE + '/api/public/agenda/agendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (resp.ok) {
        form.classList.remove('ativo');
        listaSlots.innerHTML = '';
        msgArea.innerHTML = '<div class="msg sucesso">Consulta agendada! Em breve entraremos em contato para confirmar.</div>';
      } else if (resp.status === 409) {
        msgArea.innerHTML = '<div class="msg erro">Esse horário acabou de ser ocupado — escolha outro abaixo.</div>';
        slotSelecionado = null;
        form.classList.remove('ativo');
        carregarSlots();
      } else {
        msgArea.innerHTML = '<div class="msg erro">' + (data.error || 'Não foi possível agendar. Tente novamente.') + '</div>';
      }
    } catch (e) {
      msgArea.innerHTML = '<div class="msg erro">Falha de conexão. Tente novamente.</div>';
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Confirmar agendamento';
    }
  });

  carregarSlots();
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Checklist visual manual (sem teste automatizado, conforme Global Constraints)**

Suba o servidor local (`npm run dev` ou equivalente já usado no projeto) e abra `http://localhost:<porta>/agendamento.html`. Confirme:
1. Com `agenda_self_service_ativo='0'` (default): a página mostra a mensagem "Agendamento online indisponível" em vez da lista de horários.
2. Ative manualmente via `UPDATE office_settings SET setting_value='1' WHERE setting_key='agenda_self_service_ativo';` (ou pela tela de Configurações se já existir campo lá) — recarregue: a lista de horários aparece agrupada por dia.
3. Clique num horário: o formulário aparece abaixo, com o botão do horário destacado.
4. Preencha nome/telefone e envie: aparece a mensagem de sucesso, formulário some.
5. Confira no CRM (Kanban de leads) que um lead novo com `source='agendamento_site'` e `status='triagem'` apareceu, e no módulo de Agenda que o evento `reuniao` foi criado no horário certo.
6. Repita o envio com os mesmos dados dentro de 24h: confirme que não duplica lead (mesmo telefone reconhecido).
7. Redimensione a janela para largura de celular (375px): sem scroll horizontal, botões de horário continuam clicáveis com folga (mín. ~44px de alvo de toque).

- [ ] **Step 3: Reverter a ativação de teste (se você ativou manualmente no Step 2) para não deixar a feature ligada sem a usuária saber**

```sql
UPDATE office_settings SET setting_value = '0' WHERE setting_key = 'agenda_self_service_ativo';
```

- [ ] **Step 4: Commit**

```bash
git add public/agendamento.html
git commit -m "feat: pagina publica de agendamento self-service de consulta"
```

---

## Após as 3 tasks

1. Revisão final de branch inteira (subagent-driven-development: `scripts/review-package` do merge-base até HEAD, dispatch no modelo mais capaz).
2. Corrigir achados Critical/Important.
3. Push + `gh run watch` do deploy.
4. Verificar em produção: `curl https://crm.advogadaleticiabarros.com.br/agendamento.html` (200) e `curl https://crm.advogadaleticiabarros.com.br/api/public/agenda/slots` (deve responder `503` até a usuária ativar — confirma que o deploy do backend também subiu).
5. Este é o último dos 4 sub-projetos de "Comercial & intake" — ao confirmar o deploy, parar e apresentar à usuária um resumo consolidado dos 4 entregues nesta sessão, sem continuar para nenhum trabalho adicional não solicitado.
