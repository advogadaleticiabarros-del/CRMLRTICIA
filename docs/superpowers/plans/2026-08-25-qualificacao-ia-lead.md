# Qualificação automática do lead pela IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo lead novo com texto real (formulário público ou cadastro interno) é qualificado automaticamente pela IA — área jurídica (só se ainda vazia), urgência comercial e faixa de valor — sem nunca sobrescrever o que um humano já preencheu, sem nunca bloquear a criação do lead.

**Architecture:** Nova função `qualificarLead(leadId, texto)` em `src/services/aiAssistant.ts`, mesmo padrão de `interpretarMovimentacao`: 1 chamada `aiComplete(prompt, 'groq')`, parser tolerante por regex, gravação condicional (`legal_area` só se `NULL`; `ai_urgency`/`ai_value_range` sempre, são campos próprios). Disparada fire-and-forget nos 2 pontos de criação de lead. Frontend mostra badge de urgência no card do Kanban e uma caixa de sugestão no modal de detalhe.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM) no backend; vanilla JS sem build step no frontend (`public/app.js`); testes com `node --test` (arquivos `tests/*.test.mjs`).

## Global Constraints

- Nova migration `104_leads_ai_qualification.sql`: `leads.ai_urgency VARCHAR(10) NULL`, `leads.ai_value_range VARCHAR(10) NULL`.
- IA via `aiComplete(prompt, 'groq')` (já existe, `src/services/aiAssistant.ts:52`) — nunca lança exceção, retorna `{ok:false, message}` se indisponível/sem chave.
- `legal_area` só é gravada pela IA se o lead ainda estiver `NULL` — nunca sobrescreve escolha humana.
- `ai_urgency`/`ai_value_range` são campos próprios — nunca escrevem em `estimated_value`/`close_probability`.
- Dispara SÓ na criação (`POST /api/public/lead`, `POST /api/leads`), nunca em `PUT`/edições. Só chama a IA se houver texto ≥15 caracteres.
- Fire-and-forget: disparado sem `await`, antes da resposta HTTP final, nunca bloqueia nem falha a criação do lead.
- Sem sistema de quota novo — o rate-limit de IP já existente (`tooMany()`, `lead-public.ts`) é a única defesa de custo.
- Sem testes automatizados de frontend — badges validados com `node --check public/app.js` + checklist visual manual.
- Toda task de backend valida com `npx tsc --noEmit` (zero erros) e `node --test` (baseline: 226 testes, 218 pass, 0 fail, 8 skipped — sem regressão).

---

### Task 1: Backend — `qualificarLead()` em `aiAssistant.ts` + migration

**Files:**
- Create: `migrations/104_leads_ai_qualification.sql`
- Modify: `src/services/aiAssistant.ts` (adicionar ao final do arquivo, após `interpretarMovimentacao`, linha 324)
- Test: criar `tests/leadsAiQualification.test.mjs`

**Interfaces:**
- Produces: `export function parseLeadQualification(texto: string): { legal_area: string | null; ai_urgency: 'alta' | 'media' | 'baixa' | null; ai_value_range: 'alto' | 'medio' | 'baixo' | null }` — parser puro, sem I/O, testável isoladamente. `export async function qualificarLead(leadId: number, texto: string): Promise<{ ok: boolean; qualification?: ReturnType<typeof parseLeadQualification>; message?: string }>` — chama a IA, grava condicionalmente no banco (`legal_area` só se ainda `NULL`), sempre grava `ai_urgency`/`ai_value_range` quando a IA responde. Task 2 consome `qualificarLead`.

- [ ] **Step 1: Criar a migration**

Crie `migrations/104_leads_ai_qualification.sql`:

