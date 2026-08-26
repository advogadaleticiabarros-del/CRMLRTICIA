# Cronômetro de tempo de primeira resposta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada card do Kanban de Leads mostra um badge de tempo — quanto tempo o lead está esperando a primeira resposta (verde/âmbar/vermelho) ou quanto tempo levou até ser respondido (cinza).

**Architecture:** Novo campo `leads.first_response_at`, preenchido por `COALESCE(first_response_at, NOW())` em dois pontos de escrita já existentes (mudança de status saindo de `triagem`, e um novo endpoint chamado pelo clique em "Chamar no WhatsApp") — nunca sobrescrito. O frontend calcula o badge em JavaScript puro a partir de `created_at`/`first_response_at`, sem endpoint agregado novo.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM) no backend; vanilla JS sem build step no frontend (`public/app.js`); testes com `node --test` (arquivos `tests/*.test.mjs`, integração real contra banco, sem HTTP/supertest — ver `tests/cashflowRepasses.test.mjs` como referência de estilo).

## Global Constraints

- Campo novo: `leads.first_response_at DATETIME NULL`, migration `103_leads_first_response.sql`.
- `first_response_at` nunca é sobrescrito uma vez preenchido — toda escrita usa `COALESCE(first_response_at, NOW())`.
- Autenticação da rota nova: `authenticate, requireStaff` — mesmo middleware já aplicado a `/api/leads` em `src/app.ts:167`.
- Nenhum novo `event_type` em `journey_log` — decisão explícita do spec.
- Faixas de cor do badge (enquanto `first_response_at IS NULL`): verde `≤ 1h`, âmbar `1h–4h`, vermelho `> 4h`. Depois de preenchido: cinza neutro, mostrando o tempo até a resposta.
- Sem `setInterval` — o badge recalcula a cada `load()` do board (já disparado ao trocar de aba/mover card).
- Sem testes automatizados de frontend — validado com `node --check public/app.js` + checklist visual manual.
- Toda task de backend valida com `npx tsc --noEmit` (zero erros) e `node --test` (baseline: 222 testes, 218 pass, 0 fail, 4 skipped — sem regressão).

---

### Task 1: Backend — campo `first_response_at` + 2 pontos de escrita

**Files:**
- Create: `migrations/103_leads_first_response.sql`
- Modify: `src/routes/leads.ts:35-55` (`GET /board`, adicionar coluna ao SELECT)
- Modify: `src/routes/leads.ts:235-262` (`PATCH /:id/status`, adicionar cláusula ao UPDATE)
- Modify: `src/routes/leads.ts` (nova rota `POST /:id/mark-response`, logo após o handler de `PATCH /:id/status`)
- Test: criar `tests/leadsFirstResponse.test.mjs`

**Interfaces:**
- Produces: coluna `leads.first_response_at DATETIME NULL`; `GET /api/leads/board` passa a incluir `first_response_at` em cada lead retornado; `POST /api/leads/:id/mark-response` (body vazio, resposta `{ success: true, id, first_response_at }`) marca a resposta sem mudar `status`. Task 2 (frontend) consome ambos.

- [ ] **Step 1: Criar a migration**

Crie `migrations/103_leads_first_response.sql`:

```sql
-- ============================================================
-- Migration 103 — Cronômetro de tempo de primeira resposta do lead
-- Marca quando um lead recebeu a primeira resposta real do escritório
-- (saiu de "triagem" OU alguém clicou em "Chamar no WhatsApp" nele —
-- o que ocorrer primeiro). Mesmo padrão de leads.analise_since
-- (migration 009): campo simples, setado uma vez, nunca resetado.
-- ============================================================

ALTER TABLE leads ADD COLUMN first_response_at DATETIME NULL;
```

