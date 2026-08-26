# Contas a Pagar — incluir repasses a parceiros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela Financeiro → Contas a Pagar passa a incluir repasses a parceiros pendentes/processando no total de "Saídas do mês", agrupados num card próprio, somente-leitura, com um link pra tela onde eles são de fato gerenciados.

**Architecture:** `GET /api/cashflow?type=saida` roda uma segunda query buscando `repasses`, concatena o resultado com o de `cashflow_entries` em JavaScript antes de responder — sem `UNION` SQL literal, sem mudar `cashflow_entries`. O frontend (`finContasPagar`) já agrupa por `category` automaticamente; só precisa de um rótulo novo pro grupo e de uma checagem no `id` (prefixo `"repasse:"`) pra trocar os botões de ação por um link de navegação.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM) no backend; vanilla JS sem build step no frontend (`public/app.js`); testes com `node --test` (arquivos `tests/*.test.mjs`, integração real contra banco com skip gracioso quando indisponível).

## Global Constraints

- `financial_records` (despesa) fica fora de escopo — vazia em produção, não faz parte desta mudança.
- Repasses só entram quando `type=saida`; nunca aparecem em `type=entrada`.
- Só `repasses.status IN ('pendente', 'processando')` — nunca `'repassado'`/`'cancelado'`.
- Repasse tem `escopo` sempre `'empresa'` — quando a URL pede `?escopo=pessoal`, a query de repasses não roda (array vazio).
- `id` de uma linha de repasse é sempre a string `"repasse:{id}"` — nunca um número puro. É o único sinal que o frontend usa pra saber que aquela linha não é editável do mesmo jeito que uma de `cashflow_entries`.
- Nenhum endpoint novo de escrita para `repasses` dentro de `cashflow.ts` — a mudança de status de repasse continua exclusivamente na aba/rota de Repasses já existente (`finRepasses`).
- `repasse_parceiro` NÃO entra em `GRUPOS_DESPESA` (a lista que também alimenta o `<select>` de categoria do formulário "+ Conta a pagar") — só no dicionário de rótulos usado pra exibição, senão vira uma opção selecionável indevida no formulário manual.
- Sem testes automatizados de frontend no projeto — a mudança de UI é validada com `node --check public/app.js` + checklist visual manual.
- Toda task de backend valida com `npx tsc --noEmit` (zero erros) e `node --test` (baseline: 221 testes, 218 pass, 0 fail, 3 skipped — sem regressão nesse número).

---

### Task 1: Backend — repasses entram em `GET /api/cashflow?type=saida`

**Files:**
- Modify: `src/routes/cashflow.ts:31-47` (handler `GET /`)
- Test: criar `tests/cashflowRepasses.test.mjs`

**Interfaces:**
- Produces: função exportada `buscarRepassesComoSaida(from?: string, to?: string): Promise<any[]>` em `src/routes/cashflow.ts` — usada tanto pela rota quanto diretamente pelo teste (o projeto não usa chamadas HTTP reais em teste, ver `tests/propostaPaymentGatewayPersistencia.test.mjs` como referência de estilo: grava no banco e confirma via SQL/função direta, não via `supertest`). Retorna um array no formato:
  ```json
  {
    "id": "repasse:42", "type": "saida", "category": "repasse_parceiro",
    "description": "Repasse a João Silva — indicação (Proc. 0001234-56...)",
    "amount": 300.00, "due_date": "2026-08-30", "status": "previsto",
    "escopo": "empresa", "pagador": null, "banco": null,
    "installment_total": 1, "installment_no": null, "recurrence_group": null
  }
  ```
  `GET /api/cashflow?type=saida[&from=YYYY-MM-DD&to=YYYY-MM-DD][&escopo=empresa|pessoal]` passa a incluir essas linhas concatenadas às de `cashflow_entries` (exceto quando `escopo=pessoal`). Task 2 (frontend) consome o array via `api('/api/cashflow?type=saida&...')` sem nenhuma mudança de contrato — só precisa reconhecer o prefixo `"repasse:"` no campo `id`.

- [ ] **Step 1: Escrever o teste (falha primeiro — a função ainda não existe)**

Crie `tests/cashflowRepasses.test.mjs`:

```javascript
// tests/cashflowRepasses.test.mjs
// Contas a Pagar só lia cashflow_entries (lançamentos manuais) — repasses a
// parceiros, que já existem no sistema, nunca entravam no total de "Saídas
// do mês". Este teste grava repasses reais e confirma que
// buscarRepassesComoSaida() os retorna no formato e sob as regras exatas
// do spec: docs/superpowers/specs/2026-08-25-contas-a-pagar-repasses-unificado.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const { buscarRepassesComoSaida } = await import('../dist/routes/cashflow.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('buscarRepassesComoSaida traz pendente/processando, exclui repassado/cancelado', async (t) => {
  let caseId;
  const insertedRepasseIds = [];
  try {
    const [cases] = await db.query('SELECT id FROM cases LIMIT 1');
    if (!cases.length) { t.skip('nenhum caso disponível neste banco para vincular o repasse de teste'); return; }
    caseId = cases[0].id;

    const [rPendente] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, descricao, status, data_vencimento)
       VALUES (?, 'Parceiro Teste Pendente', 'indicacao', 321.50, 'Repasse de teste pendente', 'pendente', '2026-08-20')`,
      [caseId]
    );
    insertedRepasseIds.push(rPendente.insertId);

    const [rProcessando] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, descricao, status, data_vencimento)
       VALUES (?, 'Parceiro Teste Processando', 'audiencia', 150.00, 'Repasse de teste processando', 'processando', '2026-08-21')`,
      [caseId]
    );
    insertedRepasseIds.push(rProcessando.insertId);

    const [rRepassado] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, descricao, status, data_vencimento, data_repasse)
       VALUES (?, 'Parceiro Teste Repassado', 'indicacao', 99.00, 'Repasse já pago', 'repassado', '2026-08-22', NOW())`,
      [caseId]
    );
    insertedRepasseIds.push(rRepassado.insertId);

    const rows = await buscarRepassesComoSaida('2026-08-01', '2026-08-31');
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(`repasse:${rPendente.insertId}`), 'repasse pendente deveria aparecer');
    assert.ok(ids.includes(`repasse:${rProcessando.insertId}`), 'repasse processando deveria aparecer');
    assert.ok(!ids.includes(`repasse:${rRepassado.insertId}`), 'repasse já repassado NÃO deveria aparecer');

    const linhaPendente = rows.find((r) => r.id === `repasse:${rPendente.insertId}`);
    assert.strictEqual(linhaPendente.type, 'saida');
    assert.strictEqual(linhaPendente.category, 'repasse_parceiro');
    assert.strictEqual(linhaPendente.escopo, 'empresa');
    assert.strictEqual(Number(linhaPendente.amount), 321.5);
    assert.strictEqual(linhaPendente.status, 'previsto');
    assert.ok(linhaPendente.description.includes('Parceiro Teste Pendente'));
    assert.strictEqual(linhaPendente.pagador, null);
    assert.strictEqual(linhaPendente.banco, null);

    // Fora da janela from/to — não deve aparecer.
    const rowsForaDaJanela = await buscarRepassesComoSaida('2026-01-01', '2026-01-31');
    const idsForaDaJanela = rowsForaDaJanela.map((r) => r.id);
    assert.ok(!idsForaDaJanela.includes(`repasse:${rPendente.insertId}`), 'repasse fora da janela de datas não deveria aparecer');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedRepasseIds) {
      await db.query('DELETE FROM repasses WHERE id = ?', [id]).catch(() => {});
    }
  }
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha (a função ainda não existe)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc && node --test tests/cashflowRepasses.test.mjs`
Expected: FAIL — `buscarRepassesComoSaida` não é exportado por `dist/routes/cashflow.js` (erro de import/undefined). Se o teste for pulado (`t.skip`) por falta de caso no banco, isso é aceitável neste ambiente — documente no relatório da task e prossiga para a implementação mesmo assim, já que o teste roda em CI/produção onde há banco real.

- [ ] **Step 3: Implementar a mudança em `src/routes/cashflow.ts`**

Substitua o handler `GET /` (linhas 31-47) por:

```typescript
// ── GET /api/cashflow — lista os lançamentos manuais + repasses pendentes ──
// Contas a Pagar só lia cashflow_entries (lançamentos manuais) — repasses a
// parceiros (tabela `repasses`, já usada em outras partes do financeiro,
// ver src/services/financeSummary.ts) nunca entravam no total de saídas.
// Quando type=saida, busca repasses pendentes/processando na mesma janela
// de vencimento e concatena ao resultado (não é UNION SQL — são fontes
// diferentes, mantidas separadas até aqui). Ver
// docs/superpowers/specs/2026-08-25-contas-a-pagar-repasses-unificado.md
//
// Extraída como função nomeada (e exportada) em vez de ficar inline no
// handler para que o teste de integração chame a mesma lógica direto,
// sem precisar de um cliente HTTP — o projeto não usa supertest/HTTP em
// testes (ver tests/propostaPaymentGatewayPersistencia.test.mjs), testa
// a lógica de dados diretamente.
export async function buscarRepassesComoSaida(from?: string, to?: string): Promise<any[]> {
  const repasseParams: any[] = [];
  const repasseWhere: string[] = ["r.status IN ('pendente', 'processando')"];
  if (from) { repasseWhere.push('r.data_vencimento >= ?'); repasseParams.push(from); }
  if (to) { repasseWhere.push('r.data_vencimento <= ?'); repasseParams.push(to); }
  const [repasseRows] = await db.query(
    `SELECT CONCAT('repasse:', r.id) AS id, 'saida' AS type, 'repasse_parceiro' AS category,
            CONCAT('Repasse a ', r.parceiro, ' — ', r.descricao) AS description,
            r.valor AS amount, r.data_vencimento AS due_date, 'previsto' AS status,
            'empresa' AS escopo, NULL AS pagador, NULL AS banco, 1 AS installment_total,
            NULL AS installment_no, NULL AS recurrence_group
       FROM repasses r
      WHERE ${repasseWhere.join(' AND ')}
      ORDER BY r.data_vencimento ASC LIMIT 500`,
    repasseParams
  ) as any;
  return repasseRows;
}

