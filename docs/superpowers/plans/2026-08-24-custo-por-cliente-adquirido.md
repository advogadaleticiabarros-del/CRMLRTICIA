# Custo por Cliente Adquirido, por Canal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a usuária lance manualmente o gasto de marketing por mês/canal e ver, no painel Comercial, o custo por cliente adquirido em cada canal — cruzando esse gasto com os leads que realmente viraram cliente naquele mês.

**Architecture:** Tabela nova `gasto_marketing` (mês + canal + valor, upsert via `UNIQUE KEY`). Duas rotas novas em `src/routes/dashboards/comercial.ts`: `POST /gasto-marketing` (lançar/atualizar) e `GET /gasto-marketing?mes=` (listar o que já foi lançado, para popular o formulário). Uma terceira rota, `GET /custo-aquisicao?mes=`, cruza `leads.source` (já normalizado no momento da criação do lead — ver Global Constraints) com `gasto_marketing` do mesmo mês. Frontend ganha uma seção nova em `dashComercial`: formulário de lançamento + tabela de resultado.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM). Testes com `node --test` contra `dist/` compilado (`npx tsc` primeiro). Frontend vanilla JS sem build step.

## Global Constraints

- Gasto é 100% manual — nenhuma integração com Meta Ads API/Google Ads API (spec, decisão 1).
- Tela de lançamento fica dentro do painel Comercial, não em Configurações (spec, decisão 2).
- Canais orgânicos (sem gasto) aparecem com custo R$ 0 — nunca omitidos da lista (spec, decisão 3).
- Cálculo é por mês; comparação histórica entre meses fica fora de escopo (spec, Fora de escopo).
- Atribuição é sempre pelo canal de origem gravado no primeiro contato — sem modelo multi-touch (spec, Fora de escopo).
- Nenhuma integração automática com plataformas de anúncio (spec, Fora de escopo).

**Divergências/confirmações contra a spec original** (verificadas lendo o código real antes de escrever este plano):
1. A spec falava em reaproveitar "a lista de canais de `leadChannel.ts`" sem citar nomes exatos. Confirmado: `src/services/leadChannel.ts` já exporta `export const CANAIS = ['Meta Ads', 'Google Ads', 'Instagram (orgânico)', 'Facebook (orgânico)', 'Google (orgânico)', 'WhatsApp', 'Indicação', 'Site (direto)', 'E-mail', 'Outro'] as const;` — 10 valores, já prontos para importar diretamente (não precisa duplicar a lista nem expor via API nova).
2. A spec assumia que o cálculo de custo por cliente precisaria "normalizar" a origem do lead na hora da consulta. **Não precisa**: `leads.source` já é gravado com o valor normalizado no momento da criação (`src/routes/lead-public.ts`: `const source = normalizeChannel({...})`, salvo direto em `leads.source`). O cálculo de custo por cliente só precisa agrupar por `leads.source` como está — sem chamar `normalizeChannel` de novo.
3. A spec dizia "clientes fechados (`status='fechada'`)" — o ENUM real de `leads.status` tem dois valores que significam "virou cliente": `fechada` E `convertido` (confirmado no plano anterior, "funil comercial", e usado consistentemente em `comercial.ts:99` como `status IN ('fechada','convertido')`). Este plano usa `status IN ('fechada','convertido')`, não só `fechada`, para ficar consistente com o resto do dashboard.
4. `dashComercial` (`public/app.js`) já foi editada por dois planos anteriores (funil comercial, rentabilidade por área) e hoje termina com o `miniList` de campanhas (linha ~3966-3969 na versão atual). A seção nova entra logo depois desse bloco, dentro da mesma função.
5. Próximo número de migration livre: `101` (a última existente é `100_padroniza_legal_area.sql`).

---

### Task 1: Migration — tabela `gasto_marketing`

**Files:**
- Create: `migrations/101_gasto_marketing.sql`

**Interfaces:**
- Produces: tabela `gasto_marketing (id, mes_referencia DATE, canal VARCHAR(60), valor DECIMAL(10,2), created_by INT NULL, created_at DATETIME, UNIQUE KEY uk_mes_canal (mes_referencia, canal))` — usada pela Task 2 (rotas de lançamento) e Task 3 (cálculo de custo).

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- Migration 101 — Tabela de gasto de marketing por mês/canal
-- Lançamento 100% manual (sem integração com Meta Ads/Google Ads API).
-- UNIQUE KEY (mes_referencia, canal) garante um único valor por mês+canal —
-- lançar de novo faz upsert (ON DUPLICATE KEY UPDATE), não duplica linha.