- [ ] **Step 2: Rodar a auditoria de schema (deve continuar passando)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test tests/dashboards.test.mjs`
Expected: `pass 4`, `fail 0`

- [ ] **Step 3: Escrever o teste (falha primeiro — os 2 pontos de escrita ainda não existem)**

Crie `tests/leadsFirstResponse.test.mjs`:

```javascript
// tests/leadsFirstResponse.test.mjs
// Cronômetro de tempo de primeira resposta: leads.first_response_at é
// setado por 2 caminhos independentes (sair de 'triagem' via PATCH
// /:id/status, ou POST /:id/mark-response a partir do clique em "Chamar
// no WhatsApp") e nunca sobrescrito depois de preenchido. Ver
// docs/superpowers/specs/2026-08-25-cronometro-primeira-resposta-lead.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('sair de triagem seta first_response_at; permanecer em triagem não seta', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Cronômetro', '27999990000', 'site', 'triagem')`,
      [userId]
    );
    insertedIds.push(lead.insertId);

    const [antes] = await db.query('SELECT first_response_at FROM leads WHERE id = ?', [lead.insertId]);
    assert.strictEqual(antes[0].first_response_at, null, 'lead recém-criado não deveria ter first_response_at');

    // Sair de triagem → deve setar.
    const prev = { status: 'triagem' };
    const status = 'atendimento_inicial';
    const primeiraRespostaSql = (prev.status === 'triagem' && status !== 'triagem')
      ? ', first_response_at = COALESCE(first_response_at, NOW())' : '';
    await db.query(`UPDATE leads SET status = ?${primeiraRespostaSql} WHERE id = ?`, [status, lead.insertId]);

    const [depois] = await db.query('SELECT first_response_at, status FROM leads WHERE id = ?', [lead.insertId]);
    assert.strictEqual(depois[0].status, 'atendimento_inicial');
    assert.ok(depois[0].first_response_at, 'first_response_at deveria estar preenchido após sair de triagem');

    const primeiroTimestamp = depois[0].first_response_at;

    // Mudar de novo (atendimento_inicial → reuniao) NÃO deve sobrescrever
    // (a condição só dispara saindo de 'triagem').
    const prev2 = { status: 'atendimento_inicial' };
    const status2 = 'reuniao';
    const sql2 = (prev2.status === 'triagem' && status2 !== 'triagem')
      ? ', first_response_at = COALESCE(first_response_at, NOW())' : '';
    await db.query(`UPDATE leads SET status = ?${sql2} WHERE id = ?`, [status2, lead.insertId]);

    const [final] = await db.query('SELECT first_response_at FROM leads WHERE id = ?', [lead.insertId]);
    assert.deepStrictEqual(final[0].first_response_at, primeiroTimestamp, 'first_response_at não deveria mudar em transições subsequentes');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});

test('POST /:id/mark-response (query direta) seta first_response_at e não sobrescreve em 2ª chamada', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste WhatsApp', '27999990001', 'site', 'triagem')`,
      [userId]
    );
    insertedIds.push(lead.insertId);

    // Mesma query que a rota POST /:id/mark-response executa.
    await db.query('UPDATE leads SET first_response_at = COALESCE(first_response_at, NOW()) WHERE id = ?', [lead.insertId]);
    const [rows1] = await db.query('SELECT first_response_at, status FROM leads WHERE id = ?', [lead.insertId]);
    assert.ok(rows1[0].first_response_at, 'first_response_at deveria estar preenchido após mark-response');
    assert.strictEqual(rows1[0].status, 'triagem', 'mark-response não deve alterar o status do lead');

    const primeiroTimestamp = rows1[0].first_response_at;
    await new Promise((r) => setTimeout(r, 1100)); // garante NOW() diferente se sobrescrevesse
    await db.query('UPDATE leads SET first_response_at = COALESCE(first_response_at, NOW()) WHERE id = ?', [lead.insertId]);
    const [rows2] = await db.query('SELECT first_response_at FROM leads WHERE id = ?', [lead.insertId]);
    assert.deepStrictEqual(rows2[0].first_response_at, primeiroTimestamp, 'segunda chamada não deveria sobrescrever first_response_at');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
```

- [ ] **Step 4: Rodar o teste para confirmar que passa (a lógica testada é a query, que ainda não está no handler real — isso confirma a query em si antes de integrá-la)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc && node --test tests/leadsFirstResponse.test.mjs`
Expected: `pass 2`, `fail 0` (ou `t.skip` com mensagem clara de ambiente sem banco/usuário — aceitável neste ambiente, documente no relatório da task).