```sql
-- ============================================================
-- Migration 104 — Qualificação automática do lead pela IA
-- Sugestões da IA sobre um lead novo: urgência comercial e faixa de
-- valor estimado. Campos PRÓPRIOS (prefixo ai_) — nunca escrevem em
-- cima de legal_area/estimated_value definidos por humano. Ver
-- docs/superpowers/specs/2026-08-25-qualificacao-ia-lead.md
-- ============================================================

ALTER TABLE leads ADD COLUMN ai_urgency VARCHAR(10) NULL;
ALTER TABLE leads ADD COLUMN ai_value_range VARCHAR(10) NULL;
```

- [ ] **Step 2: Rodar a auditoria de schema (deve continuar passando)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test tests/dashboards.test.mjs`
Expected: `pass 4`, `fail 0`

- [ ] **Step 3: Escrever o teste do parser (falha primeiro — a função ainda não existe)**

Crie `tests/leadsAiQualification.test.mjs`:

```javascript
// tests/leadsAiQualification.test.mjs
// parseLeadQualification é o parser PURO (sem I/O) da resposta da IA
// pra qualificação automática de lead — mesmo padrão de tolerância a
// formato inesperado que parseMovementAiResponse já usa em produção
// (aiAssistant.ts:283-297). Ver
// docs/superpowers/specs/2026-08-25-qualificacao-ia-lead.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { parseLeadQualification } = await import('../dist/services/aiAssistant.js');

test('resposta bem formada: extrai os 3 campos corretamente', () => {
  const texto = `ÁREA: trabalhista
URGÊNCIA: Alta
FAIXA DE VALOR: Alto`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.legal_area, 'trabalhista');
  assert.strictEqual(r.ai_urgency, 'alta');
  assert.strictEqual(r.ai_value_range, 'alto');
});

test('legal_area fora das 7 chaves válidas vira null, não quebra', () => {
  const texto = `ÁREA: direito penal
URGÊNCIA: Média
FAIXA DE VALOR: Médio`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.legal_area, null, 'área inválida deveria virar null, não quebrar nem inventar valor');
  assert.strictEqual(r.ai_urgency, 'media');
  assert.strictEqual(r.ai_value_range, 'medio');
});

test('ai_urgency fora de alta/media/baixa cai no fallback conservador (baixa)', () => {
  const texto = `ÁREA: civel
URGÊNCIA: Urgentíssimo
FAIXA DE VALOR: Baixo`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.ai_urgency, 'baixa', 'valor fora do esperado deveria cair no default conservador, igual PRIORIDADE em parseMovementAiResponse');
});

test('ai_value_range fora de alto/medio/baixo cai em null (sem inventar faixa)', () => {
  const texto = `ÁREA: familia
URGÊNCIA: Baixa
FAIXA DE VALOR: Não sei dizer`;
  const r = parseLeadQualification(texto);
  assert.strictEqual(r.ai_value_range, null);
});

test('texto vazio ou sem nenhum campo reconhecível: tudo null, não lança exceção', () => {
  assert.doesNotThrow(() => parseLeadQualification(''));
  const r = parseLeadQualification('texto qualquer sem os rótulos esperados');
  assert.strictEqual(r.legal_area, null);
  assert.strictEqual(r.ai_urgency, null);
  assert.strictEqual(r.ai_value_range, null);
});
```

- [ ] **Step 4: Rodar o teste para confirmar que falha (a função ainda não existe)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc && node --test tests/leadsAiQualification.test.mjs`
Expected: FAIL — `parseLeadQualification` não é exportado por `dist/services/aiAssistant.js` (erro de import/undefined).

- [ ] **Step 5: Implementar `parseLeadQualification` e `qualificarLead` em `aiAssistant.ts`**

Adicione ao final do arquivo (após a função `interpretarMovimentacao`, linha 324):

