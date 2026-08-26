# Motivo de perda estruturado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar um lead como "Perdida" passa a exigir um motivo escolhido de uma lista fixa (não mais texto livre opcional), e o dashboard comercial mostra a quebra de perdidos por motivo.

**Architecture:** `leads.loss_reason` (já existe, `VARCHAR(255) NULL`) passa a ser validado contra `LOSS_REASONS` (array fixo, backend) antes de qualquer transição pra `status='perdida'` em `PATCH /api/leads/:id/status`. O frontend troca o `<textarea>` livre por um `<select>` com as mesmas 7 opções e unifica os 2 requests que hoje o botão "Atualizar etapa" faz em 1 só. O dashboard comercial ganha uma quebra por motivo, mesmo padrão visual já usado para "Leads por origem"/"por área".

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM) no backend; vanilla JS sem build step no frontend (`public/app.js`); testes com `node --test` (arquivos `tests/*.test.mjs`, integração real contra banco, sem HTTP/supertest).

## Global Constraints

- Sem nova migration — `leads.loss_reason` continua `VARCHAR(255) NULL`.
- `LOSS_REASONS` (backend, `src/routes/leads.ts`) = `['preco', 'sumiu', 'foi_com_outro', 'desistiu', 'fora_area_atuacao', 'sem_perfil', 'outro']` — array de chaves, sem rótulo (mesmo padrão de `AREAS` no mesmo arquivo, que também não carrega rótulo — o rótulo só existe no frontend).
- `PATCH /api/leads/:id/status` rejeita (400) `status='perdida'` sem `loss_reason` válido — validação ANTES de qualquer escrita no banco.
- Quando `status !== 'perdida'`, `loss_reason` é ignorado nessa rota (não limpo/resetado automaticamente).
- `PUT /api/leads/:id` continua aceitando `loss_reason` livre via `EXTRA_COLS` (compatibilidade de edição administrativa) — não travar essa rota.
- `motivos_perda` (dashboard comercial) não reprocessa leads perdidos com `loss_reason` livre anterior a esta mudança — ficam de fora da quebra, mas continuam contados no total geral de "perdidos" do funil.
- Sem testes automatizados de frontend — `<select>` e exibição no dashboard validados com `node --check public/app.js` + checklist visual manual.
- Toda task de backend valida com `npx tsc --noEmit` (zero erros) e `node --test` (baseline: 224 testes, 218 pass, 0 fail, 6 skipped — sem regressão).

---

### Task 1: Backend — `LOSS_REASONS` + validação obrigatória em `PATCH /:id/status`

**Files:**
- Modify: `src/routes/leads.ts:22` (adicionar `LOSS_REASONS` perto de `AREAS`)
- Modify: `src/routes/leads.ts:235-262` (handler `PATCH /:id/status`)
- Test: criar `tests/leadsLossReason.test.mjs`

**Interfaces:**
- Produces: `PATCH /api/leads/:id/status` aceita `{ status: string, loss_reason?: string }` no body. Responde `400 { error }` se `status === 'perdida'` e `loss_reason` ausente/inválido. Em sucesso, grava `loss_reason` no mesmo `UPDATE` que já muda `status`. Task 3 (frontend) e a leitura de `Task 2` (dashboard) dependem de `LOSS_REASONS` conter exatamente essas 7 chaves, nesta ordem.

- [ ] **Step 1: Escrever o teste (falha primeiro — a validação ainda não existe)**

Crie `tests/leadsLossReason.test.mjs`:

```javascript
// tests/leadsLossReason.test.mjs
// Motivo de perda estruturado: marcar um lead como 'perdida' sem um
// loss_reason válido (das 7 chaves fixas) deve ser rejeitado ANTES de
// qualquer escrita no banco. Ver
// docs/superpowers/specs/2026-08-25-motivo-perda-estruturado-lead.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');

const LOSS_REASONS = ['preco', 'sumiu', 'foi_com_outro', 'desistiu', 'fora_area_atuacao', 'sem_perfil', 'outro'];

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

// Reproduz a validação exata do handler PATCH /:id/status (sem HTTP —
// mesmo padrão de tests/leadsFirstResponse.test.mjs desta mesma sessão).
function validarTransicaoPerdida(status, lossReason) {
  if (status === 'perdida' && !LOSS_REASONS.includes(lossReason)) {
    return { valido: false, erro: `loss_reason é obrigatório e deve ser um de: ${LOSS_REASONS.join(', ')}` };
  }
  return { valido: true };
}

test('status=perdida sem loss_reason válido é rejeitado antes de qualquer escrita', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const [lead] = await db.query(
      `INSERT INTO leads (user_id, name, phone, source, status) VALUES (?, 'Lead Teste Perda', '27999990002', 'site', 'triagem')`,
      [userId]
    );
    insertedIds.push(lead.insertId);

    // loss_reason ausente — rejeitado.
    const r1 = validarTransicaoPerdida('perdida', undefined);
    assert.strictEqual(r1.valido, false, 'sem loss_reason deveria ser inválido');

    // loss_reason fora da lista fixa — rejeitado.
    const r2 = validarTransicaoPerdida('perdida', 'texto livre qualquer');
    assert.strictEqual(r2.valido, false, 'loss_reason fora da lista deveria ser inválido');

    // loss_reason válido — aceito, e a escrita real reflete corretamente.
    const r3 = validarTransicaoPerdida('perdida', 'foi_com_outro');
    assert.strictEqual(r3.valido, true, 'loss_reason válido deveria ser aceito');
    await db.query(`UPDATE leads SET status = 'perdida', loss_reason = 'foi_com_outro' WHERE id = ?`, [lead.insertId]);
    const [rows] = await db.query('SELECT status, loss_reason FROM leads WHERE id = ?', [lead.insertId]);
    assert.strictEqual(rows[0].status, 'perdida');
    assert.strictEqual(rows[0].loss_reason, 'foi_com_outro');

    // Mudar pra status diferente de 'perdida' não exige loss_reason.
    const r4 = validarTransicaoPerdida('atendimento_inicial', undefined);
    assert.strictEqual(r4.valido, true, 'transição para status diferente de perdida não deveria exigir loss_reason');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
```

- [ ] **Step 2: Rodar o teste para confirmar que passa (a validação testada aqui é a função pura — confirma a lógica antes de integrá-la ao handler real)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc && node --test tests/leadsLossReason.test.mjs`
Expected: `pass 1`, `fail 0` (ou `t.skip` por falta de usuário no banco local — aceitável, documente no relatório).

- [ ] **Step 3: Adicionar `LOSS_REASONS` ao arquivo**

Releia a linha 22 atual (`const AREAS = [...]`) e adicione logo abaixo:

```typescript
const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
const LOSS_REASONS = ['preco', 'sumiu', 'foi_com_outro', 'desistiu', 'fora_area_atuacao', 'sem_perfil', 'outro'];
```

- [ ] **Step 4: Validar `loss_reason` no handler `PATCH /:id/status`**

Releia o handler completo (linhas 235-262) e substitua por:

```typescript
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, loss_reason } = req.body;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` });
    return;
  }

  // Motivo de perda estruturado: marcar como 'perdida' exige um motivo
  // de uma lista fixa — antes disso o campo era texto livre opcional,
  // então nada impedia a advogada de perder o lead sem nunca registrar
  // por quê. Validado ANTES de qualquer escrita no banco.
  if (status === 'perdida' && !LOSS_REASONS.includes(loss_reason)) {
    res.status(400).json({ error: `loss_reason é obrigatório e deve ser um de: ${LOSS_REASONS.join(', ')}` });
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

  // loss_reason só é gravado quando o novo status é 'perdida' (já
  // validado acima) — em qualquer outra transição, o campo é ignorado
  // nesta rota (não é limpo/resetado; um lead reaberto mantém o motivo
  // anterior registrado como histórico até ser perdido de novo).
  const lossReasonSql = status === 'perdida' ? ', loss_reason = ?' : '';
  const params = status === 'perdida' ? [status, loss_reason, id] : [status, id];

  await db.query(`UPDATE leads SET status = ?${analiseSql}${primeiraRespostaSql}${lossReasonSql} WHERE id = ?`, params);

  await logActivity({
    leadId: Number(id), clientId: prev.client_id, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_stage_changed', title: 'Etapa do funil alterada',
    oldValue: STATUS_PT[prev.status] || prev.status, newValue: STATUS_PT[status] || status,
  });

  res.json({ success: true, id: Number(id), status });
});
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Rodar a suíte completa (sem regressão)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test`
Expected: `pass` ≥ 218, `fail 0`

