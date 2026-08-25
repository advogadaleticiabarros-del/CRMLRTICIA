# Rentabilidade por Área de Atuação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Padronizar o campo de área jurídica no schema de `propostas`/`leads` (hoje `VARCHAR` livre no banco, embora o frontend já use `<select>`) e adicionar receita total + receita média por caso por área ao painel Comercial.

**Architecture:** Migration converte `propostas.legal_area`/`leads.legal_area` de `VARCHAR` para o mesmo ENUM de 7 valores que `cases.legal_area` já usa. Backend ganha validação de `legal_area` em `propostas.ts` (que hoje não valida, ao contrário de `leads.ts`, que já valida). Novo campo `rentabilidade_area` na resposta de `GET /api/dashboards/comercial`, calculado via `LEFT JOIN` entre `cases` e `installments` pagas. Frontend ganha uma seção nova em `dashComercial` — sem trocar nenhum componente de formulário, porque `propostaForm` e `leadForm` já renderizam `<select>` para área (achado da exploração de código, corrige a spec original).

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM). Testes com `node --test` contra `dist/` compilado (`npx tsc` primeiro). Frontend vanilla JS sem build step.

## Global Constraints

- As 7 opções fixas de área: `trabalhista, gestante, familia, civel, previdenciario, consumidor, outro` (mesma lista de `cases.legal_area`, `src/routes/leads.ts:22`, e `AREAS`/`public/app.js:5454`).
- Propostas/leads já existentes com valor de área fora da lista NÃO são migrados/reescritos automaticamente — ficam com o valor antigo até serem editados de novo (spec, decisão 2).
- Receita usa exclusivamente `installments` com `status = 'pago'` — mesma fonte que `dashboards/cliente.ts` já usa (spec, arquitetura). Não usar `financial_records` (que já tem seu próprio `resultado_por_area` em `dashboards/financeiro.ts:117-125`, calculado com fonte e propósito diferentes — não confundir os dois).
- Painel mostra receita total E receita média por caso por área (spec, decisão 3).
- Fora de escopo: migrar dados antigos, rentabilidade por advogado/responsável, considerar `financial_records` avulsos (spec, seção Fora de escopo).

**Divergências corrigidas contra a spec original** (confirmadas lendo o código real antes de escrever este plano):
1. A spec assumia que `propostaForm` e `leadForm` usam campo de texto livre para área. **Falso**: ambos já renderizam `<select>` (`public/app.js:5536` para lead, `public/app.js:5758` para proposta), usando a constante `AREAS` (`public/app.js:5454`) — a mesma função `field(label, name, {options})` (linha 5447-5453) sempre gera `<select>` quando recebe `options`, nunca texto livre. **Não há nenhuma mudança de frontend de formulário neste plano** — o problema é só o schema do banco (`VARCHAR` aceita qualquer string) e a validação de backend, não a UI.
2. `src/routes/leads.ts` **já valida** `legal_area` contra uma constante `AREAS` local (`leads.ts:22,131,174`) — grava `null` se o valor não bater. `src/routes/propostas.ts` **não valida** (`propostas.ts:101,138`) — aceita qualquer string no `POST` e `PUT`. A task de backend deste plano é replicar essa validação em `propostas.ts`, não criar do zero.
3. O endpoint novo fica em `src/routes/dashboards/comercial.ts` (não em `financeiro.ts`) — `financeiro.ts:117-125` já tem um `resultado_por_area`, mas com fonte (`financial_records`) e propósito (resultado financeiro geral, não "rentabilidade de caso") diferentes. Colocar o novo cálculo lá criaria confusão entre dois campos parecidos na mesma resposta; `comercial.ts` é onde leads/propostas já são tratados e é consistente com a decisão da spec de manter isso perto da análise comercial.
4. Próximo número de migration livre: `100` (a última existente é `099_asaas_invoice_url.sql`).

---

### Task 1: Migration — padroniza `legal_area` em propostas e leads

**Files:**
- Create: `migrations/100_padroniza_legal_area.sql`