```typescript

// ── Qualificação automática de lead (área, urgência, faixa de valor) ────────
// Mesmo padrão de interpretarMovimentacao/parseMovementAiResponse acima:
// prompt com campos rotulados em texto plano, parser tolerante por regex,
// fallback conservador se o campo não bater no formato esperado.
const LEGAL_AREAS_VALIDAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

export interface LeadQualification {
  legal_area: string | null;
  ai_urgency: 'alta' | 'media' | 'baixa' | null;
  ai_value_range: 'alto' | 'medio' | 'baixo' | null;
}

export function parseLeadQualification(texto: string): LeadQualification {
  const campo = (rotulo: string) => {
    const m = texto.match(new RegExp(`${rotulo}:\\s*(.+)`, 'i'));
    return m ? m[1].trim().toLowerCase() : '';
  };

  const areaRaw = campo('ÁREA').normalize('NFD').replace(/[̀-ͯ]/g, ''); // remove acento
  const legal_area = LEGAL_AREAS_VALIDAS.includes(areaRaw) ? areaRaw : null;

  const urgenciaRaw = campo('URGÊNCIA');
  let ai_urgency: LeadQualification['ai_urgency'] = null;
  if (urgenciaRaw === 'alta') ai_urgency = 'alta';
  else if (urgenciaRaw === 'média' || urgenciaRaw === 'media') ai_urgency = 'media';
  else if (urgenciaRaw) ai_urgency = 'baixa'; // qualquer outra coisa dita (inclusive "baixa") vira o default conservador

  const faixaRaw = campo('FAIXA DE VALOR');
  let ai_value_range: LeadQualification['ai_value_range'] = null;
  if (faixaRaw === 'alto') ai_value_range = 'alto';
  else if (faixaRaw === 'médio' || faixaRaw === 'medio') ai_value_range = 'medio';
  else if (faixaRaw === 'baixo') ai_value_range = 'baixo';
  // qualquer outra coisa (inclusive vazio) fica null — sem inventar faixa

  return { legal_area, ai_urgency, ai_value_range };
}

/**
 * Qualifica um lead novo pela IA: sugere área (só grava se o lead ainda
 * não tiver uma), urgência comercial e faixa de valor estimado. Nunca
 * lança exceção — chamado fire-and-forget na criação do lead (ver
 * src/routes/lead-public.ts e src/routes/leads.ts).
 */
export async function qualificarLead(
  leadId: number,
  texto: string
): Promise<{ ok: boolean; qualification?: LeadQualification; message?: string }> {
  const teor = (texto || '').trim();
  if (teor.length < 15) return { ok: false, message: 'Texto insuficiente para qualificar' };

  const prompt = `Você é assistente comercial de um escritório de advocacia. Leia o relato de um lead (possível cliente) abaixo e responda EXATAMENTE neste formato, sem texto fora dele:
ÁREA: <uma destas: trabalhista, gestante, familia, civel, previdenciario, consumidor, outro>
URGÊNCIA: <Alta, Média ou Baixa — o quão rápido esse lead precisa ser atendido comercialmente>
FAIXA DE VALOR: <Alto, Médio ou Baixo — estimativa qualitativa do potencial financeiro do caso>

RELATO DO LEAD:
${teor}`;

  const r = await aiComplete(prompt, 'groq');
  if (!r.ok || !r.text) return { ok: false, message: r.message || 'IA indisponível' };

  const qualification = parseLeadQualification(r.text);

  try {
    if (qualification.legal_area) {
      await db.query(
        'UPDATE leads SET legal_area = COALESCE(legal_area, ?), ai_urgency = ?, ai_value_range = ? WHERE id = ?',
        [qualification.legal_area, qualification.ai_urgency, qualification.ai_value_range, leadId]
      );
    } else {
      await db.query(
        'UPDATE leads SET ai_urgency = ?, ai_value_range = ? WHERE id = ?',
        [qualification.ai_urgency, qualification.ai_value_range, leadId]
      );
    }
  } catch (e: any) {
    return { ok: false, message: e.message };
  }

  return { ok: true, qualification };
}
```