router.get('/', async (req: Request, res: Response) => {
  const type = req.query.type as string;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (type && TYPES.includes(type)) { where.push('type = ?'); params.push(type); }
  if (from) { where.push('due_date >= ?'); params.push(from); }
  if (to) { where.push('due_date <= ?'); params.push(to); }
  const escopo = req.query.escopo as string;
  if (escopo === 'empresa' || escopo === 'pessoal') { where.push('escopo = ?'); params.push(escopo); }

  const [rows] = await db.query(
    `SELECT * FROM cashflow_entries WHERE ${where.join(' AND ')} ORDER BY due_date ASC LIMIT 500`, params
  ) as any;

  // Repasses são sempre 'saida' e sempre escopo 'empresa' — só entram
  // quando a consulta pede saídas e não filtrou explicitamente por
  // escopo='pessoal'.
  if (type === 'saida' && escopo !== 'pessoal') {
    const repasseRows = await buscarRepassesComoSaida(from, to);
    rows.push(...repasseRows);
  }

  res.json(rows);
});
```

- [ ] **Step 4: Rodar o teste de novo — deve passar**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc && node --test tests/cashflowRepasses.test.mjs`
Expected: `pass 1`, `fail 0` (ou `t.skip` com mensagem clara de ambiente sem banco/dado — mesma ressalva do Step 2)

- [ ] **Step 5: Rodar a suíte completa (sem regressão)**

Run: `cd /c/Users/prosy/CRMLRTICIA && node --test`
Expected: `pass` ≥ 218 (baseline + o teste novo), `fail 0`

- [ ] **Step 6: Commit**

```bash
git add src/routes/cashflow.ts tests/cashflowRepasses.test.mjs package.json package-lock.json
git commit -m "feat: repasses pendentes entram em GET /api/cashflow?type=saida"
```

---

### Task 2: Frontend — grupo "Repasses a parceiros" + link "Ver em Repasses"

**Files:**
- Modify: `public/app.js:4942` (logo após a definição de `GRUPO_PT`)
- Modify: `public/app.js:5052-5070` (dentro de `finContasPagar`, a renderização de cada linha da tabela e a ligação dos botões de ação)

**Interfaces:**
- Consumes: `GET /api/cashflow?type=saida` (Task 1) — cada linha de repasse chega com `id` no formato `"repasse:{id}"`, `category: "repasse_parceiro"`.
- Produces: nenhuma interface nova para outras tasks — esta é a última task do plano.

- [ ] **Step 1: Adicionar o rótulo do grupo, sem adicionar a categoria ao formulário manual**

Logo após a linha 4942 (`const GRUPO_PT = Object.fromEntries(GRUPOS_DESPESA);`), adicione:

```javascript
// "repasse_parceiro" NÃO entra em GRUPOS_DESPESA de propósito: essa lista
// também alimenta o <select> de categoria do formulário "+ Conta a pagar"
// (contaPagarForm, campo 'category') — incluí-la lá deixaria a usuária
// criar um lançamento manual da mesma categoria, colidindo semanticamente
// com repasses de verdade (que vêm só da tabela `repasses`, somente-leitura
// aqui). O rótulo entra direto no dicionário de EXIBIÇÃO.
GRUPO_PT.repasse_parceiro = 'Repasses a parceiros';
```