**Interfaces:**
- Produces: `propostas.legal_area` e `leads.legal_area` como `ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro')`, nullable — usado pela Task 2 (validação de backend) e Task 3 (query de rentabilidade).

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- Migration 100 — Padroniza legal_area em propostas e leads
-- Mesma lista de 7 valores que cases.legal_area já usa (migrations/001_base_schema.sql).
-- O frontend (propostaForm, leadForm) já só permite esses valores via <select> —
-- esta migration alinha o schema do banco com o que a UI já garante. Valores
-- antigos gravados fora da lista (ex: por importação direta na API, sem passar
-- pelo formulário) viram NULL na conversão — não é migração de dados, é
-- padronização de schema (decisão explícita: não reescrever dado antigo).

ALTER TABLE propostas
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;

ALTER TABLE leads
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;
```

- [ ] **Step 2: Commit**

```bash
git add migrations/100_padroniza_legal_area.sql
git commit -m "feat: padroniza legal_area (ENUM) em propostas e leads"
```

Nota: esta migration só é validada de verdade no deploy real (VPS), seguindo o padrão já estabelecido no projeto — **não rode `npm run migrate` localmente nem configure acesso a banco real neste ambiente**. A sintaxe SQL é a única coisa a conferir visualmente antes de commitar.

---

### Task 2: Validação de `legal_area` em `propostas.ts`

**Files:**
- Modify: `src/routes/propostas.ts:1-14` (constantes no topo), `:76-119` (`POST /`), `:122-145` (`PUT /:id`)
- Test: `tests/propostasLegalArea.test.mjs` (novo)

**Interfaces:**
- Consumes: nenhuma interface de outra task (a migration da Task 1 é sobre o schema do banco; este código roda igual com ou sem ela aplicada — a validação em memória é independente).
- Produces: rejeita silenciosamente (grava `null`) qualquer `legal_area` fora das 7 opções, tanto em `POST /api/propostas` quanto `PUT /api/propostas/:id` — mesmo comportamento que `leads.ts` já tem.

- [ ] **Step 1: Escrever o teste falho**

Criar `tests/propostasLegalArea.test.mjs` — testes de auditoria estática (regex sobre o texto-fonte), seguindo o mesmo padrão já usado em `tests/asaasWebhook.test.mjs` deste repositório para validar lógica sem precisar de banco real:

```javascript
// tests/propostasLegalArea.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('propostas.ts define LEGAL_AREAS com as mesmas 7 opções de cases.legal_area', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/const LEGAL_AREAS\s*=\s*\[[^\]]+\]/);
  assert.ok(m, 'LEGAL_AREAS não encontrada em propostas.ts');
  for (const area of ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro']) {
    assert.match(m[0], new RegExp(`'${area}'`), `área "${area}" ausente de LEGAL_AREAS`);
  }
});

test('POST /api/propostas valida legal_area contra LEGAL_AREAS antes do INSERT', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/'[\s\S]*?\}\);/);
  assert.ok(m, 'rota POST / não encontrada');
  assert.match(m[0], /LEGAL_AREAS\.includes\(legal_area\)/, 'POST precisa validar legal_area contra LEGAL_AREAS antes de gravar');
});

test('PUT /api/propostas/:id valida legal_area contra LEGAL_AREAS via setIf', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.put\('\/:id'[\s\S]*?setIf\('legal_area'[^)]*\)/);
  assert.ok(m, "setIf('legal_area', ...) não encontrado na rota PUT /:id");
  assert.match(m[0], /LEGAL_AREAS\.includes\(req\.body\.legal_area\)/, "setIf('legal_area', ...) precisa validar contra LEGAL_AREAS");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test tests/propostasLegalArea.test.mjs`
Expected: FAIL — `LEGAL_AREAS` não existe em `propostas.ts` ainda, e nenhuma validação está presente.

- [ ] **Step 3: Adicionar `LEGAL_AREAS` e validar nas duas rotas**

Em `src/routes/propostas.ts`, adicionar a constante logo após `PAYMENT_GATEWAY_METHODS` (linha 14 atual):

```typescript
const PAYMENT_GATEWAY_METHODS = ['pix', 'asaas_boleto', 'asaas_cartao_avista', 'asaas_cartao_recorrente'];
const LEGAL_AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
```

Na rota `POST /` (linha 76-119 atual), adicionar a validação logo após `finalPaymentGatewayMethod` (linha 83 atual):

```typescript
  const finalPaymentGatewayMethod = PAYMENT_GATEWAY_METHODS.includes(payment_gateway_method) ? payment_gateway_method : 'pix';
  const finalLegalArea = LEGAL_AREAS.includes(legal_area) ? legal_area : null;