- [ ] **Step 5: Implementar as mudanças em `src/routes/leads.ts`**

Releia o handler `GET /board` atual (linhas 35-55) e substitua a query `SELECT` por (adicionando `first_response_at` à lista de colunas):

```typescript
router.get('/board', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT id, name, email, phone, source, legal_area, status, created_at, analise_since, first_response_at,
            estimated_value, close_probability, next_followup
     FROM leads
     WHERE user_id = ? AND status IN (${placeholders})
     ORDER BY created_at DESC`,
    [userId, ...ACTIVE_STATUSES]
  ) as any;

  const board: Record<string, any[]> = {};
  for (const s of ACTIVE_STATUSES) board[s] = [];
  for (const lead of rows) {
    (board[lead.status] ??= []).push(lead);
  }

  res.json(board);
});
```

Releia o handler `PATCH /:id/status` atual (linhas 235-262) e substitua por:

```typescript
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` });
    return;
  }

  const [prevRows] = await db.query('SELECT status, client_id FROM leads WHERE id = ?', [id]) as any;
  if (!prevRows.length) { res.status(404).json({ error: 'Lead não encontrado' }); return; }
  const prev = prevRows[0];

  // Marca o início da análise (regra dos 7 dias). Limpa ao sair da análise.
  const analiseSql = status === 'proposta_em_analise'
    ? ', analise_since = NOW()'
    : ', analise_since = NULL';

  // Cronômetro de primeira resposta: sair de 'triagem' pela 1ª vez é um
  // dos 2 sinais que marcam "o escritório respondeu" (o outro é o botão
  // de WhatsApp — ver POST /:id/mark-response). COALESCE garante que só
  // a PRIMEIRA transição conta — mudanças de estágio subsequentes não
  // reiniciam o cronômetro.
  const primeiraRespostaSql = (prev.status === 'triagem' && status !== 'triagem')
    ? ', first_response_at = COALESCE(first_response_at, NOW())'
    : '';

  await db.query(`UPDATE leads SET status = ?${analiseSql}${primeiraRespostaSql} WHERE id = ?`, [status, id]);

  await logActivity({
    leadId: Number(id), clientId: prev.client_id, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_stage_changed', title: 'Etapa do funil alterada',
    oldValue: STATUS_PT[prev.status] || prev.status, newValue: STATUS_PT[status] || status,
  });

  res.json({ success: true, id: Number(id), status });
});

// ── POST /api/leads/:id/mark-response — marca a 1ª resposta ao lead ────────
// Segundo sinal do cronômetro (o primeiro é sair de 'triagem', acima):
// chamado pelo frontend quando a usuária clica em "Chamar no WhatsApp" no
// card do lead. Não muda status, não gera journey_log — a informação em
// si (first_response_at) já é exibida direto no card do Kanban.
router.post('/:id/mark-response', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [r] = await db.query(
    'UPDATE leads SET first_response_at = COALESCE(first_response_at, NOW()) WHERE id = ?', [id]
  ) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Lead não encontrado' }); return; }
  const [rows] = await db.query('SELECT first_response_at FROM leads WHERE id = ?', [id]) as any;
  res.json({ success: true, id: Number(id), first_response_at: rows[0].first_response_at });
});
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 7: Rodar a suíte completa (sem regressão)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test`
Expected: `pass` ≥ 218 (baseline), `fail 0`

- [ ] **Step 8: Commit**

```bash
git add migrations/103_leads_first_response.sql src/routes/leads.ts tests/leadsFirstResponse.test.mjs
git commit -m "feat: cronômetro de primeira resposta do lead (backend)"
```

---

### Task 2: Frontend — badge de tempo no card do Kanban + handler do WhatsApp

**Files:**
- Modify: `public/app.js:1009-1044` (função `leads(page)`, dentro de `ROUTES` — o card do Kanban)
- Modify: `public/app.js:5701-5715` (handler `waCrmBtn.onclick` dentro de `leadDetail`)

