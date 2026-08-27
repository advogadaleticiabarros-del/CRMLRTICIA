# Excluir contrato de teste (com motivo e reversão financeira) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir excluir um contrato de teste pela tela de Contratos, com motivo obrigatório, apagando junto o caso na esteira de produção e qualquer parcela/lançamento financeiro pendente vinculado — bloqueando a exclusão se houver dinheiro já recebido.

**Architecture:** Nova rota `DELETE /api/contracts/:id` em `src/routes/contracts.ts`, dentro de uma transação: identifica os casos vinculados ao mesmo cliente/lead do contrato, verifica se há parcela/lançamento pago (bloqueia se houver), registra o motivo na timeline do cliente, apaga parcelas/lançamentos pendentes, apaga os casos, apaga o contrato. No frontend, botão "Excluir" na lista de Contratos (`public/app.js`) abre um formulário pedindo o motivo.

**Tech Stack:** Node.js/Express/TypeScript, MySQL (mysql2/promise), frontend vanilla JS (`public/app.js`), testes com `node --test`.

## Global Constraints

- Toda query usa parâmetros posicionais (`?`) — nunca concatenar valor de usuário direto na string SQL.
- Motivo é obrigatório (mínimo 5 caracteres) — sem ele, a exclusão é recusada com HTTP 400.
- Se houver qualquer `installments.status = 'pago'` ou `financial_records.status = 'pago'` vinculado aos casos identificados, a exclusão é recusada com HTTP 409 — nenhuma exclusão parcial acontece (tudo dentro de uma transação, rollback em caso de bloqueio).
- O motivo precisa ficar registrado em `client_timeline` **antes** do `DELETE` do contrato, para sobreviver à exclusão (a tabela não tem FK obrigatória em `contract_id`/`case_id`, só em `client_id`, que não é afetado).
- Não altera a `proposta` de origem além de deixar de referenciar o caso apagado (sem cascata adicional).

---

### Task 1: Backend — rota `DELETE /api/contracts/:id`

**Files:**
- Modify: `src/routes/contracts.ts`
- Test: `tests/contractsDeleteComMotivo.test.mjs`

**Interfaces:**
- Consumes: `logTimeline` (já importado em `contracts.ts:4`, assinatura `logTimeline({ clientId, caseId?, contractId?, eventType, description, userId? })`).
- Produces: `DELETE /api/contracts/:id` com body `{ motivo: string }`. Sucesso: `{ success: true, casos_removidos: number, parcelas_removidas: number }`. Bloqueio (dinheiro pago): HTTP 409 `{ error: string }`. Motivo ausente/curto: HTTP 400 `{ error: string }`. Consumido pela Task 2 (frontend).

- [ ] **Step 1: Escrever o teste de integração (falhando)**

Arquivo `tests/contractsDeleteComMotivo.test.mjs`:

```javascript
// tests/contractsDeleteComMotivo.test.mjs
// DELETE /api/contracts/:id: exige motivo, apaga contrato+caso+parcelas
// pendentes vinculados ao mesmo cliente, bloqueia se houver parcela paga,
// e registra o motivo em client_timeline antes de apagar.
// Ver docs/superpowers/specs/2026-08-27-excluir-contrato-teste-design.md
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

async function criarCliente(nome) {
  const [r] = await db.query(
    "INSERT INTO clients (name, tipo, status, created_by) VALUES (?, 'PF', 'ativo', 1)", [nome]
  );
  return r.insertId;
}

test('deleteContratoComReversao apaga contrato+caso+parcela pendente e registra motivo na timeline', async (t) => {
  let userId, clientId, contractId, caseId, installmentId;
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    clientId = await criarCliente('Cliente Teste Exclusão Contrato');
    const [cr] = await db.query(
      "INSERT INTO cases (user_id, client_id, title, legal_area, status) VALUES (?, ?, 'Caso teste exclusão', 'outro', 'ativo')",
      [userId, clientId]
    );
    caseId = cr.insertId;
    const [ctr] = await db.query(
      "INSERT INTO contracts (user_id, client_id, area, title, status) VALUES (?, ?, 'outro', 'Contrato teste exclusão', 'assinado')",
      [userId, clientId]
    );
    contractId = ctr.insertId;
    const [ins] = await db.query(
      "INSERT INTO installments (user_id, client_id, case_id, numero, valor, due_date, status) VALUES (?, ?, ?, 1, 100, CURDATE(), 'pendente')",
      [userId, clientId, caseId]
    );
    installmentId = ins.insertId;

    const { deleteContratoComReversao } = await import('../dist/routes/contracts.js');
    const resultado = await deleteContratoComReversao(contractId, userId, 'Contrato de teste, criado por engano');

    assert.strictEqual(resultado.casos_removidos, 1);
    assert.strictEqual(resultado.parcelas_removidas, 1);

    const [contratoRestante] = await db.query('SELECT id FROM contracts WHERE id = ?', [contractId]);
    assert.strictEqual(contratoRestante.length, 0, 'o contrato deveria ter sido apagado');

    const [casoRestante] = await db.query('SELECT id FROM cases WHERE id = ?', [caseId]);
    assert.strictEqual(casoRestante.length, 0, 'o caso deveria ter sido apagado');

    const [parcelaRestante] = await db.query('SELECT id FROM installments WHERE id = ?', [installmentId]);
    assert.strictEqual(parcelaRestante.length, 0, 'a parcela pendente deveria ter sido apagada');

    const [timeline] = await db.query(
      "SELECT description FROM client_timeline WHERE client_id = ? AND event_type = 'contrato_excluido'", [clientId]
    );
    assert.strictEqual(timeline.length, 1, 'deveria existir 1 registro na timeline');
    assert.match(timeline[0].description, /Contrato de teste, criado por engano/, 'a descrição deve conter o motivo digitado');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    await db.query('DELETE FROM client_timeline WHERE client_id = ?', [clientId]).catch(() => {});
    await db.query('DELETE FROM installments WHERE id = ?', [installmentId]).catch(() => {});
    await db.query('DELETE FROM contracts WHERE id = ?', [contractId]).catch(() => {});
    await db.query('DELETE FROM cases WHERE id = ?', [caseId]).catch(() => {});
    await db.query('DELETE FROM clients WHERE id = ?', [clientId]).catch(() => {});
  }
});

test('deleteContratoComReversao bloqueia quando há parcela já paga (não apaga nada)', async (t) => {
  let userId, clientId, contractId, caseId, installmentId;
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    clientId = await criarCliente('Cliente Teste Bloqueio Exclusão');
    const [cr] = await db.query(
      "INSERT INTO cases (user_id, client_id, title, legal_area, status) VALUES (?, ?, 'Caso teste bloqueio', 'outro', 'ativo')",
      [userId, clientId]
    );
    caseId = cr.insertId;
    const [ctr] = await db.query(
      "INSERT INTO contracts (user_id, client_id, area, title, status) VALUES (?, ?, 'outro', 'Contrato teste bloqueio', 'assinado')",
      [userId, clientId]
    );
    contractId = ctr.insertId;
    const [ins] = await db.query(
      "INSERT INTO installments (user_id, client_id, case_id, numero, valor, due_date, status, paid_at) VALUES (?, ?, ?, 1, 100, CURDATE(), 'pago', NOW())",
      [userId, clientId, caseId]
    );
    installmentId = ins.insertId;

    const { deleteContratoComReversao } = await import('../dist/routes/contracts.js');
    await assert.rejects(
      () => deleteContratoComReversao(contractId, userId, 'Tentando excluir mesmo com parcela paga'),
      /parcela.*paga|dinheiro.*receb/i,
      'deveria recusar a exclusão quando há parcela paga'
    );

    const [contratoAinda] = await db.query('SELECT id FROM contracts WHERE id = ?', [contractId]);
    assert.strictEqual(contratoAinda.length, 1, 'o contrato NÃO deveria ter sido apagado (bloqueio)');
    const [casoAinda] = await db.query('SELECT id FROM cases WHERE id = ?', [caseId]);
    assert.strictEqual(casoAinda.length, 1, 'o caso NÃO deveria ter sido apagado (bloqueio)');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    await db.query('DELETE FROM client_timeline WHERE client_id = ?', [clientId]).catch(() => {});
    await db.query('DELETE FROM installments WHERE id = ?', [installmentId]).catch(() => {});
    await db.query('DELETE FROM contracts WHERE id = ?', [contractId]).catch(() => {});
    await db.query('DELETE FROM cases WHERE id = ?', [caseId]).catch(() => {});
    await db.query('DELETE FROM clients WHERE id = ?', [clientId]).catch(() => {});
  }
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx tsc && node --test tests/contractsDeleteComMotivo.test.mjs`
Expected: FAIL — `deleteContratoComReversao is not a function` (a função ainda não existe).

- [ ] **Step 3: Implementar `deleteContratoComReversao` e a rota `DELETE /:id`**

Em `src/routes/contracts.ts`, adicionar ao final do arquivo, antes do `export default router;`:

```typescript
// ── Exclusão com reversão ────────────────────────────────────────────────────
// Apaga o "pacote completo" de um contrato de teste: o contrato, os casos
// vinculados ao mesmo cliente (esteira de produção), e parcelas/lançamentos
// PENDENTES desses casos. Bloqueia se houver qualquer parcela ou lançamento
// já PAGO — isso indica dinheiro real recebido, que exige ajuste manual
// antes de qualquer exclusão automática. O motivo fica registrado na
// timeline do cliente antes do DELETE, para sobreviver à exclusão.
export async function deleteContratoComReversao(contractId: number, userId: number, motivo: string) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[contrato]] = await conn.query(
      'SELECT id, client_id, lead_id, title FROM contracts WHERE id = ? AND user_id = ?',
      [contractId, userId]
    ) as any;
    if (!contrato) { throw new Error('Contrato não encontrado'); }
    if (!contrato.client_id) {
      // Sem cliente vinculado — não há caso/parcela possível para reverter,
      // só apaga o contrato.
      await conn.query('DELETE FROM contracts WHERE id = ?', [contractId]);
      await conn.commit();
      return { casos_removidos: 0, parcelas_removidas: 0 };
    }

    const [casos] = await conn.query(
      'SELECT id FROM cases WHERE client_id = ?', [contrato.client_id]
    ) as any;
    const caseIds: number[] = casos.map((c: any) => c.id);

    if (caseIds.length) {
      const placeholders = caseIds.map(() => '?').join(',');
      const [[pagoInst]] = await conn.query(
        `SELECT COUNT(*) AS qtd FROM installments WHERE case_id IN (${placeholders}) AND status = 'pago'`,
        caseIds
      ) as any;
      const [[pagoFr]] = await conn.query(
        `SELECT COUNT(*) AS qtd FROM financial_records WHERE case_id IN (${placeholders}) AND status = 'pago'`,
        caseIds
      ) as any;
      if (Number(pagoInst.qtd) > 0 || Number(pagoFr.qtd) > 0) {
        throw new Error('Este processo tem parcela(s) ou lançamento(s) já pago(s) — não é possível excluir automaticamente. Ajuste manualmente (estorno) antes.');
      }
    }

    await logTimeline({
      clientId: contrato.client_id, contractId: contrato.id,
      eventType: 'contrato_excluido',
      description: `Contrato "${contrato.title}" excluído. Motivo: ${motivo}`,
      userId,
    });

    let parcelasRemovidas = 0;
    if (caseIds.length) {
      const placeholders = caseIds.map(() => '?').join(',');
      const [rInst] = await conn.query(
        `DELETE FROM installments WHERE case_id IN (${placeholders})`, caseIds
      ) as any;
      parcelasRemovidas = rInst.affectedRows;
      await conn.query(`DELETE FROM financial_records WHERE case_id IN (${placeholders})`, caseIds);
      await conn.query(`DELETE FROM cases WHERE id IN (${placeholders})`, caseIds);
    }

    await conn.query('DELETE FROM contracts WHERE id = ?', [contractId]);

    await conn.commit();
    return { casos_removidos: caseIds.length, parcelas_removidas: parcelasRemovidas };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

router.delete('/:id', async (req: Request, res: Response) => {
  const motivo = String(req.body?.motivo || '').trim();
  if (motivo.length < 5) {
    res.status(400).json({ error: 'Informe o motivo da exclusão (mínimo 5 caracteres)' });
    return;
  }
  try {
    const resultado = await deleteContratoComReversao(Number(req.params.id), req.user!.id, motivo);
    res.json({ success: true, ...resultado });
  } catch (err: any) {
    const status = err.message === 'Contrato não encontrado' ? 404
      : /parcela|lançamento/.test(err.message) ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsc && node --test tests/contractsDeleteComMotivo.test.mjs`
Expected: PASS nos 2 testes (ou `skip` se o banco local não tiver credenciais funcionais — ver Global Constraints do repositório sobre esse ambiente).

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: nenhum FAIL novo.

- [ ] **Step 6: Commit**

```bash
git add src/routes/contracts.ts tests/contractsDeleteComMotivo.test.mjs
git commit -m "feat: DELETE /api/contracts/:id apaga contrato+caso+parcelas com motivo"
```

---

### Task 2: Frontend — botão "Excluir" na lista de Contratos

**Files:**
- Modify: `public/app.js` (função `contratos`, linha ~1899-1924)