```

E trocar `legal_area ?? null` (linha 101 atual, dentro do array de parâmetros do `INSERT`) por `finalLegalArea`:

```typescript
      legal_area: removido daqui — usar finalLegalArea no lugar exato onde "legal_area ?? null," aparecia hoje
```

(nota para o implementador: a linha 101 atual tem vários campos na mesma linha — `legal_area ?? null, tipo_causa ?? null, ...` — troque apenas o primeiro trecho `legal_area ?? null` por `finalLegalArea`, mantendo os demais campos da linha intocados.)

Na rota `PUT /:id` (linha 122-145 atual), trocar a linha `setIf('legal_area', req.body.legal_area);` (linha 138 atual) por:

```typescript
  setIf('legal_area', req.body.legal_area, LEGAL_AREAS.includes(req.body.legal_area));
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test tests/propostasLegalArea.test.mjs`
Expected: PASS — 3/3 testes.

- [ ] **Step 5: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de pass/fail/skip de antes desta task, mais os 3 novos testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/routes/propostas.ts tests/propostasLegalArea.test.mjs
git commit -m "feat: valida legal_area em propostas.ts (mesmo padrão de leads.ts)"
```

---

### Task 3: Endpoint de rentabilidade por área

**Files:**
- Modify: `src/routes/dashboards/comercial.ts`
- Test: `tests/dashboardComercialRentabilidade.test.mjs` (novo)

**Interfaces:**
- Produces: campo `rentabilidade_area: { legal_area: string; total_casos: number; receita_total: number; receita_media_caso: number }[]` na resposta de `GET /api/dashboards/comercial` — usado pela Task 4 (frontend).
- Consumes: nada de outras tasks deste plano (query independente; roda igual com ou sem a migration da Task 1 aplicada, já que `cases.legal_area` já é ENUM desde `001_base_schema.sql`).

- [ ] **Step 1: Escrever o teste falho**

`calcularRentabilidadeArea` é lógica pura o suficiente para testar sem banco (recebe as linhas já agregadas do SQL e só calcula a média, protegendo contra divisão por zero) — separar essa parte da query em uma função testável, seguindo o mesmo padrão de `calcularFunilConversao` já usado neste mesmo arquivo (plano anterior, `docs/superpowers/plans/2026-08-24-funil-comercial-taxa-conversao.md`).

Criar `tests/dashboardComercialRentabilidade.test.mjs`:

```javascript
// tests/dashboardComercialRentabilidade.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/dashboards/comercial.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { calcularRentabilidadeArea } = await import('../dist/routes/dashboards/comercial.js');

test('calcula receita média por caso corretamente', () => {
  const linhas = [
    { legal_area: 'trabalhista', total_casos: 4, receita_total: 8000 },
    { legal_area: 'familia', total_casos: 2, receita_total: 9000 },
  ];
  const r = calcularRentabilidadeArea(linhas);
  assert.equal(r.length, 2);
  assert.equal(r[0].receita_media_caso, 2000, '8000/4 = 2000');
  assert.equal(r[1].receita_media_caso, 4500, '9000/2 = 4500');
});

test('área sem nenhum caso (total_casos=0) não gera divisão por zero', () => {
  const linhas = [{ legal_area: 'consumidor', total_casos: 0, receita_total: 0 }];
  const r = calcularRentabilidadeArea(linhas);
  assert.equal(r[0].receita_media_caso, 0, 'sem casos, média é 0, não NaN/Infinity');
});

test('preserva receita_total e total_casos sem alteração', () => {
  const linhas = [{ legal_area: 'civel', total_casos: 3, receita_total: 4500 }];
  const r = calcularRentabilidadeArea(linhas);
  assert.equal(r[0].legal_area, 'civel');
  assert.equal(r[0].total_casos, 3);
  assert.equal(r[0].receita_total, 4500);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx tsc && node --test tests/dashboardComercialRentabilidade.test.mjs`