**Interfaces:**
- Consumes: `GET /api/leads/board` (Task 1) — cada lead agora tem `first_response_at` (string ISO ou `null`) além de `created_at`. `POST /api/leads/:id/mark-response` (Task 1).
- Produces: nenhuma interface nova para outras tasks — esta é a última task deste plano.

- [ ] **Step 1: Adicionar a função de cálculo do badge**

Releia a função `leads(page)` completa (linhas 1009-1044 do arquivo original — confirme contra o arquivo real antes de editar, já que a Task 1 não tocou `public/app.js`, então os números não devem ter deslocado). Logo antes de `async leads(page) {` (ou seja, como uma função auxiliar no mesmo escopo do objeto `ROUTES`, no mesmo padrão de outras funções auxiliares do arquivo), adicione:

```javascript
// Badge de tempo do cronômetro de primeira resposta do lead. Enquanto
// aguardando (first_response_at null): tempo desde created_at, cor por
// faixa (verde ≤1h, âmbar 1h-4h, vermelho >4h). Depois de respondido:
// tempo que levou até a resposta, cor neutra — vira registro histórico,
// não mais um alerta. Sem setInterval: recalcula a cada load() do board.
function leadResponseBadge(createdAt, firstResponseAt) {
  const fmt = (ms) => {
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${Math.max(min, 0)}min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };
  if (firstResponseAt) {
    const ms = new Date(firstResponseAt) - new Date(createdAt);
    return `<span class="badge-tempo badge-tempo-neutro" title="Tempo até a 1ª resposta">✓ ${fmt(ms)}</span>`;
  }
  const ms = Date.now() - new Date(createdAt);
  const horas = ms / 3600000;
  const cor = horas <= 1 ? 'verde' : horas <= 4 ? 'ambar' : 'vermelho';
  return `<span class="badge-tempo badge-tempo-${cor}" title="Aguardando 1ª resposta">há ${fmt(ms)}</span>`;
}
```

- [ ] **Step 2: Usar o badge no card do Kanban**

Substitua a linha do card (linha 1019-1020 do arquivo original):

```javascript
        ${(b[k] || []).map((l) => `<div class="kanban-card" draggable="true" data-lead="${l.id}" data-stage="${k}">
          <strong>${esc(l.name)}</strong><small>${l.legal_area || ''} · ${l.source || ''}</small></div>`).join('')}</div>`).join('');
```

por:

```javascript
        ${(b[k] || []).map((l) => `<div class="kanban-card" draggable="true" data-lead="${l.id}" data-stage="${k}">
          <strong>${esc(l.name)}</strong><small>${l.legal_area || ''} · ${l.source || ''}</small>
          ${leadResponseBadge(l.created_at, l.first_response_at)}</div>`).join('')}</div>`).join('');
```

- [ ] **Step 3: Adicionar o CSS das 4 variantes de cor do badge**

Em `public/styles.css`, adicione (em qualquer ponto do arquivo — não há uma seção "Kanban de leads" pré-existente a localizar; adicione ao final do arquivo):

```css
/* Badge de tempo do cronômetro de primeira resposta do lead (Kanban) */
.badge-tempo { display: inline-block; margin-top: 4px; padding: 2px 7px; border-radius: 8px; font-size: 11px; font-weight: 600; }
.badge-tempo-verde { background: var(--green-bg, #e7f4ec); color: var(--green, #2f8f63); }
.badge-tempo-ambar { background: var(--amber-bg, #fbf1dc); color: var(--amber, #c08a2e); }
.badge-tempo-vermelho { background: var(--red-bg, #fbe9e7); color: var(--red, #c4453b); }
.badge-tempo-neutro { background: var(--surface-2, #f4f1ea); color: var(--text-muted, #7c7360); }
```

- [ ] **Step 4: Chamar `mark-response` no clique do botão "Chamar no WhatsApp"**

Releia o handler `waCrmBtn.onclick` completo (linhas 5701-5715 do arquivo original) e substitua por:

```javascript
  const waCrmBtn = form.querySelector('#wa-crm-lead');
  if (waCrmBtn) waCrmBtn.onclick = () => {
    let digits = String(l.phone).replace(/\D/g, '');
    if (digits.length <= 11) digits = '55' + digits; // sem DDI — assume Brasil
    const primeiroNome = (l.name || '').trim().split(' ')[0] || '';
    // Tira as tags de origem/rastreio ([LP-v3 ...] [Origem: ...] [Triagem: ...]
    // [Ciente: ...]) que o formulário do site grava junto — só interessam
    // internamente, não fazem sentido numa mensagem pro cliente.
    const resumo = (l.case_summary || '').replace(/\[[^\]]*\]/g, '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
    // *asterisco* é a sintaxe de negrito do WhatsApp (não é markdown **).
    const texto = `Olá${primeiroNome ? ', ' + primeiroNome : ''}! Recebemos seu contato${resumo ? ` — resumo: "${resumo.slice(0, 300)}"` : ''}. *Em instantes vamos iniciar o seu atendimento, já pode separar os documentos do seu caso.*`;
    // Fire-and-forget: marca a 1ª resposta do cronômetro sem esperar nem
    // bloquear a navegação — a ação principal do usuário é ir conversar
    // com o lead, a instrumentação nunca deve atrapalhar isso.
    api('/api/leads/' + id + '/mark-response', { method: 'POST', body: '{}' }).catch(() => {});
    sessionStorage.setItem('wa_abrir_pendente', JSON.stringify({ phone: digits, nome: l.name, texto }));
    closeModal();
    location.hash = '#whatsapp';
  };
```

- [ ] **Step 5: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem erros (comando não imprime nada em caso de sucesso)

- [ ] **Step 6: Rodar a suíte completa (garantir que a mudança de frontend não quebrou nada em backend)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc --noEmit && node --test`
Expected: `tsc` sem erros; `node --test` com `pass` ≥ 218, `fail 0`

- [ ] **Step 7: Checklist visual manual (sem testes automatizados de frontend no projeto)**

No navegador, logado como staff/admin, na tela Leads:
- [ ] Cada card do Kanban mostra um badge de tempo abaixo do nome/área/origem.
- [ ] Um lead recém-criado em "Novo Lead" (triagem) mostra badge verde "há Xmin".
- [ ] Mover um card de "Novo Lead" para outra coluna faz o badge mudar para cinza com "✓ Xmin/Xh" (tempo até a resposta) — recarregue a tela pra confirmar (não há atualização em tempo real sem reload, por design).
- [ ] Abrir o detalhe de um lead ainda em "Novo Lead" e clicar em "Chamar no WhatsApp" também marca a resposta — recarregar o board depois mostra o badge cinza, mesmo sem ter movido o card manualmente.
- [ ] Clicar em "Chamar no WhatsApp" continua navegando para a tela de WhatsApp normalmente, sem atraso perceptível.

- [ ] **Step 8: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: badge de tempo de primeira resposta no card do Kanban de leads"
```

---

## Self-Review (checklist do autor do plano, já verificado)

1. **Cobertura da spec**: Decisão 1 (2 sinais) → Task 1 Step 5 (ambos os pontos de escrita). Decisão 2 (campo + COALESCE) → Task 1 Step 1/5. Decisão 3 (2 pontos de escrita exatos) → Task 1 Step 5. Decisão 4 (sem journey_log novo) → confirmado por omissão deliberada no código do Step 5 (nenhum `logActivity` na rota `mark-response`). Decisão 5 (badge com cores, SELECT no board, handler do WhatsApp) → Task 2 Steps 1-4.
2. **Placeholders**: nenhum "TBD"/"adicionar validação" sem código — todo step tem o código completo a escrever.
3. **Consistência de tipos**: `first_response_at` é sempre `DATETIME`/string ISO ou `null`, em todos os lugares (coluna SQL, resposta JSON de `GET /board` e `POST /mark-response`, parâmetro `firstResponseAt` de `leadResponseBadge`). Nome da função (`leadResponseBadge`) e seu uso no card batem exatamente.