- [ ] **Step 6: Rodar o teste de novo — deve passar**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc && node --test tests/leadsAiQualification.test.mjs`
Expected: `pass 5`, `fail 0`

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 8: Rodar a suíte completa (sem regressão)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test`
Expected: `pass` ≥ 223 (218 baseline + 5 novos), `fail 0`

- [ ] **Step 9: Commit**

```bash
git add migrations/104_leads_ai_qualification.sql src/services/aiAssistant.ts tests/leadsAiQualification.test.mjs
git commit -m "feat: qualificação automática de lead pela IA (parser + gravação condicional)"
```

---

### Task 2: Backend — disparo fire-and-forget na criação do lead

**Files:**
- Modify: `src/routes/lead-public.ts:126-140` (handler `POST /lead`)
- Modify: `src/routes/leads.ts:113-152` (handler `POST /`)

**Interfaces:**
- Consumes: `qualificarLead(leadId, texto)` (Task 1) — importado de `../services/aiAssistant`.
- Produces: nenhuma interface nova — Task 3 (frontend) só lê as colunas `ai_urgency`/`ai_value_range` que já vêm em qualquer `SELECT * FROM leads`/`GET /api/leads/board` (nenhum SELECT explícito precisa mudar, exceto se `GET /board` usa lista de colunas nomeada — ver Step 3 desta task).

- [ ] **Step 1: Disparar em `POST /api/public/lead`**

Releia o final do handler `POST /lead` em `src/routes/lead-public.ts` (linhas 126-140 do arquivo original — confirme contra o arquivo real, já que a Task 1 não tocou este arquivo, os números não devem ter deslocado):

```typescript
  const [ins] = await db.query(
    `INSERT INTO leads (user_id, name, phone, email, source, legal_area, status, case_summary,
                         utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page)
     VALUES (?, ?, ?, ?, ?, ?, 'triagem', ?, ?, ?, ?, ?, ?, ?)`,
    [admin.id, name, phone, email, source, area, message ? `Mensagem enviada pelo site:\n"${message}"` : null,
     utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page]
  ) as any;

  await notifyNewLead({ leadId: ins.insertId, name, phone, source, area, message });

  if (utm_campaign && CAMPANHAS_EBOOK[utm_campaign]) {
    enviarEbook(utm_campaign, name, email, phone).catch(() => {});
  }

  res.status(201).json({ success: true });
});
```

Substitua por (adicionando o import no topo do arquivo e o disparo antes do `res.status(201)`):

```typescript
  const [ins] = await db.query(
    `INSERT INTO leads (user_id, name, phone, email, source, legal_area, status, case_summary,
                         utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page)
     VALUES (?, ?, ?, ?, ?, ?, 'triagem', ?, ?, ?, ?, ?, ?, ?)`,
    [admin.id, name, phone, email, source, area, message ? `Mensagem enviada pelo site:\n"${message}"` : null,
     utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page]
  ) as any;

  await notifyNewLead({ leadId: ins.insertId, name, phone, source, area, message });

  if (utm_campaign && CAMPANHAS_EBOOK[utm_campaign]) {
    enviarEbook(utm_campaign, name, email, phone).catch(() => {});
  }

  // Qualificação automática pela IA (fire-and-forget) — só quando há texto
  // real; nunca atrasa nem falha a resposta ao formulário público.
  if (message && message.length >= 15) {
    qualificarLead(ins.insertId, message).catch(() => {});
  }

  res.status(201).json({ success: true });
});
```

No topo do arquivo, adicione o import junto aos já existentes:

```typescript
import { qualificarLead } from '../services/aiAssistant';
```

- [ ] **Step 2: Disparar em `POST /api/leads`**

Releia o handler `POST /` completo em `src/routes/leads.ts` (linhas 113-152 do arquivo original):

