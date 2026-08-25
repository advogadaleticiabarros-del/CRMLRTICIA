# Cockpit único (Briefing → ação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada linha do painel "Cockpit" (aba do Dashboard) ganha um botão "Resolver" que marca o item como tratado e o remove da lista imediatamente, sem esconder o item pra sempre — ele volta a aparecer no dia seguinte se a origem ainda existir.

**Architecture:** Nova tabela `cockpit_resolutions` (item_key + user_id + timestamp) guarda o que foi resolvido, sem tocar nas tabelas de origem (deadlines/detected_deadlines/movement_alerts/calendar_events). A rota `GET /api/dashboards/cockpit` passa a compor um `item_key` estável por linha (`{dominio}:{id}`) e excluir os já resolvidos hoje (fuso de Brasília). Uma nova rota `POST /api/dashboards/cockpit/resolver` grava a resolução. O frontend (`public/app.js`) passa o `item_key` para cada linha renderizada e remove a linha do DOM assim que o clique no botão retorna sucesso.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM) no backend; vanilla JS sem build step no frontend (`public/app.js`); testes com `node --test` (arquivos `tests/*.test.mjs`).

## Global Constraints

- Fuso horário: `America/Sao_Paulo` via `CONVERT_TZ(coluna, '+00:00', '-03:00')` — nunca `CURDATE()` puro para comparar com datas gravadas em UTC (bug real identificado no design: o servidor MySQL roda em UTC).
- Autenticação da nova rota: `authenticate, requireStaff` — mesmo middleware já usado em `app.use('/api/dashboards/cockpit', authenticate, requireStaff, cockpitDashboard)` (`src/app.ts:210`). Não usar `requireAdmin`.
- `item_key` é `VARCHAR(64)`, formato `{dominio}:{id}` com `dominio` em minúsculas ASCII sem acento. Domínios válidos nesta fase: `prazo`, `intimacao`, `alerta`, `agenda`.
- Sem testes automatizados de frontend no projeto — a task de frontend é validada com `node --check public/app.js` (sintaxe) e checklist visual manual, não invente testes automatizados de UI.
- Toda task valida com `npx tsc --noEmit` (zero erros) e `node --test` (baseline atual: 218 testes, 215 pass, 0 fail, 3 skipped — não pode haver regressão nesse número de pass/fail).
- `POST /resolver` deve ser idempotente (chamar duas vezes com o mesmo `item_key` não gera erro nem duplicata) — usar `INSERT ... ON DUPLICATE KEY UPDATE`.

---

### Task 1: Migration da tabela `cockpit_resolutions`

**Files:**
- Create: `migrations/102_cockpit_resolutions.sql`
- Test: `tests/dashboards.test.mjs` (já existe — roda automaticamente contra qualquer migration nova, nenhuma mudança de código nele)

**Interfaces:**
- Produces: tabela `cockpit_resolutions` com colunas `id, item_key, user_id, resolved_at`, chave única `(item_key, user_id)`, FK `user_id → users(id) ON DELETE CASCADE`. Tasks 2 e 3 dependem deste schema exato.

- [ ] **Step 1: Criar a migration**

Crie `migrations/102_cockpit_resolutions.sql` com o conteúdo exato:

```sql
-- ============================================================
-- Migration 102 — Resolução de itens do Cockpit
-- Guarda quais itens do painel "Cockpit" (prazos/intimações/alertas/
-- agenda) a usuária marcou como resolvidos, sem tocar nas tabelas de
-- origem (deadlines/detected_deadlines/movement_alerts/calendar_events).
-- Expira sozinho: o filtro de leitura só considera resolved_at de HOJE
-- (fuso America/Sao_Paulo) — ver src/routes/dashboards/cockpit.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS cockpit_resolutions (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_key     VARCHAR(64)  NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  resolved_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cockpit_resolution (item_key, user_id),
  CONSTRAINT fk_cockpit_resolution_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Rodar a auditoria de schema (deve continuar passando — a tabela nova ainda não é usada por nenhuma query)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test tests/dashboards.test.mjs`
Expected: `pass 4`, `fail 0` (as 4 asserções do arquivo, sem regressão)