Expected: FAIL — `calcularRentabilidadeArea` não existe em `comercial.ts` ainda.

- [ ] **Step 3: Implementar a função e integrar na rota**

Em `src/routes/dashboards/comercial.ts`, adicionar a função exportada logo após `calcularFunilConversao` (já existente neste arquivo desde o plano do funil):

```typescript
export function calcularRentabilidadeArea(
  linhas: { legal_area: string; total_casos: number; receita_total: number }[]
) {
  return linhas.map((l) => ({
    legal_area: l.legal_area,
    total_casos: l.total_casos,
    receita_total: l.receita_total,
    receita_media_caso: l.total_casos > 0 ? Math.round((l.receita_total / l.total_casos) * 100) / 100 : 0,
  }));
}
```

Dentro do handler da rota `router.get('/', async (req, res) => { ... })`, adicionar a query e o cálculo (posicionar logo após o bloco que já popula `funil_conversao`, se presente, ou após `leadsPorStatus` caso contrário):

```typescript
    const [rentabilidadeRows] = await db.query(`
      SELECT c.legal_area, COUNT(DISTINCT c.id) AS total_casos, COALESCE(SUM(i.valor), 0) AS receita_total
      FROM cases c
      LEFT JOIN installments i ON i.case_id = c.id AND i.status = 'pago'
      WHERE c.user_id = ? AND c.legal_area IS NOT NULL
      GROUP BY c.legal_area
      ORDER BY receita_total DESC
    `, [userId]) as any;
    const rentabilidade_area = calcularRentabilidadeArea(rentabilidadeRows);
```

E adicionar `rentabilidade_area` ao objeto `res.json({...})` existente:

```typescript
      rentabilidade_area,
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsc && node --test tests/dashboardComercialRentabilidade.test.mjs`
Expected: PASS — 3/3 testes.