**Interfaces:**
- Consumes: `DELETE /api/contracts/:id` com body `{ motivo }` (Task 1). Helpers já existentes: `api`, `el`, `esc`, `toast`, `openModal`, `closeModal`, `field`.
- Produces: nenhuma interface nova consumida por outro arquivo.

- [ ] **Step 1: Adicionar a função de formulário de exclusão**

Em `public/app.js`, logo antes da função `contratos(page)` (linha ~1899), adicionar:

```javascript
// Exclui um contrato de teste: pede o motivo, avisa o que será apagado
// junto (caso na esteira + parcelas pendentes), e trata o bloqueio quando
// há dinheiro já pago vinculado (erro 409 do servidor).
async function contratoDeleteForm(ct, onSave) {
  const form = el(`<form class="form-grid">
    <div style="background:#fff7e6;border:1px solid var(--amber,#b8860b);border-radius:8px;padding:10px 12px;font-size:12.5px">
      <strong style="color:var(--amber,#b8860b)">⚠ Isso vai apagar:</strong>
      <div style="margin-top:4px">O contrato, o(s) caso(s) desse cliente na esteira de produção, e parcelas/lançamentos financeiros ainda PENDENTES. Se houver algo já pago, a exclusão será recusada.</div>
    </div>
    ${field('Motivo da exclusão *', 'motivo', { type: 'textarea', placeholder: 'ex.: contrato de teste, criado por engano' })}
    <button type="submit" class="btn-primary" style="background:var(--red,#c0392b);border-color:var(--red,#c0392b)">Excluir definitivamente</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const motivo = form.querySelector('[name=motivo]').value.trim();
    if (motivo.length < 5) { toast('Descreva o motivo (mínimo 5 caracteres)', 'error'); return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Excluindo…';
    try {
      const r = await api(`/api/contracts/${ct.id}`, { method: 'DELETE', body: JSON.stringify({ motivo }) });
      closeModal();
      toast(`Contrato excluído (${r.casos_removidos} caso(s), ${r.parcelas_removidas} parcela(s) removida(s))`);
      onSave();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Excluir definitivamente'; }
  };
  openModal(`Excluir "${ct.title}"`, form);
}
```

- [ ] **Step 2: Adicionar o botão na linha da tabela**

Em `public/app.js:1917`, trocar:

```javascript
          <td><button class="btn-sm" data-ct="${ct.id}">Abrir / Editar</button></td></tr>`).join('')}</tbody></table>`
```

por:

```javascript
          <td><button class="btn-sm" data-ct="${ct.id}">Abrir / Editar</button> <button class="btn-sm" data-ct-del="${ct.id}" style="color:var(--red,#c0392b)">Excluir</button></td></tr>`).join('')}</tbody></table>`
```

E logo abaixo, em `public/app.js:1919`, trocar:

```javascript
      document.querySelectorAll('[data-ct]').forEach((b) => b.onclick = () => contractEditor(b.dataset.ct, load));
```

por:

```javascript
      document.querySelectorAll('[data-ct]').forEach((b) => b.onclick = () => contractEditor(b.dataset.ct, load));
      document.querySelectorAll('[data-ct-del]').forEach((b) => {
        const ct = rows.find((x) => String(x.id) === b.dataset.ctDel);
        if (ct) b.onclick = () => contratoDeleteForm(ct, load);
      });
```

- [ ] **Step 3: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem saída.

- [ ] **Step 4: Teste manual**

Run: `npm run dev` (ou processo de start equivalente), abrir o CRM localmente.

Passos:
1. Ir em Contratos, confirmar que cada linha agora tem "Abrir / Editar" e "Excluir".
2. Clicar em "Excluir" num contrato de teste sem parcela paga — confirmar que o modal mostra o aviso e pede o motivo.
3. Tentar enviar sem motivo — confirmar que bloqueia com toast de erro.
4. Enviar com motivo válido — confirmar toast de sucesso e que o contrato some da lista.
5. Se possível, testar o caso de bloqueio: um contrato cujo caso tenha parcela paga — confirmar que a exclusão é recusada com a mensagem do servidor.

Expected: fluxo completo funciona sem erro no console do navegador.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: botão Excluir na tela de Contratos, com motivo obrigatório"
```

---

## Post-Implementation

Depois de ambas as tasks, rodar a suíte completa mais uma vez:

Run: `npx tsc && npm test`
Expected: todos os testes passam ou `skip` por ambiente, sem `FAIL` novo.

Pedir para a usuária excluir de verdade o contrato "Jessica" (`id=6`) de teste pela nova tela, confirmando que o caso "Processo — Jessica" (`id=59`, atualmente em `separacao_documentos`) some da esteira de produção junto.