- [ ] **Step 3: Rodar a migration localmente (se houver banco de dev acessível) ou confirmar que o pipeline de deploy aplica migrations automaticamente**

Run: `grep -n "migrate" package.json`
Expected: confirma que existe um script `migrate` (`node dist/scripts/migrate.js`) — não precisa rodar contra produção agora, só confirmar que a migration será aplicada no próximo deploy via esse mecanismo.

- [ ] **Step 4: Commit**

```bash
git add migrations/102_cockpit_resolutions.sql
git commit -m "feat: cria tabela cockpit_resolutions para o botão de resolver do Cockpit"
```

---

### Task 2: Backend — item_key, filtro de resolvidos e rota de resolver

**Files:**
- Modify: `src/routes/dashboards/cockpit.ts:78-135` (as 4 queries de prazos/intimações/alertas/agenda) e `:165-174` (o `res.json`)
- Test: `tests/dashboards.test.mjs` (auditoria de schema — deve continuar passando sem mudanças no arquivo)
- Test: criar `tests/cockpitResolver.test.mjs`

**Interfaces:**
- Consumes: tabela `cockpit_resolutions` (Task 1) — colunas `item_key VARCHAR(64)`, `user_id INT UNSIGNED`, `resolved_at DATETIME`.
- Produces:
  - `GET /api/dashboards/cockpit` — cada item de `prazos`, `intimacoes.itens`, `alertas.itens`, `agenda_hoje` ganha um campo `item_key: string` (formato `{dominio}:{id}`); itens cujo `item_key` está resolvido hoje são excluídos do array antes de contar/retornar; `intimacoes.count` e `alertas.count` refletem o array já filtrado.
  - `POST /api/dashboards/cockpit/resolver` — body `{ item_key: string }`, resposta `{ success: true }` em 200, `{ error: string }` em 400 se `item_key` ausente/vazio ou não bater no formato `{dominio}:{id}` esperado.

- [ ] **Step 1: Escrever o teste da rota de resolver (falha primeiro — a rota ainda não existe)**

Crie `tests/cockpitResolver.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Testes estáticos (sem banco): confirmam que a rota de resolver existe,
 * está registrada com o middleware correto, e que o handler valida o
 * formato de item_key antes de tocar no banco — sem precisar de conexão
 * MySQL real (o projeto não roda testes de integração com banco).
 */

const raiz = path.resolve('.');
const rotaPath = path.join(raiz, 'src/routes/dashboards/cockpit.ts');
const appPath = path.join(raiz, 'src/app.ts');

test('a rota POST /resolver está definida em cockpit.ts', () => {
  const src = fs.readFileSync(rotaPath, 'utf8');
  assert.match(src, /router\.post\(\s*['"]\/resolver['"]/, 'esperava router.post(\'/resolver\', ...)');
});

test('a rota /api/dashboards/cockpit continua usando authenticate + requireStaff (não requireAdmin)', () => {
  const src = fs.readFileSync(appPath, 'utf8');
  const linha = src.split('\n').find((l) => l.includes("'/api/dashboards/cockpit'"));
  assert.ok(linha, 'linha da rota não encontrada em src/app.ts');
  assert.match(linha, /authenticate,\s*requireStaff/, `esperava authenticate+requireStaff, achei: ${linha}`);
  assert.doesNotMatch(linha, /requireAdmin/, 'a rota do Cockpit não deve exigir admin');
});

test('o handler de /resolver valida o formato do item_key antes de usar', () => {
  const src = fs.readFileSync(rotaPath, 'utf8');
  // Confirma que existe alguma validação de formato (regex ou checagem
  // manual) antes do INSERT — não aceita string vazia/arbitrária.
  const trechoResolver = src.slice(src.indexOf("post('/resolver'"));
  assert.match(trechoResolver, /item_key/);
  assert.match(trechoResolver, /ON DUPLICATE KEY UPDATE/i, 'o INSERT deve ser idempotente');
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha (a rota não existe ainda)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test tests/cockpitResolver.test.mjs`
Expected: FAIL — `router.post('/resolver'...)` não encontrado no arquivo (a primeira asserção falha)