- [ ] **Step 2: Trocar os botões de ação por um link "Ver em Repasses" quando a linha for de repasse**

Releia o trecho atual de `finContasPagar` que renderiza cada linha (por volta da linha 5052-5070 — confirme contra o arquivo real antes de editar, já que os números podem ter deslocado com a Task 1 se ela tocou este mesmo arquivo, o que não é o caso aqui). O bloco atual é:

```javascript
        <tbody>${items.map((r) => {
          const due = (r.due_date || '').split('T')[0];
          const isVenc = r.status !== 'realizado' && due && due < todayStr;
          const st = r.status === 'realizado' ? '<span class="badge ativo">pago</span>'
            : isVenc ? '<span class="badge vencido">vencido</span>' : '<span class="badge">em aberto</span>';
          const rec = r.installment_total > 1 ? ` <small style="color:var(--text-muted)">(${r.installment_no}/${r.installment_total})</small>` : '';
          const escChip = r.escopo === 'pessoal' ? '<span class="chip-escopo pessoal">' + svgIcon('users', 'ic-inline') + 'Pessoal</span>' : '<span class="chip-escopo empresa">' + svgIcon('building', 'ic-inline') + 'Empresa</span>';
          const quem = [r.pagador, r.banco].filter(Boolean).join(' · ');
          return `<tr class="${r.escopo === 'pessoal' ? 'row-pessoal' : ''}">
            <td>${r.description}${rec} ${escChip}${quem ? `<br><small style="color:var(--text-muted)">💳 ${esc(quem)}</small>` : ''}</td>
            <td>${due ? fmtDate(due) : '—'}</td>
            <td>${money(r.amount)}</td>
            <td>${st}</td>
            <td style="white-space:nowrap;text-align:right">
              ${r.status !== 'realizado' ? `<button class="btn-sm" data-pay="${r.id}">Pagar</button>` : `<button class="btn-sm" data-reopen="${r.id}" title="Desfazer pagamento">Reabrir</button>`}
              <button class="btn-sm" data-edit="${r.id}">Editar</button>
              <button class="btn-sm" data-del="${r.id}" data-grp="${r.recurrence_group || ''}" data-tot="${r.installment_total || 1}">Excluir</button>
            </td></tr>`;
        }).join('')}</tbody></table></div>`;
```

Substitua por:

```javascript
        <tbody>${items.map((r) => {
          const ehRepasse = String(r.id).startsWith('repasse:');
          const due = (r.due_date || '').split('T')[0];
          const isVenc = r.status !== 'realizado' && due && due < todayStr;
          const st = r.status === 'realizado' ? '<span class="badge ativo">pago</span>'
            : isVenc ? '<span class="badge vencido">vencido</span>' : '<span class="badge">em aberto</span>';
          const rec = r.installment_total > 1 ? ` <small style="color:var(--text-muted)">(${r.installment_no}/${r.installment_total})</small>` : '';
          const escChip = r.escopo === 'pessoal' ? '<span class="chip-escopo pessoal">' + svgIcon('users', 'ic-inline') + 'Pessoal</span>' : '<span class="chip-escopo empresa">' + svgIcon('building', 'ic-inline') + 'Empresa</span>';
          const quem = [r.pagador, r.banco].filter(Boolean).join(' · ');
          // Repasse não é editável aqui: sua mudança de status vive na aba
          // Repasses (finRepasses) — duplicar Pagar/Editar/Excluir nesta
          // tela criaria dois caminhos de escrita para o mesmo dado.
          const acoes = ehRepasse
            ? `<button class="btn-sm" data-ver-repasse="1">Ver em Repasses</button>`
            : `${r.status !== 'realizado' ? `<button class="btn-sm" data-pay="${r.id}">Pagar</button>` : `<button class="btn-sm" data-reopen="${r.id}" title="Desfazer pagamento">Reabrir</button>`}
              <button class="btn-sm" data-edit="${r.id}">Editar</button>
              <button class="btn-sm" data-del="${r.id}" data-grp="${r.recurrence_group || ''}" data-tot="${r.installment_total || 1}">Excluir</button>`;
          return `<tr class="${r.escopo === 'pessoal' ? 'row-pessoal' : ''}">
            <td>${r.description}${rec} ${escChip}${quem ? `<br><small style="color:var(--text-muted)">💳 ${esc(quem)}</small>` : ''}</td>
            <td>${due ? fmtDate(due) : '—'}</td>
            <td>${money(r.amount)}</td>
            <td>${st}</td>
            <td style="white-space:nowrap;text-align:right">${acoes}</td></tr>`;
        }).join('')}</tbody></table></div>`;
```