```typescript
router.post('/', async (req: Request, res: Response) => {
  const { name, email, phone, source, legal_area, status, notes, client_id } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'O nome é obrigatório' });
    return;
  }

  const extraVals = EXTRA_COLS.map((col) => {
    const v = req.body[col];
    if (v === undefined || v === '') return null;
    return normalizeExtraVal(col, v);
  });
  const [result] = await db.query(
    `INSERT INTO leads (user_id, client_id, name, email, phone, source, legal_area, status, notes, ${EXTRA_COLS.join(', ')})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${EXTRA_COLS.map(() => '?').join(', ')})`,
    [
      req.user!.id, client_id ?? null, name.trim(), email ?? null, phone ?? null, source ?? null,
      AREAS.includes(legal_area) ? legal_area : null, STATUSES.includes(status) ? status : 'triagem', notes ?? null,
      ...extraVals,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [result.insertId]) as any;

  await notifyNewLead({
    leadId: result.insertId, name: rows[0].name, phone: rows[0].phone,
    source: rows[0].source, area: rows[0].legal_area, message: rows[0].notes,
  });

  await logActivity({
    leadId: result.insertId, clientId: client_id ?? null, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_created', title: 'Lead entrou no funil',
    description: `Origem: ${source || '—'} · Área: ${rows[0].legal_area || '—'}`,
    newValue: STATUS_PT[rows[0].status] || rows[0].status,
  });

  res.status(201).json(rows[0]);
});
```

Substitua por (adicionando o disparo antes do `res.status(201)`):

```typescript
router.post('/', async (req: Request, res: Response) => {
  const { name, email, phone, source, legal_area, status, notes, client_id } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'O nome é obrigatório' });
    return;
  }

  const extraVals = EXTRA_COLS.map((col) => {
    const v = req.body[col];
    if (v === undefined || v === '') return null;
    return normalizeExtraVal(col, v);
  });
  const [result] = await db.query(
    `INSERT INTO leads (user_id, client_id, name, email, phone, source, legal_area, status, notes, ${EXTRA_COLS.join(', ')})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${EXTRA_COLS.map(() => '?').join(', ')})`,
    [
      req.user!.id, client_id ?? null, name.trim(), email ?? null, phone ?? null, source ?? null,
      AREAS.includes(legal_area) ? legal_area : null, STATUSES.includes(status) ? status : 'triagem', notes ?? null,
      ...extraVals,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [result.insertId]) as any;

  await notifyNewLead({
    leadId: result.insertId, name: rows[0].name, phone: rows[0].phone,
    source: rows[0].source, area: rows[0].legal_area, message: rows[0].notes,
  });

  await logActivity({
    leadId: result.insertId, clientId: client_id ?? null, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_created', title: 'Lead entrou no funil',
    description: `Origem: ${source || '—'} · Área: ${rows[0].legal_area || '—'}`,
    newValue: STATUS_PT[rows[0].status] || rows[0].status,
  });

  // Qualificação automática pela IA (fire-and-forget) — case_summary é o
  // texto mais rico disponível no cadastro interno; sem ele, notes.
  const textoQualificacao = rows[0].case_summary || rows[0].notes || '';
  if (textoQualificacao.length >= 15) {
    qualificarLead(result.insertId, textoQualificacao).catch(() => {});
  }

  res.status(201).json(rows[0]);
});
```

No topo do arquivo, adicione o import junto aos já existentes:

```typescript
import { qualificarLead } from '../services/aiAssistant';
```

- [ ] **Step 3: Confirmar que `GET /api/leads/board` retorna as novas colunas**

Run: `grep -n "SELECT id, name, email, phone" src/routes/leads.ts`
Expected: uma linha mostrando a query de `GET /board` com `SELECT` explícito de colunas nomeadas. Releia essa query completa e adicione `ai_urgency, ai_value_range` à lista de colunas (mesmo formato do `first_response_at` já adicionado no sub-projeto anterior desta sessão) — se a query já usa `SELECT *`, este step não se aplica, pule para o Step 4.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 5: Rodar a suíte completa (sem regressão)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test`
Expected: `pass` ≥ 223, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add src/routes/lead-public.ts src/routes/leads.ts
git commit -m "feat: dispara qualificação de lead pela IA na criação (fire-and-forget)"
```