- [ ] **Step 3: Adicionar `item_key` às 4 queries e o filtro de resolvidos**

Em `src/routes/dashboards/cockpit.ts`, adicione logo após a linha 9 (`}`  que fecha a função `safe`) uma função auxiliar que busca as chaves resolvidas hoje:

```typescript
/** Chaves de item resolvidas HOJE (fuso America/Sao_Paulo) pelo usuário — usadas
 *  para excluir itens já tratados das listas de prazos/intimações/alertas/agenda.
 *  CURDATE() puro compararia com o dia em UTC (servidor roda em UTC), reaparecendo
 *  os itens 3h cedo demais — por isso o CONVERT_TZ explícito nos dois lados. */
async function resolvidosHoje(userId: number): Promise<Set<string>> {
  const [rows] = await db.query(
    `SELECT item_key FROM cockpit_resolutions
      WHERE user_id = ?
        AND DATE(CONVERT_TZ(resolved_at, '+00:00', '-03:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-03:00'))`,
    [userId]
  ) as any;
  return new Set(rows.map((r: any) => r.item_key));
}
```

Substitua o bloco de `prazos` (linhas 78-91) por:

```typescript
  const resolvidos = await safe(() => resolvidosHoje(userId), new Set<string>());

  // Prazos críticos — pendentes vencidos ou nas próximas 72h
  const prazos = await safe(async () => {
    const [rows] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, c.case_number,
             cl.name AS client_name,
             TIMESTAMPDIFF(DAY, NOW(), d.deadline_date) AS days_remaining,
             (d.deadline_date < NOW()) AS vencido
        FROM deadlines d
        LEFT JOIN cases c    ON c.id  = d.case_id
        LEFT JOIN clients cl ON cl.id = d.client_id
       WHERE d.user_id = ? AND d.status = 'pendente'
         AND d.deadline_date <= DATE_ADD(NOW(), INTERVAL 3 DAY)
       ORDER BY d.deadline_date ASC LIMIT 15`, [userId]) as any;
    return rows
      .map((r: any) => ({ ...r, item_key: `prazo:${r.id}` }))
      .filter((r: any) => !resolvidos.has(r.item_key));
  }, [] as any[]);
```

Substitua o bloco de `intimacoes` (linhas 93-111) por:

```typescript
  // Intimações a confirmar (detector DJEN) — com a análise do estagiário
  const intimacoes = await safe(async () => {
    const [rows] = await db.query(`
      SELECT d.id, COALESCE(c.name, cp.name) AS client_name, d.suggested_type,
             d.suggested_days, d.start_date, lp.process_number,
             (d.ai_draft_id IS NOT NULL) AS tem_minuta
        FROM detected_deadlines d
        LEFT JOIN legal_processes lp ON lp.id = d.process_id
        LEFT JOIN clients c  ON c.id  = d.client_id
        LEFT JOIN clients cp ON cp.id = lp.client_id
       -- ANTES havia um filtro por lp.user_id. A tabela legal_processes NAO TEM
       -- a coluna user_id: o MySQL lancava erro, o safe() engolia e esta secao
       -- ficava SEMPRE VAZIA. Intimacao nova nunca aparecia no Cockpit — risco
       -- direto de PRAZO PERDIDO. Os processos sao do escritorio, nao de um
       -- usuario: nao ha o que filtrar.
       WHERE d.status = 'a_confirmar'
       ORDER BY d.start_date DESC LIMIT 10`) as any;
    return rows
      .map((r: any) => ({ ...r, item_key: `intimacao:${r.id}` }))
      .filter((r: any) => !resolvidos.has(r.item_key));
  }, [] as any[]);