- [ ] **Step 3: Ligar o clique de "Ver em Repasses" à troca de aba do Financeiro**

Releia o bloco de listeners logo após a montagem de `#cp-groups` (a série de `$('#cp-groups').querySelectorAll('[data-pay]')...` etc, por volta da linha 5073-5096 do arquivo original). Adicione, junto aos outros listeners desse mesmo bloco:

```javascript
    $('#cp-groups').querySelectorAll('[data-ver-repasse]').forEach((b) => b.onclick = () => {
      location.hash = '#financeiro:repasses';
    });
```

Antes de aplicar este step, confirme como a navegação entre abas do Financeiro funciona de fato: rode `grep -n "financeiro:" public/app.js | head -10` e `grep -n "location.hash.*repasses\|hash.split" public/app.js | head -10` para achar o padrão real usado pela tela (o roteador de abas fica perto de `const tabs = { geral: finVisaoGeral, ..., repasses: finRepasses, ... }`, por volta da linha 1431 — a URL/hash que ativa a aba `repasses` dentro do Financeiro é o que esse grep revela). Se o padrão real for diferente de `#financeiro:repasses` (por exemplo, um parâmetro de query, ou uma função direta tipo `abrirAbaFinanceiro('repasses')`), use o padrão real encontrado — não o hash acima às cegas.

- [ ] **Step 4: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem erros (comando não imprime nada em caso de sucesso)

- [ ] **Step 5: Rodar a suíte completa (garantir que a mudança de frontend não quebrou nada em backend)**

Run: `cd /c/Users/prosy/CRMLRTICIA && npx tsc --noEmit && node --test`
Expected: `tsc` sem erros; `node --test` com `pass` ≥ 218 (ou 219 se a Task 1 já tiver rodado sem skip), `fail 0`

- [ ] **Step 6: Checklist visual manual (sem testes automatizados de frontend no projeto)**

No navegador, logado como staff/admin, na tela Financeiro → aba Contas a Pagar, com pelo menos um repasse pendente ou processando cadastrado no mês selecionado:
- [ ] Aparece um card "Repasses a parceiros" na lista, depois dos grupos de categorias manuais.
- [ ] O valor do repasse soma corretamente em "Saídas do mês" no topo (compare manualmente: total antes vs. depois de ter um repasse no período).
- [ ] A linha do repasse mostra "Ver em Repasses" no lugar de Pagar/Editar/Excluir.
- [ ] Clicar em "Ver em Repasses" troca para a aba Repasses da mesma tela Financeiro (sem sair da página).
- [ ] Trocar o filtro de escopo para "Pessoal" faz a linha de repasse sumir da lista.
- [ ] O formulário "+ Conta a pagar" (botão no topo da tela) NÃO mostra "Repasses a parceiros" como opção de categoria selecionável.

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: mostra repasses pendentes na Contas a Pagar, sem editar por lá"
```

---

## Self-Review (checklist do autor do plano, já verificado)

1. **Cobertura da spec**: Decisão 1 (só repasses, não financial_records) → nenhuma task toca `financial_records`. Decisão 2 (backend, query + merge em JS) → Task 1 Step 3, query idêntica à do spec. Decisão 3 (frontend, grupo automático + KPIs automáticos) → Task 2 Step 1 (rótulo) — os KPIs não precisam de código novo porque já somam `rows.forEach` sem checar origem (confirmado por leitura de `finContasPagar` antes de escrever este plano). Decisão 4 (somente-leitura + link) → Task 2 Steps 2-3.
2. **Placeholders**: nenhum "TBD"/"adicionar validação" sem código — todo step tem o código completo a escrever. Exceção deliberada e sinalizada: Task 2 Step 3 pede ao implementador para *confirmar* o padrão real de navegação por hash antes de aplicar, porque o plano não tem certeza de qual é o mecanismo exato — isso é uma instrução de verificação, não uma lacuna de especificação (o efeito esperado — "trocar pra aba Repasses sem sair da página" — está totalmente especificado).
3. **Consistência de tipos**: `id` de repasse é sempre a string `"repasse:{id}"` em todos os lugares (SQL `CONCAT('repasse:', r.id)`, teste `` `repasse:${rPendente.insertId}` ``, frontend `String(r.id).startsWith('repasse:')`). `category: 'repasse_parceiro'` idêntico em SQL, teste, e no rótulo `GRUPO_PT.repasse_parceiro`.