CREATE TABLE gasto_marketing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mes_referencia DATE NOT NULL,
  canal VARCHAR(60) NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mes_canal (mes_referencia, canal)
);
```

- [ ] **Step 2: Commit**

```bash
git add migrations/101_gasto_marketing.sql
git commit -m "feat: tabela gasto_marketing (lançamento manual por mês/canal)"
```

Nota: esta migration só é validada de verdade no deploy real (VPS). **Não rode `npm run migrate` localmente nem configure acesso a banco real neste ambiente** — a sintaxe SQL é a única coisa a conferir visualmente antes de commitar.

---

### Task 2: Rotas de lançamento (`POST`/`GET /gasto-marketing`)

**Files:**
- Modify: `src/routes/dashboards/comercial.ts`
- Test: `tests/dashboardComercialGastoMarketing.test.mjs` (novo)

**Interfaces:**
- Consumes: `CANAIS` de `src/services/leadChannel.ts` (import: `import { CANAIS } from '../../services/leadChannel';`).
- Produces: `POST /api/dashboards/comercial/gasto-marketing` (body: `{mes_referencia: 'YYYY-MM-DD', canal: string, valor: number}`, upsert) e `GET /api/dashboards/comercial/gasto-marketing?mes=YYYY-MM` (lista os lançamentos daquele mês) — usadas pela Task 4 (frontend).

- [ ] **Step 1: Escrever o teste falho**

Estas rotas fazem operações reais de banco (INSERT/SELECT em `gasto_marketing`), então os testes seguem o padrão de skip-gracioso-se-MySQL-indisponível já estabelecido no projeto (`tests/asaasService.test.mjs`, `tests/propostasLegalArea.test.mjs`). Como são rotas Express (não funções puras), os testes aqui são de auditoria estática do código-fonte — confirmam que a validação e a query certas existem, sem precisar subir um servidor:

Criar `tests/dashboardComercialGastoMarketing.test.mjs`:

```javascript
// tests/dashboardComercialGastoMarketing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('rota POST /gasto-marketing valida canal contra CANAIS antes de gravar', () => {
  const src = fs.readFileSync(path.resolve('src/routes/dashboards/comercial.ts'), 'utf8');
  assert.match(src, /import\s*\{\s*CANAIS\s*\}\s*from\s*['"]\.\.\/\.\.\/services\/leadChannel['"]/, 'CANAIS precisa ser importado de leadChannel.ts');
  const m = src.match(/router\.post\('\/gasto-marketing'[\s\S]*?\}\);/);
  assert.ok(m, 'rota POST /gasto-marketing não encontrada');
  assert.match(m[0], /CANAIS\.includes\(/, 'POST precisa validar canal contra CANAIS antes de gravar');
});

test('rota POST /gasto-marketing usa upsert (ON DUPLICATE KEY UPDATE), não INSERT simples', () => {
  const src = fs.readFileSync(path.resolve('src/routes/dashboards/comercial.ts'), 'utf8');
  const m = src.match(/router\.post\('\/gasto-marketing'[\s\S]*?\}\);/);
  assert.ok(m, 'rota POST /gasto-marketing não encontrada');
  assert.match(m[0], /ON DUPLICATE KEY UPDATE/i, 'lançar de novo pro mesmo mês+canal precisa atualizar, não duplicar');
});