- [ ] **Step 7: Commit**

```bash
git add src/routes/leads.ts tests/leadsLossReason.test.mjs
git commit -m "feat: motivo de perda estruturado (validação obrigatória no backend)"
```

---

### Task 2: Backend — quebra de perdidos por motivo no dashboard comercial

**Files:**
- Modify: `src/routes/dashboards/comercial.ts` (rota principal, próximo à query `leadsPorStatus` e ao `res.json` final)
- Test: criar `tests/comercialMotivosPerda.test.mjs`

**Interfaces:**
- Consumes: `LOSS_REASONS` (Task 1) — não precisa importar, só precisa saber que as chaves gravadas em `leads.loss_reason` batem com essa lista para leads perdidos a partir de agora.
- Produces: `GET /api/dashboards/comercial` responde com um campo novo `motivos_perda: [{ motivo: string, total: number }]`, ordenado por `total` decrescente. Task 3 (frontend) consome esse array.

- [ ] **Step 1: Escrever o teste (falha primeiro — o campo ainda não existe na resposta)**

Crie `tests/comercialMotivosPerda.test.mjs`:

```javascript
// tests/comercialMotivosPerda.test.mjs
// Dashboard comercial ganha uma quebra de leads perdidos por motivo —
// mesmo filtro user_id das outras queries dessa rota (nenhuma delas
// filtra por período). Ver
// docs/superpowers/specs/2026-08-25-motivo-perda-estruturado-lead.md
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

test('query de motivos_perda agrupa corretamente por loss_reason, ignora vazios/nulos', async (t) => {
  let userId;
  const insertedIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const leadsParaCriar = [
      { name: 'Perda Preço 1', loss_reason: 'preco' },
      { name: 'Perda Preço 2', loss_reason: 'preco' },
      { name: 'Perda Sumiu', loss_reason: 'sumiu' },
      { name: 'Perda Sem Motivo', loss_reason: null }, // deve ser ignorado
      { name: 'Não Perdido', loss_reason: null, status: 'triagem' }, // não é 'perdida', deve ser ignorado
    ];
    for (const l of leadsParaCriar) {
      const [r] = await db.query(
        `INSERT INTO leads (user_id, name, phone, source, status, loss_reason) VALUES (?, ?, '27999990003', 'site', ?, ?)`,
        [userId, l.name, l.status || 'perdida', l.loss_reason]
      );
      insertedIds.push(r.insertId);
    }

    // Mesma query que a Task 2 adiciona à rota.
    const [rows] = await db.query(
      `SELECT loss_reason, COUNT(*) AS total FROM leads
        WHERE user_id = ? AND status = 'perdida' AND loss_reason IS NOT NULL AND loss_reason <> ''
        GROUP BY loss_reason ORDER BY total DESC`,
      [userId]
    );

    const porMotivo = Object.fromEntries(rows.map((r) => [r.loss_reason, Number(r.total)]));
    assert.ok(porMotivo.preco >= 2, `esperava pelo menos 2 leads com motivo 'preco', achei ${porMotivo.preco}`);
    assert.ok(porMotivo.sumiu >= 1, `esperava pelo menos 1 lead com motivo 'sumiu', achei ${porMotivo.sumiu}`);
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedIds) await db.query('DELETE FROM leads WHERE id = ?', [id]).catch(() => {});
  }
});
```

- [ ] **Step 2: Rodar o teste para confirmar que passa (a query em si já é válida contra o schema atual — este teste confirma o comportamento antes de integrá-la à rota)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc && node --test tests/comercialMotivosPerda.test.mjs`
Expected: `pass 1`, `fail 0` (ou `t.skip` por falta de usuário — aceitável).

- [ ] **Step 3: Adicionar a query e o campo na resposta**

Releia a rota principal de `src/routes/dashboards/comercial.ts` — localize a query `leadsPorStatus` (hoje `SELECT status, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY status ORDER BY total DESC`) e adicione logo depois dela:

```typescript
    const [leadsPorStatus] = await db.query(
      'SELECT status, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY status ORDER BY total DESC',
      [userId]
    ) as any;
    const funil_conversao = calcularFunilConversao(leadsPorStatus);

    const [motivosPerdaRows] = await db.query(
      `SELECT loss_reason AS motivo, COUNT(*) AS total FROM leads
        WHERE user_id = ? AND status = 'perdida' AND loss_reason IS NOT NULL AND loss_reason <> ''
        GROUP BY loss_reason ORDER BY total DESC`,
      [userId]
    ) as any;
    const motivos_perda = motivosPerdaRows.map((r: any) => ({ motivo: r.motivo, total: Number(r.total) }));