```

Substitua o bloco de `alertas` (linhas 113-124) por:

```typescript
  // Alertas de movimentação sem intimação (salvaguarda DataJud)
  const alertas = await safe(async () => {
    const [rows] = await db.query(`
      SELECT ma.id, ma.title, ma.detected_keyword, lp.process_number
        FROM movement_alerts ma
        LEFT JOIN legal_processes lp ON lp.id = ma.process_id
       -- Mesmo bug: legal_processes não tem user_id. A salvaguarda do DataJud
       -- (movimentação sem intimação) ficava sempre vazia.
       WHERE ma.status = 'aberto'
       ORDER BY ma.created_at DESC LIMIT 10`) as any;
    return rows
      .map((r: any) => ({ ...r, item_key: `alerta:${r.id}` }))
      .filter((r: any) => !resolvidos.has(r.item_key));
  }, [] as any[]);
```

Substitua o bloco de `agenda_hoje` (linhas 126-135) por:

```typescript
  // Agenda de hoje (reuniões/audiências/compromissos — excluindo canceladas)
  const agenda_hoje = await safe(async () => {
    const [rows] = await db.query(`
      SELECT ce.id, ce.title, ce.event_type, ce.start_datetime, cl.name AS client_name
        FROM calendar_events ce
        LEFT JOIN clients cl ON cl.id = ce.client_id
       WHERE ce.user_id = ? AND DATE(ce.start_datetime) = CURDATE() AND ce.sync_status NOT IN ('cancelado','erro')
       ORDER BY ce.start_datetime ASC`, [userId]) as any;
    return rows
      .map((r: any) => ({ ...r, item_key: `agenda:${r.id}` }))
      .filter((r: any) => !resolvidos.has(r.item_key));
  }, [] as any[]);
```

O bloco `res.json({...})` (linhas 165-174) não precisa mudar — `intimacoes.count`/`alertas.count` já usam `.length` do array que agora está filtrado.

- [ ] **Step 4: Adicionar a rota `POST /resolver`**

Logo antes de `export default router;` (linha 177), adicione:

```typescript
// ── POST /api/dashboards/cockpit/resolver — marca um item como resolvido ──
// Idempotente (ON DUPLICATE KEY UPDATE): clicar duas vezes no mesmo item não
// gera erro nem duplicata. Expira sozinho à meia-noite de Brasília — ver
// resolvidosHoje() acima, que só considera resolved_at de hoje.
const ITEM_KEY_RE = /^[a-z]+:[0-9]+$/;

router.post('/resolver', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { item_key } = req.body || {};
  if (typeof item_key !== 'string' || !ITEM_KEY_RE.test(item_key)) {
    res.status(400).json({ error: 'item_key inválido — formato esperado: dominio:id' });
    return;
  }
  await db.query(
    `INSERT INTO cockpit_resolutions (item_key, user_id, resolved_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE resolved_at = NOW()`,
    [item_key, userId]
  );
  res.json({ success: true });
});
```

- [ ] **Step 5: Rodar o teste de novo — deve passar**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test tests/cockpitResolver.test.mjs`
Expected: `pass 3`, `fail 0`

- [ ] **Step 6: Rodar a auditoria de schema — deve continuar passando (a query nova só usa colunas que existem)**

Run: `node --test tests/dashboards.test.mjs`
Expected: `pass 4`, `fail 0`

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 8: Rodar a suíte completa (sem regressão)**

Run: `node --test`
Expected: `pass` ≥ 218 (215 anteriores + 3 novos deste arquivo), `fail 0`

- [ ] **Step 9: Commit**

```bash
git add src/routes/dashboards/cockpit.ts tests/cockpitResolver.test.mjs
git commit -m "feat: item_key estável + filtro de resolvidos + rota POST /resolver no Cockpit"
```

---

### Task 3: Frontend — botão "Resolver" em cada linha do Cockpit

**Files:**
- Modify: `public/app.js:3902-3938` (função `row()` e os 4 blocos `.map()` que a chamam dentro de `dashCockpit`)

**Interfaces:**
- Consumes: `POST /api/dashboards/cockpit/resolver` (Task 2) via `api('/api/dashboards/cockpit/resolver', { method: 'POST', body: JSON.stringify({ item_key }) })`; `item_key` já vem em cada item de `d.prazos`, `d.intimacoes.itens`, `d.alertas.itens`, `d.agenda_hoje` (Task 2).
- Produces: nenhuma interface nova para outras tasks — esta é a última task do plano.