test('rota GET /gasto-marketing filtra por mes_referencia recebido na query', () => {
  const src = fs.readFileSync(path.resolve('src/routes/dashboards/comercial.ts'), 'utf8');
  const m = src.match(/router\.get\('\/gasto-marketing'[\s\S]*?\}\);/);
  assert.ok(m, 'rota GET /gasto-marketing não encontrada');
  assert.match(m[0], /req\.query\.mes/, 'GET precisa ler o mês da query string');
  assert.match(m[0], /FROM gasto_marketing/i, 'GET precisa consultar a tabela gasto_marketing');
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test tests/dashboardComercialGastoMarketing.test.mjs`
Expected: FAIL — nenhuma das duas rotas existe ainda em `comercial.ts`.

- [ ] **Step 3: Implementar as duas rotas**

Em `src/routes/dashboards/comercial.ts`, adicionar o import no topo do arquivo (junto aos imports existentes):

```typescript
import { Router, Request, Response } from 'express';
import { db } from '../../config/database';
import { CANAIS } from '../../services/leadChannel';
```

Adicionar as duas rotas novas logo antes de `export default router;` (final do arquivo):

```typescript
// POST /api/dashboards/comercial/gasto-marketing — lança/atualiza o gasto de um mês+canal
router.post('/gasto-marketing', async (req: Request, res: Response) => {
  const { mes_referencia, canal, valor } = req.body || {};
  if (!mes_referencia || !CANAIS.includes(canal)) {
    res.status(400).json({ error: 'Informe mês e um canal válido' });
    return;
  }
  const valorNum = Number(valor);
  if (!Number.isFinite(valorNum) || valorNum < 0) {
    res.status(400).json({ error: 'Informe um valor válido' });
    return;
  }
  const userId = (req as any).user.id;
  await db.query(
    `INSERT INTO gasto_marketing (mes_referencia, canal, valor, created_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), created_by = VALUES(created_by)`,
    [mes_referencia, canal, valorNum, userId]
  );
  res.json({ success: true });
});

// GET /api/dashboards/comercial/gasto-marketing?mes=YYYY-MM — lançamentos do mês
router.get('/gasto-marketing', async (req: Request, res: Response) => {
  const mes = String(req.query.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    res.status(400).json({ error: 'Informe o mês no formato YYYY-MM' });
    return;
  }
  const [rows] = await db.query(
    `SELECT canal, valor FROM gasto_marketing WHERE DATE_FORMAT(mes_referencia, '%Y-%m') = ?`,
    [mes]
  ) as any;
  res.json(rows);
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test tests/dashboardComercialGastoMarketing.test.mjs`
Expected: PASS — 3/3 testes.

- [ ] **Step 5: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de pass/fail/skip de antes desta task, mais os 3 novos testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dashboards/comercial.ts tests/dashboardComercialGastoMarketing.test.mjs
git commit -m "feat: rotas de lançamento de gasto de marketing (POST/GET)"
```

---

### Task 3: Rota de cálculo — custo por cliente adquirido

**Files:**
- Modify: `src/routes/dashboards/comercial.ts`
- Test: `tests/dashboardComercialCustoAquisicao.test.mjs` (novo)

**Interfaces:**
- Consumes: nada de outras tasks deste plano além de `gasto_marketing` (Task 1, schema) — a query roda contra `leads` e `gasto_marketing` diretamente, sem depender das rotas da Task 2.
- Produces: `calcularCustoAquisicao(gastos: {canal: string; valor: number}[], clientesPorCanal: {canal: string; total: number}[]): {canal: string; gasto: number; clientes: number; custo_por_cliente: number | null}[]` — função pura exportada, testável isoladamente. `custo_por_cliente` é `null` quando `clientes = 0` (em vez de `Infinity`), sinalizando "nenhum cliente fechado ainda esse mês" — não é 0 (que significaria "grátis"), nem um número (que seria matematicamente errado).
- Produces também: rota `GET /api/dashboards/comercial/custo-aquisicao?mes=YYYY-MM`, que roda as duas queries e chama `calcularCustoAquisicao` — usada pela Task 4 (frontend).

- [ ] **Step 1: Escrever o teste falho**

Criar `tests/dashboardComercialCustoAquisicao.test.mjs`:

```javascript
// tests/dashboardComercialCustoAquisicao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/dashboards/comercial.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { calcularCustoAquisicao } = await import('../dist/routes/dashboards/comercial.js');

test('calcula custo por cliente corretamente quando há gasto e clientes', () => {
  const gastos = [{ canal: 'Meta Ads', valor: 900 }];
  const clientesPorCanal = [{ canal: 'Meta Ads', total: 3 }];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.length, 1);
  assert.equal(r[0].canal, 'Meta Ads');
  assert.equal(r[0].gasto, 900);
  assert.equal(r[0].clientes, 3);
  assert.equal(r[0].custo_por_cliente, 300, '900/3 = 300');
});

test('canal orgânico sem gasto aparece com gasto=0, não é omitido', () => {
  const gastos = [];
  const clientesPorCanal = [{ canal: 'Indicação', total: 5 }];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.length, 1);
  assert.equal(r[0].gasto, 0);
  assert.equal(r[0].custo_por_cliente, 0, 'gasto 0 com clientes > 0 => custo 0, é o canal mais barato');
});

test('canal com gasto mas zero clientes fechados no mês: custo_por_cliente é null, não Infinity', () => {
  const gastos = [{ canal: 'Google Ads', valor: 500 }];
  const clientesPorCanal = [];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.length, 1);
  assert.equal(r[0].canal, 'Google Ads');
  assert.equal(r[0].gasto, 500);
  assert.equal(r[0].clientes, 0);
  assert.equal(r[0].custo_por_cliente, null, 'sem cliente nenhum, não dá pra calcular custo — null, não Infinity');
});

test('canal que aparece nos dois lados (gasto e clientes) não duplica linha', () => {
  const gastos = [{ canal: 'Meta Ads', valor: 900 }];
  const clientesPorCanal = [{ canal: 'Meta Ads', total: 3 }];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.filter((x) => x.canal === 'Meta Ads').length, 1);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx tsc && node --test tests/dashboardComercialCustoAquisicao.test.mjs`
Expected: FAIL — `calcularCustoAquisicao` não existe em `comercial.ts` ainda.

- [ ] **Step 3: Implementar a função e a rota**

Em `src/routes/dashboards/comercial.ts`, adicionar a função exportada logo após `calcularRentabilidadeArea` (já existente neste arquivo):

```typescript
export function calcularCustoAquisicao(
  gastos: { canal: string; valor: number }[],
  clientesPorCanal: { canal: string; total: number }[]
) {
  const gastoPorCanal: Record<string, number> = {};
  for (const g of gastos) gastoPorCanal[g.canal] = Number(g.valor) || 0;

  const clientesPorCanalMap: Record<string, number> = {};
  for (const c of clientesPorCanal) clientesPorCanalMap[c.canal] = c.total;

  const canaisEnvolvidos = new Set([...Object.keys(gastoPorCanal), ...Object.keys(clientesPorCanalMap)]);

  return Array.from(canaisEnvolvidos).map((canal) => {
    const gasto = gastoPorCanal[canal] || 0;
    const clientes = clientesPorCanalMap[canal] || 0;
    const custo_por_cliente = clientes > 0 ? Math.round((gasto / clientes) * 100) / 100 : null;
    return { canal, gasto, clientes, custo_por_cliente };
  });
}
```

Adicionar a rota logo após `router.get('/gasto-marketing', ...)` (Task 2) e antes de `export default router;`:

```typescript
// GET /api/dashboards/comercial/custo-aquisicao?mes=YYYY-MM — custo por cliente adquirido, por canal
router.get('/custo-aquisicao', async (req: Request, res: Response) => {
  const mes = String(req.query.mes || '');
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    res.status(400).json({ error: 'Informe o mês no formato YYYY-MM' });
    return;
  }
  const userId = (req as any).user.id;

  const [gastos] = await db.query(
    `SELECT canal, valor FROM gasto_marketing WHERE DATE_FORMAT(mes_referencia, '%Y-%m') = ?`,
    [mes]
  ) as any;

  const [clientesPorCanal] = await db.query(
    `SELECT COALESCE(NULLIF(source,''),'Outro') AS canal, COUNT(*) AS total
       FROM leads
      WHERE user_id = ? AND status IN ('fechada','convertido') AND DATE_FORMAT(updated_at, '%Y-%m') = ?
      GROUP BY canal`,
    [userId, mes]
  ) as any;

  res.json(calcularCustoAquisicao(gastos, clientesPorCanal));
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsc && node --test tests/dashboardComercialCustoAquisicao.test.mjs`
Expected: PASS — 4/4 testes.

- [ ] **Step 5: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de pass/fail/skip de antes desta task, mais os 4 novos testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dashboards/comercial.ts tests/dashboardComercialCustoAquisicao.test.mjs
git commit -m "feat: rota e cálculo de custo por cliente adquirido, por canal"
```

---

### Task 4: Formulário de lançamento + tabela de resultado (frontend)

**Files:**
- Modify: `public/app.js` (função `dashComercial`)

**Interfaces:**
- Consumes: `CANAIS` (precisa existir também no frontend — replicar como constante local, já que `public/app.js` não importa de `src/services/`), `GET /api/dashboards/comercial/gasto-marketing?mes=`, `POST /api/dashboards/comercial/gasto-marketing`, `GET /api/dashboards/comercial/custo-aquisicao?mes=` — produzidas pelas Tasks 2 e 3.

- [ ] **Step 1: Adicionar a constante `CANAIS_MKT` e a seção ao template de `dashComercial`**

Em `public/app.js`, adicionar a constante de canais próxima de `LEGAL_AREA_PT` (já existente, logo acima de `dashComercial`):

```javascript
const CANAIS_MKT = ['Meta Ads', 'Google Ads', 'Instagram (orgânico)', 'Facebook (orgânico)', 'Google (orgânico)', 'WhatsApp', 'Indicação', 'Site (direto)', 'E-mail', 'Outro'];
```

Localizar `dashComercial` (função já editada por dois planos anteriores). Ela hoje é `async function dashComercial(c) { ... }` e busca só `GET /api/dashboards/comercial` no início. Trocar para buscar também o gasto e o custo do mês atual em paralelo:

Código atual (a localizar, início da função):
```javascript
async function dashComercial(c) {
  const d = await api('/api/dashboards/comercial');
```

Código novo (substitui as duas linhas acima):
```javascript
async function dashComercial(c) {
  const mesAtual = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [d, gastoLancado, custoAquisicao] = await Promise.all([
    api('/api/dashboards/comercial'),
    api(`/api/dashboards/comercial/gasto-marketing?mes=${mesAtual}`).catch(() => []),
    api(`/api/dashboards/comercial/custo-aquisicao?mes=${mesAtual}`).catch(() => []),
  ]);
  const gastoPorCanal = Object.fromEntries((gastoLancado || []).map((g) => [g.canal, g.valor]));
```

Depois, localizar o final do template (onde `miniList` de campanhas fecha a template string):

Código atual (a localizar):
```javascript
    ${miniList('Campanhas (leads com utm_campaign)', (d.por_campanha || []).map((cp) =>
      `<div class="mini-row"><span>${esc(cp.campanha)}<br><small>${esc(cp.origem)}</small></span>
        <span>${cp.total} lead${cp.total == 1 ? '' : 's'}${Number(cp.convertidos) ? ` · <strong style="color:var(--green)">${cp.convertidos} convertido${cp.convertidos == 1 ? '' : 's'}</strong>` : ''}</span></div>`
    ))}`;
}
```

Código novo (substitui o bloco acima, adicionando a seção de custo de aquisição antes do `}` de fechamento da função):
```javascript
    ${miniList('Campanhas (leads com utm_campaign)', (d.por_campanha || []).map((cp) =>
      `<div class="mini-row"><span>${esc(cp.campanha)}<br><small>${esc(cp.origem)}</small></span>
        <span>${cp.total} lead${cp.total == 1 ? '' : 's'}${Number(cp.convertidos) ? ` · <strong style="color:var(--green)">${cp.convertidos} convertido${cp.convertidos == 1 ? '' : 's'}</strong>` : ''}</span></div>`
    ))}
    <div class="card" style="margin-top:20px;padding:18px">
      <strong style="color:var(--navy)">Custo por cliente adquirido — ${mesAtual}</strong>
      <form id="gasto-mkt-form" class="form-grid" style="margin-top:12px">
        <div class="form-row">
          <label>Canal<select name="canal">${CANAIS_MKT.map((ch) => `<option value="${ch}">${ch}</option>`).join('')}</select></label>
          <label>Gasto no mês (R$)<input type="number" name="valor" step="0.01" min="0" placeholder="0,00" /></label>
        </div>
        <button type="submit" class="btn-sm">Lançar gasto</button>
      </form>
      ${miniList('Resultado do mês', (custoAquisicao || []).map((r) =>
        `<div class="mini-row"><span>${esc(r.canal)}<br><small>${r.clientes} cliente${r.clientes === 1 ? '' : 's'} adquirido${r.clientes === 1 ? '' : 's'}</small></span>
          <span>${money(r.gasto)}<br><small>${r.custo_por_cliente == null ? 'sem cliente ainda' : `custo ${money(r.custo_por_cliente)}/cliente`}</small></span></div>`
      ))}
    </div>`;
  const gastoForm = c.querySelector('#gasto-mkt-form');
  if (gastoForm) {
    gastoForm.onsubmit = async (e) => {
      e.preventDefault();
      const canal = gastoForm.querySelector('[name=canal]').value;
      const valor = gastoForm.querySelector('[name=valor]').value;
      try {
        await api('/api/dashboards/comercial/gasto-marketing', {
          method: 'POST',
          body: JSON.stringify({ mes_referencia: `${mesAtual}-01`, canal, valor }),
        });
        toast('Gasto lançado');
        dashComercial(c);
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}
```

(nota: o `c.innerHTML = ...` precisa terminar antes do `gastoForm = c.querySelector(...)`, já que `querySelector` só encontra o formulário depois que o HTML foi inserido no DOM — confirme, ao editar, que a atribuição de `c.innerHTML` continua sendo a única grande template string da função, terminando no `</div>` do card novo, com o `;` de fechamento do template ANTES do bloco `const gastoForm = ...`.)

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check public/app.js`
Expected: sem erro.

- [ ] **Step 3: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de antes desta task (esta task só toca `public/app.js`, não deveria adicionar/remover nenhum teste).

- [ ] **Step 4: Teste manual no navegador (best-effort)**

Se houver servidor local rodando neste ambiente: abrir o painel Comercial, confirmar que a seção "Custo por cliente adquirido" aparece com o formulário de lançamento e a lista de resultado (mesmo vazia inicialmente). Lançar um gasto de teste para um canal e confirmar que a lista atualiza sem recarregar a página inteira (o `dashComercial(c)` chamado no fim do `onsubmit` já cuida disso). Se não houver servidor local disponível, documentar como pendência no relatório.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: formulário de lançamento + tabela de custo por cliente adquirido (frontend)"
```

---

## Self-Review

**1. Cobertura da spec:**
- Decisão 1 (lançamento manual, sem integração Meta/Google Ads) → nenhuma task chama API externa; tudo via formulário próprio. ✅
- Decisão 2 (tela dentro do painel Comercial) → Task 4 insere a seção em `dashComercial`, não cria rota/tela separada. ✅
- Decisão 3 (canais orgânicos aparecem com R$0, não omitidos) → `calcularCustoAquisicao` (Task 3) usa `Set` de todos os canais envolvidos (gasto OU clientes), garantindo que um canal só com clientes (sem gasto lançado) apareça com `gasto: 0`. Testado explicitamente. ✅
- "UNIQUE KEY evita duplicidade, upsert atualiza" → Task 1 (schema) + Task 2 (`ON DUPLICATE KEY UPDATE`, testado). ✅
- "Canal com gasto mas zero clientes não gera erro de divisão" → Task 3, `custo_por_cliente: null` quando `clientes = 0`, testado explicitamente (não `Infinity`/`NaN`). ✅
- Testes da spec (upsert, R$0 pra canal sem gasto, divisão por zero) → cobertos nas Tasks 2 e 3.
- Fora de escopo (integração automática, comparação histórica entre meses, atribuição multi-touch) → nenhuma task implementa isso; o cálculo é sempre de um mês por vez, usando `leads.source` (atribuição de primeiro contato, já gravada no momento da criação do lead). ✅

**2. Placeholder scan:** nenhum "TBD"/"adicionar validação"/código incompleto — a nota ao implementador na Task 4 (sobre a ordem entre `c.innerHTML` e `querySelector`) é uma instrução de precisão, não um placeholder de conteúdo.

**3. Consistência de tipos:**
- `calcularCustoAquisicao` (Task 3, produtor) retorna `{canal, gasto, clientes, custo_por_cliente}[]`, consumido em Task 4 com os mesmos 4 nomes de campo.
- `CANAIS` (backend, `leadChannel.ts`, consumida pela Task 2) e `CANAIS_MKT` (frontend, Task 4, réplica local dos mesmos 10 valores — já que `public/app.js` não importa módulos de `src/`) usam exatamente os mesmos 10 nomes de canal, na mesma ordem.
- `mes_referencia` sempre no formato `YYYY-MM-01` (primeiro dia do mês) tanto no `POST` (Task 2) quanto no envio do frontend (Task 4, `${mesAtual}-01`); `mes` (query string de `GET`) sempre `YYYY-MM`, consistente nas Tasks 2, 3 e 4.