- [ ] **Step 5: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de pass/fail/skip de antes desta task, mais os 3 novos testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dashboards/comercial.ts tests/dashboardComercialRentabilidade.test.mjs
git commit -m "feat: rentabilidade por área (receita total + média por caso) no dashboard comercial"
```

---

### Task 4: Seção de rentabilidade no painel Comercial (frontend)

**Files:**
- Modify: `public/app.js` (função `dashComercial`)

**Interfaces:**
- Consumes: `rentabilidade_area: {legal_area, total_casos, receita_total, receita_media_caso}[]` — campo novo da resposta de `GET /api/dashboards/comercial`, produzido pela Task 3.

- [ ] **Step 1: Adicionar a seção ao template de `dashComercial`**

Em `public/app.js`, localizar `dashComercial` (mesma função editada pelo plano anterior — o funil comercial). Ela hoje termina o template com o `miniList` de campanhas. Adicionar uma nova seção logo após o bloco `dash-2col` (origem/área de leads) e antes do `miniList` de campanhas — usando o mesmo padrão visual de `chartHBars`/`chartCard` já usado no resto da função:

Localizar o trecho:
```javascript
    <div class="dash-2col">
      ${chartCard('Leads por origem', chartHBars((d.por_origem || []).map((r) => ({ label: r.origem, value: r.total }))))}
      ${chartCard('Leads por área jurídica', chartHBars((d.por_area || []).map((r) => ({ label: r.area, value: r.total }))))}
    </div>
    ${miniList('Campanhas (leads com utm_campaign)', (d.por_campanha || []).map((cp) =>
```

E inserir a nova seção entre o `</div>` do `dash-2col` e o `${miniList(...)}`:

```javascript
    <div class="dash-2col">
      ${chartCard('Leads por origem', chartHBars((d.por_origem || []).map((r) => ({ label: r.origem, value: r.total }))))}
      ${chartCard('Leads por área jurídica', chartHBars((d.por_area || []).map((r) => ({ label: r.area, value: r.total }))))}
    </div>
    ${miniList('Rentabilidade por área (receita paga)', (d.rentabilidade_area || []).map((r) =>
      `<div class="mini-row"><span>${LEGAL_AREA_PT[r.legal_area] || r.legal_area}<br><small>${r.total_casos} caso${r.total_casos === 1 ? '' : 's'}</small></span>
        <span>${money(r.receita_total)}<br><small>média ${money(r.receita_media_caso)}/caso</small></span></div>`
    ))}
    ${miniList('Campanhas (leads com utm_campaign)', (d.por_campanha || []).map((cp) =>
```

Adicionar também a constante `LEGAL_AREA_PT` (nomes em português para exibição), próxima de `LEAD_STATUS_PT` (já existente no arquivo, logo acima de `dashComercial`):

```javascript
const LEGAL_AREA_PT = { trabalhista: 'Trabalhista', gestante: 'Gestante/Maternidade', familia: 'Família', civel: 'Cível', previdenciario: 'Previdenciário', consumidor: 'Consumidor', outro: 'Outro' };
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check public/app.js`
Expected: sem erro.

- [ ] **Step 3: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de antes desta task (esta task só toca `public/app.js`, não deveria adicionar/remover nenhum teste).

- [ ] **Step 4: Teste manual no navegador (best-effort)**

Se houver servidor local rodando neste ambiente: abrir o painel Comercial e confirmar visualmente que a seção "Rentabilidade por área" aparece com receita total e média por caso para cada área que tem ao menos um caso. Se não houver servidor local disponível, documentar como pendência no relatório em vez de tentar configurar banco/servidor.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: seção de rentabilidade por área no painel Comercial (frontend)"
```

---

## Self-Review

**1. Cobertura da spec:**
- Decisão 1 (padronizar pra ENUM fixo nas 3 tabelas) → Task 1 (migration). `cases.legal_area` já é ENUM desde `001_base_schema.sql`, não precisa de migration própria — só `propostas`/`leads` precisavam. ✅
- Decisão 2 (não migrar dados antigos automaticamente) → Task 1 explicitamente não faz `UPDATE` de dados, só `ALTER TABLE MODIFY COLUMN` (valores fora do ENUM viram NULL pelo próprio MySQL, comportamento documentado no comentário da migration). ✅
- Decisão 3 (receita total E média por caso) → Task 3 `calcularRentabilidadeArea` retorna ambos os campos; Task 4 exibe os dois. ✅
- "Query já especificada usando installments pagas" → Task 3 usa exatamente `LEFT JOIN installments ... AND i.status = 'pago'`, mesma fonte de `dashboards/cliente.ts`. ✅
- "Troca dos 2 formulários existentes de texto livre pra `<select>`" → **não aplicável**: ambos os formulários já são `<select>` (achado de exploração, documentado na seção de divergências). Nenhuma task de frontend de formulário foi criada, e isso está corretamente justificado no plano, não é uma omissão. ✅
- Testes da spec (migration aplica ENUM, valores fora viram NULL; query não gera divisão por zero; formulários usam select) → Tasks 1-3 cobrem os dois primeiros; o terceiro já era verdade antes deste plano (confirmado por leitura de código, não precisa de teste novo).
- Fora de escopo (migrar dados antigos, rentabilidade por advogado, financial_records avulsos) → nenhuma task toca nisso. ✅

**2. Placeholder scan:** nenhum "TBD"/"adicionar validação"/código incompleto — a única nota ao implementador (Task 2, Step 3, sobre a linha 101 com múltiplos campos) é uma instrução de localização precisa, não um placeholder de conteúdo.

**3. Consistência de tipos:** `calcularRentabilidadeArea` (Task 3, produtor) devolve `{legal_area, total_casos, receita_total, receita_media_caso}[]`, consumida em Task 4 com os mesmos 4 nomes de campo. `LEGAL_AREAS` (Task 2, backend) e `LEGAL_AREA_PT`/`AREAS` (Task 4, frontend já existente) usam a mesma lista de 7 valores em todos os pontos.