---

### Task 3: Frontend — badge de urgência + caixa de sugestão no modal

**Files:**
- Modify: `public/app.js` (função `leadResponseBadge`/card do Kanban, dentro de `leads(page)` — mesma área tocada no sub-projeto do cronômetro)
- Modify: `public/app.js` (dentro de `leadDetail`, próximo ao campo "Área")
- Modify: `public/styles.css` (novas classes de badge de urgência)

**Interfaces:**
- Consumes: `GET /api/leads/board` e `GET /api/leads/:id` (Task 2) — cada lead agora tem `ai_urgency` (`alta|media|baixa|null`), `ai_value_range` (`alto|medio|baixo|null`).
- Produces: nenhuma interface nova — esta é a última task deste plano.

- [ ] **Step 1: Adicionar a função de badge de urgência**

Releia a área onde `leadResponseBadge` foi definida (sub-projeto anterior desta sessão, escopo de módulo antes de `const ROUTES = {`) e adicione logo depois dela:

```javascript
// Badge de urgência comercial sugerida pela IA (sub-projeto "Qualificação
// automática do lead pela IA"). Silêncio é o padrão: sem badge se baixa/
// nulo — só chama atenção quando é alto ou médio, igual o resto do
// sistema evita alarme constante.
function leadUrgencyBadge(aiUrgency) {
  if (aiUrgency === 'alta') return '<span class="badge-urgencia badge-urgencia-alta" title="Urgência sugerida pela IA">⚡ Urgente</span>';
  if (aiUrgency === 'media') return '<span class="badge-urgencia badge-urgencia-media" title="Urgência sugerida pela IA">Atenção</span>';
  return '';
}
```

- [ ] **Step 2: Usar o badge no card do Kanban**

Releia a linha do card do Kanban (mesma linha tocada no sub-projeto do cronômetro, dentro de `leads(page)`):

```javascript
        ${(b[k] || []).map((l) => `<div class="kanban-card" draggable="true" data-lead="${l.id}" data-stage="${k}">
          <strong>${esc(l.name)}</strong><small>${l.legal_area || ''} · ${l.source || ''}</small>
          ${leadResponseBadge(l.created_at, l.first_response_at)}</div>`).join('')}</div>`).join('');
```

Substitua por:

```javascript
        ${(b[k] || []).map((l) => `<div class="kanban-card" draggable="true" data-lead="${l.id}" data-stage="${k}">
          <strong>${esc(l.name)}</strong><small>${l.legal_area || ''} · ${l.source || ''}</small>
          ${leadResponseBadge(l.created_at, l.first_response_at)}${leadUrgencyBadge(l.ai_urgency)}</div>`).join('')}</div>`).join('');
```

- [ ] **Step 3: Adicionar o CSS das variantes de urgência**

Em `public/styles.css`, adicione ao final do arquivo (mesmo padrão dos badges de tempo do sub-projeto anterior):

```css
/* Badge de urgência sugerida pela IA (Kanban de leads) */
.badge-urgencia { display: inline-block; margin-top: 4px; margin-left: 4px; padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600; }
.badge-urgencia-alta { background: var(--red-bg, #fbe9e7); color: var(--red, #c4453b); }
.badge-urgencia-media { background: var(--amber-bg, #fbf1dc); color: var(--amber, #c08a2e); }
```

- [ ] **Step 4: Adicionar a caixa de sugestão no modal `leadDetail`**

Releia o trecho do campo "Área" em `leadDetail` (`<div class="form-row">${field('Área', 'legal_area', ...)`) e adicione logo depois (antes do `<hr>` seguinte):