- [ ] **Step 1: Adicionar o parâmetro `itemKey` e o botão de resolver em `row()`**

Em `public/app.js`, substitua a função `row` (linha 3902-3905):

```javascript
  const row = (esquerda, direita, route, sub) =>
    `<div class="mini-row" ${go(route)} style="padding:10px 16px;border-bottom:1px solid var(--border-soft)">
      <span>${esquerda}${sub ? `<br><small style="color:var(--text-muted)">${sub}</small>` : ''}</span>
      <span style="white-space:nowrap">${direita}</span></div>`;
```

por:

```javascript
  // itemKey (opcional): quando presente, adiciona um botão "Resolver" que
  // marca o item como tratado (POST /resolver) e some a linha da tela na
  // hora — sem esperar reload. stopPropagation evita que o clique no botão
  // também dispare a navegação (${go(route)}) da linha inteira.
  const row = (esquerda, direita, route, sub, itemKey) =>
    `<div class="mini-row" ${go(route)} style="padding:10px 16px;border-bottom:1px solid var(--border-soft);display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span style="flex:1;min-width:0">${esquerda}${sub ? `<br><small style="color:var(--text-muted)">${sub}</small>` : ''}</span>
      <span style="white-space:nowrap;display:flex;align-items:center;gap:8px">${direita}${itemKey ? `<button type="button" class="btn-icon btn-icon-sm" data-resolver="${esc(itemKey)}" title="Marcar como resolvido" onclick="event.stopPropagation()">${svgIcon('check', 'ic-xs')}</button>` : ''}</span></div>`;
```

- [ ] **Step 2: Passar `item_key` nos 4 blocos que chamam `row()`**

Substitua o bloco `prazosHtml` (linha 3907-3914):

```javascript
  // Prazos críticos (72h)
  const prazosHtml = (d.prazos || []).map((p) => {
    const venc = Number(p.vencido) === 1;
    const dias = venc ? 'VENCIDO' : (p.days_remaining <= 0 ? 'hoje' : `${p.days_remaining}d`);
    const cor = venc ? 'var(--red)' : (p.days_remaining <= 1 ? 'var(--amber)' : 'var(--text-muted)');
    return row(esc(p.description || 'Prazo'), `<strong style="color:${cor}">${dias}</strong>`, 'prazos',
      `${esc(p.client_name || '')}${p.case_number ? ' · ' + esc(p.case_number) : ''} · ${fmtDate(p.deadline_date)}`, p.item_key);
  }).join('');
```

Substitua o bloco `intimHtml` (linha 3916-3923):

```javascript
  // Intimações a confirmar
  const intim = d.intimacoes || { count: 0, itens: [] };
  const intimHtml = (intim.itens || []).map((i) =>
    row(esc(i.client_name || 'A vincular'),
        `<span class="badge">${esc(i.suggested_type || '—')}</span>${Number(i.tem_minuta) === 1 ? ' ' + svgIcon('edit', 'ic-xs') : ''}`,
        'prazos',
        `${i.process_number ? 'proc. ' + esc(i.process_number) + ' · ' : ''}movimentação ${fmtDate(i.movement_date || i.start_date)}`, i.item_key)
  ).join('');
```

Substitua o bloco `alHtml` (linha 3925-3930):

```javascript
  // Alertas (verificar)
  const al = d.alertas || { count: 0, itens: [] };
  const alHtml = (al.itens || []).map((a) =>
    row(esc(a.title || a.detected_keyword || 'Movimentação'), `<span class="badge">verificar</span>`, 'monitor',
        a.process_number ? 'proc. ' + esc(a.process_number) : '', a.item_key)
  ).join('');
```

Substitua o bloco `agHtml` (linha 3932-3938):