```

Localize o `res.json({...})` final dessa rota (contém `funil_conversao,` entre outros campos) e adicione `motivos_perda,` logo abaixo de `funil_conversao,`:

```typescript
    res.json({
      leads_hoje:          metrics.leads_hoje,
      leads_total:         metrics.leads_total,
      leads_por_status:    leadsPorStatus,
      funil_conversao,
      motivos_perda,
      rentabilidade_area,
      por_origem:          porOrigem,
      por_area:            porArea,
      por_campanha:        porCampanha,
      propostas_enviadas:  metrics.propostas_enviadas,
      propostas_aceitas:   metrics.propostas_aceitas,
```

(mantenha todos os campos seguintes do `res.json` exatamente como já estão no arquivo — só a linha `motivos_perda,` é inserida).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 5: Rodar a suíte completa (sem regressão)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test`
Expected: `pass` ≥ 218, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add src/routes/dashboards/comercial.ts tests/comercialMotivosPerda.test.mjs
git commit -m "feat: quebra de leads perdidos por motivo no dashboard comercial"
```

---

### Task 3: Frontend — select no modal do lead + exibição no dashboard

**Files:**
- Modify: `public/app.js:5710` (dentro de `leadDetail`, o `<div id="loss-wrap">`)
- Modify: `public/app.js:5763-5772` (dentro de `leadDetail`, o handler `#move`)
- Modify: `public/app.js` (perto de `AREAS`, linha 5591 — adicionar `LOSS_REASONS_PT`)
- Modify: `public/app.js:4016-4028` (dentro de `dashComercial`, adicionar o card de motivos de perda)

**Interfaces:**
- Consumes: `PATCH /api/leads/:id/status` (Task 1) aceita `loss_reason` no body. `GET /api/dashboards/comercial` (Task 2) retorna `motivos_perda: [{motivo, total}]`.
- Produces: nenhuma interface nova para outras tasks — esta é a última task deste plano.

- [ ] **Step 1: Adicionar `LOSS_REASONS_PT`, mesmo padrão de `AREAS`**

Releia a linha `const AREAS = [...]` (linha 5591 do arquivo original) e adicione logo abaixo:

```javascript
const AREAS = [['outro','Outro'],['trabalhista','Trabalhista'],['gestante','Gestante/Maternidade'],['familia','Família'],['civel','Cível'],['previdenciario','Previdenciário'],['consumidor','Consumidor']].map(([v,t])=>({v,t}));
const LOSS_REASONS_PT = [['preco','Achou o preço alto'],['sumiu','Parou de responder'],['foi_com_outro','Fechou com outro escritório'],['desistiu','Desistiu do processo'],['fora_area_atuacao','Fora da área de atuação'],['sem_perfil','Sem perfil pro caso'],['outro','Outro motivo']].map(([v,t])=>({v,t}));
```

- [ ] **Step 2: Trocar o `<textarea>` de motivo por `<select>` obrigatório**

Releia a linha do `#loss-wrap` (linha 5710 do arquivo original):

```javascript
    <div id="loss-wrap" style="display:none">${field('Motivo da perda', 'loss_reason', { value: l.loss_reason || '', type: 'textarea' })}</div>
```

Substitua por:

```javascript
    <div id="loss-wrap" style="display:none">${field('Motivo da perda', 'loss_reason', { value: l.loss_reason || 'outro', options: LOSS_REASONS_PT })}</div>
```

- [ ] **Step 3: Unificar os 2 requests do handler `#move` em 1 só**

Releia o handler `#move` completo (linhas 5763-5772 do arquivo original):

```javascript
  form.querySelector('#move').onclick = async () => {
    try {
      const status = statusSel.value;
      if (status === 'perdida') {
        await api('/api/leads/' + id, { method: 'PUT', body: JSON.stringify({ loss_reason: form.querySelector('[name=loss_reason]').value }) });
      }
      await api(`/api/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      closeModal(); toast('Etapa atualizada'); onSave();
    } catch (e) { toast(e.message, 'error'); }
  };