```javascript
    <div class="form-row">${field('Área', 'legal_area', { value: l.legal_area || 'outro', options: AREAS })}<button class="btn-sm" id="save-area" style="align-self:end">Salvar área</button></div>
    ${(l.ai_urgency || l.ai_value_range) ? `<div style="font-size:12.5px;background:var(--surface-2,#f4f1ea);border-radius:8px;padding:8px 12px;color:var(--text-soft)">
      <strong style="color:var(--navy)">Sugestão da IA:</strong>
      ${l.ai_urgency ? ` urgência ${l.ai_urgency === 'alta' ? 'alta' : l.ai_urgency === 'media' ? 'média' : 'baixa'}` : ''}${l.ai_urgency && l.ai_value_range ? ' · ' : ''}${l.ai_value_range ? `valor estimado ${l.ai_value_range}` : ''}
    </div>` : ''}
    <hr style="border:none;border-top:1px solid var(--border)">
```

- [ ] **Step 5: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem erros

- [ ] **Step 6: Rodar a suíte completa (garantir zero regressão de backend)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc --noEmit && node --test`
Expected: `tsc` sem erros; `node --test` com `pass` ≥ 223, `fail 0`

- [ ] **Step 7: Checklist visual manual (sem testes automatizados de frontend no projeto)**

No navegador, logado como staff/admin, na tela Leads:
- [ ] Criar um lead via `POST /api/public/lead` (ou aguardar um lead real do site) com texto de pelo menos 15 caracteres em `message` — depois de alguns segundos (chamada de IA assíncrona), recarregar o board e conferir se o card mostra o badge de urgência (se a IA classificou como alta/média) e se `legal_area` foi preenchida (se estava vazia).
- [ ] Um lead cuja `legal_area` já foi definida manualmente antes da qualificação da IA rodar continua com a área original — a IA não deve tê-la sobrescrito.
- [ ] Abrir o detalhe de um lead qualificado — a caixa "Sugestão da IA" aparece mostrando urgência/valor, sem nenhum botão de ação automática.
- [ ] Um lead sem `ai_urgency`/`ai_value_range` (nunca qualificado, ou texto insuficiente) não mostra a caixa de sugestão nem quebra o layout do modal.
- [ ] Se `GEMINI_API_KEY`/`GROQ_API_KEY` não estiverem configuradas no ambiente, a criação do lead continua funcionando normalmente (sem erro, sem atraso perceptível) — só não aparece nenhuma sugestão depois.

- [ ] **Step 8: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: badge de urgência + sugestão da IA no modal do lead (frontend)"
```

---

## Self-Review (checklist do autor do plano, já verificado)

1. **Cobertura da spec**: Decisão 1 (3 campos, 1 chamada) → Task 1 Step 5 (prompt + parser). Decisão 2 (nunca sobrescreve humano) → Task 1 Step 5 (`COALESCE(legal_area, ?)` só quando IA sugeriu algo; `ai_urgency`/`ai_value_range` em coluna própria). Decisão 3 (dispara só na criação, com texto mínimo, fire-and-forget) → Task 2 Steps 1-2. Decisão 4 (sem quota nova) → nenhuma task adiciona sistema de quota, conforme decidido. Decisão 5 (badges + caixa de sugestão) → Task 3.
2. **Placeholders**: nenhum "TBD"/"adicionar validação" sem código — todo step tem o código completo a escrever.
3. **Consistência de tipos**: `LeadQualification` (interface TS, Task 1) tem `legal_area: string | null`, `ai_urgency: 'alta'|'media'|'baixa'|null`, `ai_value_range: 'alto'|'medio'|'baixo'|null` — os mesmos 3 nomes de campo e os mesmos valores possíveis são usados em `qualificarLead` (Task 1), nas colunas da migration (Task 1), e na leitura do frontend (`l.ai_urgency`, `l.ai_value_range`, Task 3). `qualificarLead(leadId, texto)` é chamada com a mesma assinatura nos dois pontos de disparo (Task 2).