```javascript
  // Agenda de hoje
  const agHtml = (d.agenda_hoje || []).map((e) =>
    row(esc(e.title || 'Evento'),
        `<strong>${new Date(e.start_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>`,
        'agenda',
        `${esc(e.event_type || '')}${e.client_name ? ' · ' + esc(e.client_name) : ''}`, e.item_key)
  ).join('');
```

- [ ] **Step 3: Ligar o handler de clique do botão "Resolver" ao final de `dashCockpit`**

Encontre o final da função `dashCockpit` (o `c.innerHTML = ...` seguido do fechamento `}` da função, por volta da linha 3940-3948) e, logo depois da atribuição de `c.innerHTML`, adicione:

```javascript
  c.querySelectorAll('[data-resolver]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const itemKey = btn.dataset.resolver;
      btn.disabled = true;
      try {
        await api('/api/dashboards/cockpit/resolver', { method: 'POST', body: JSON.stringify({ item_key: itemKey }) });
        btn.closest('.mini-row').remove();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    };
  });
```

O resultado final da função (do `c.innerHTML` até o fechamento) deve ficar:

```javascript
  c.innerHTML = `
    ${kpis}
    <div class="cockpit-panels">
      ${painel(`${svgIcon('clock', 'ic-t')}Prazos críticos (72h)`, (d.prazos || []).length, 'prazos', prazosHtml, 'Nenhum prazo crítico. 👏')}
      ${painel(`${svgIcon('file', 'ic-t')}Intimações a confirmar`, intim.count, 'prazos', intimHtml, 'Nada a confirmar.')}
      ${painel(`${svgIcon('alert', 'ic-t')}Movimentações a verificar`, al.count, 'monitor', alHtml, 'Sem alertas pendentes.')}
      ${painel(`${svgIcon('calendar', 'ic-t')}Agenda de hoje`, (d.agenda_hoje || []).length, 'agenda', agHtml, 'Nada agendado para hoje.')}
    </div>`;

  c.querySelectorAll('[data-resolver]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const itemKey = btn.dataset.resolver;
      btn.disabled = true;
      try {
        await api('/api/dashboards/cockpit/resolver', { method: 'POST', body: JSON.stringify({ item_key: itemKey }) });
        btn.closest('.mini-row').remove();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    };
  });
}
```

- [ ] **Step 4: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem erros (comando não imprime nada em caso de sucesso)

- [ ] **Step 5: Rodar a suíte completa (garantir que a mudança de frontend não quebrou nada em backend)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc --noEmit && node --test`
Expected: `tsc` sem erros; `node --test` com `pass` ≥ 218, `fail 0`

- [ ] **Step 6: Checklist visual manual (sem testes automatizados de frontend no projeto)**

No navegador, logado como staff/admin, na tela Dashboard → aba Cockpit:
- [ ] Cada linha de Prazos/Intimações/Alertas/Agenda mostra um ícone de check ao lado, sem quebrar o layout.
- [ ] Clicar no ícone de check remove só aquela linha, sem navegar para outra tela (o `stopPropagation` funcionou).
- [ ] O contador `(N)` do painel diminui em 1 depois da remoção (recarregar a página confirma: o item não volta a aparecer).
- [ ] Clicar no corpo da linha (fora do botão) continua navegando para a tela relacionada, como antes.

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: botão Resolver em cada linha do Cockpit, some da tela na hora"
```

---

## Self-Review (checklist do autor do plano, já verificado)

1. **Cobertura da spec**: Decisão 1 (estender tela existente) → toda a Task 3 opera em `dashCockpit`, não cria tela nova. Decisão 2 (item_key) → Task 2 Step 3. Decisão 3 (tabela) → Task 1. Decisão 4 (expiração à meia-noite BR) → função `resolvidosHoje` na Task 2 Step 3. Decisão 5 (botão aditivo + remoção otimista) → Task 3 Steps 1-3. Decisão 6 (contagem reflete não-resolvidos) → Task 2 Step 3 (filtro acontece antes do `.length` usado no `res.json`).
2. **Placeholders**: nenhum "TBD"/"adicionar validação" sem código — todo step tem o código completo a escrever.
3. **Consistência de tipos**: `item_key` é `string` em todo lugar (coluna SQL `VARCHAR(64)`, campo JS `item_key`, parâmetro `itemKey` no handler do botão, atributo `data-resolver`). Formato `{dominio}:{id}` idêntico em spec, migration (implícito, é `VARCHAR`), regex de validação (`ITEM_KEY_RE`) e nos 4 `.map()` do frontend.