```

Substitua por:

```javascript
  form.querySelector('#move').onclick = async () => {
    try {
      const status = statusSel.value;
      const body = { status };
      if (status === 'perdida') body.loss_reason = form.querySelector('[name=loss_reason]').value;
      await api(`/api/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) });
      closeModal(); toast('Etapa atualizada'); onSave();
    } catch (e) { toast(e.message, 'error'); }
  };
```

- [ ] **Step 4: Mostrar a quebra de motivos no dashboard comercial**

Releia o trecho de `dashComercial` que monta `<div class="dash-2col">` com os 2 `chartHBars` (linhas 4025-4028 do arquivo original):

```javascript
    <div class="dash-2col">
      ${chartCard('Leads por origem', chartHBars((d.por_origem || []).map((r) => ({ label: r.origem, value: r.total }))))}
      ${chartCard('Leads por área jurídica', chartHBars((d.por_area || []).map((r) => ({ label: r.area, value: r.total }))))}
    </div>
```

Substitua por:

```javascript
    <div class="dash-2col">
      ${chartCard('Leads por origem', chartHBars((d.por_origem || []).map((r) => ({ label: r.origem, value: r.total }))))}
      ${chartCard('Leads por área jurídica', chartHBars((d.por_area || []).map((r) => ({ label: r.area, value: r.total }))))}
    </div>
    ${(d.motivos_perda || []).length ? chartCard('Motivos de perda', chartHBars((d.motivos_perda || []).map((r) => {
      const opt = LOSS_REASONS_PT.find((o) => o.v === r.motivo);
      return { label: opt ? opt.t : r.motivo, value: r.total };
    }))) : ''}
```

- [ ] **Step 5: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem erros

- [ ] **Step 6: Rodar a suíte completa (garantir que a mudança de frontend não quebrou nada em backend)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc --noEmit && node --test`
Expected: `tsc` sem erros; `node --test` com `pass` ≥ 218, `fail 0`

- [ ] **Step 7: Checklist visual manual (sem testes automatizados de frontend no projeto)**

No navegador, logado como staff/admin, na tela Leads:
- [ ] Abrir o detalhe de um lead, mudar "Mover no funil" para "Perdido" — o campo "Motivo da perda" aparece como `<select>` com as 7 opções em português, não mais uma caixa de texto livre.
- [ ] Clicar em "Atualizar etapa" sem trocar o `<select>` (fica no valor padrão) ainda envia um motivo válido — não deveria dar erro (o `<select>` sempre tem um valor selecionado).
- [ ] Mover um lead para "Perdido" e reabrir o detalhe depois — o motivo escolhido continua selecionado no `<select>`.
- [ ] Na tela Dashboard → aba Comercial, depois de perder pelo menos 1 lead com motivo estruturado, aparece um card "Motivos de perda" com barras horizontais, no mesmo estilo visual de "Leads por origem"/"Leads por área jurídica".
- [ ] Se nenhum lead tiver sido perdido com motivo estruturado ainda, o card "Motivos de perda" simplesmente não aparece (sem card vazio quebrado).

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat: select de motivo de perda + quebra no dashboard comercial (frontend)"
```

---

## Self-Review (checklist do autor do plano, já verificado)

1. **Cobertura da spec**: Decisão 1 (`LOSS_REASONS`) → Task 1 Step 3. Decisão 2 (obrigatório no PATCH) → Task 1 Step 4. Decisão 3 (select no frontend) → Task 3 Steps 1-3, incluindo a simplificação de 2 requests pra 1 (consequência direta de `loss_reason` agora viajar no mesmo `PATCH`). Decisão 4 (quebra no dashboard) → Task 2 (backend) + Task 3 Step 4 (frontend).
2. **Placeholders**: nenhum "TBD"/"adicionar validação" sem código — todo step tem o código completo a escrever.
3. **Consistência de tipos**: `LOSS_REASONS` (backend, array de strings) e `LOSS_REASONS_PT` (frontend, array de `{v,t}`) têm exatamente as mesmas 7 chaves, na mesma ordem, em ambos os arquivos — checado manualmente linha a linha ao escrever os Steps 3/1 das Tasks 1/3. `motivos_perda[].motivo` (backend) e `r.motivo` (frontend, Task 3 Step 4) usam o mesmo nome de campo.
