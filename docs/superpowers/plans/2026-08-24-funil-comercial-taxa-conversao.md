# Funil Comercial com Taxa de Conversão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar taxa de conversão entre etapas ao funil comercial que já existe no painel Comercial, sem criar tabela nova nem painel novo.

**Architecture:** Uma função pura nova em `src/routes/dashboards/comercial.ts` calcula a taxa de conversão etapa-a-etapa a partir do `leads_por_status` que a rota já devolve; o resultado (`funil_conversao`) é adicionado à resposta JSON existente sem remover nada. No frontend, `dashComercial` (`public/app.js`) passa a mostrar a taxa ao lado de cada barra do funil e um contador de "leads sem avanço" (desfechos separados: perdidos, convertidos/fechados, newsletter).

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM). Testes com `node --test` contra `dist/` compilado (`npx tsc` primeiro). Frontend vanilla JS sem build step.

## Global Constraints

- Cálculo usa exclusivamente `leads.status` — nenhuma tabela nova, nenhuma migration (spec, decisão 3).
- A taxa de conversão entra no mesmo painel Comercial já existente (`dashComercial`), não é um painel novo (spec, decisão 1).
- `leads_por_status` (usado hoje só para o funil, mas presente na resposta da API) deve continuar sendo devolvido sem alteração — a mudança é aditiva (spec, seção Testes).
- Fora de escopo: funil por coorte histórica, filtro de período customizável, qualquer mudança em `FUNNEL_ORDER` ou nos status possíveis de `leads` (spec, seção Fora de escopo).

**Divergência corrigida contra a spec original** (confirmada lendo o código real antes de escrever este plano): a spec assumia `leadsPorStatus: Record<string, number>` e só citava `perdida` como "desfecho" a separar do funil. Na realidade:
- `src/routes/dashboards/comercial.ts:23-26` devolve `leads_por_status` como **array** de `{status, total}` (não um objeto chave-valor).
- O ENUM real de `leads.status` (`migrations/093_newsletter_status_lead.sql`) tem, além das 7 etapas ativas do funil, **quatro** valores de desfecho: `fechada`, `convertido`, `perdida`, `newsletter` — não só `perdida`. `fechada`/`convertido` são sinônimos de "virou cliente" (ambos mapeados para "Convertido" em `LEAD_STATUS_PT`, `public/app.js:3840`); `newsletter` é assinante de newsletter, nem sequer participa do funil de triagem (comentário da migration 093 confirma isso explicitamente).
- Este plano ajusta a assinatura da função e a lista de desfechos para bater com a realidade, mantendo a intenção da spec (separar volume de desfecho do cálculo de conversão das etapas ativas).

---

### Task 1: Cálculo de conversão no backend

**Files:**
- Modify: `src/routes/dashboards/comercial.ts`
- Test: `tests/dashboardComercialFunil.test.mjs` (novo)

**Interfaces:**
- Produces: `calcularFunilConversao(leadsPorStatus: { status: string; total: number }[]): { etapas: { status: string; volume: number; taxa_conversao: number | null }[]; desfechos: { fechados: number; perdidos: number; newsletter: number } }` — exportada de `src/routes/dashboards/comercial.ts` para ser testável isoladamente.
- Consumes: nada de outras tasks (task única deste plano).

- [ ] **Step 1: Escrever o teste falho**

Criar `tests/dashboardComercialFunil.test.mjs`:

```javascript
// tests/dashboardComercialFunil.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/dashboards/comercial.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { calcularFunilConversao } = await import('../dist/routes/dashboards/comercial.js');

test('calcula taxa de conversão etapa-a-etapa a partir do volume corrente', () => {
  const leadsPorStatus = [
    { status: 'triagem', total: 40 },
    { status: 'atendimento_inicial', total: 28 },
    { status: 'reuniao', total: 19 },
    { status: 'documentacao_pendente', total: 15 },
    { status: 'proposta', total: 12 },
    { status: 'proposta_em_analise', total: 8 },
    { status: 'contrato_assinado', total: 5 },
  ];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas.length, 7);
  assert.equal(r.etapas[0].status, 'triagem');
  assert.equal(r.etapas[0].volume, 40);
  assert.equal(r.etapas[0].taxa_conversao, null, 'primeira etapa não tem "anterior", taxa é null');
  assert.equal(r.etapas[1].status, 'atendimento_inicial');
  assert.equal(r.etapas[1].volume, 28);
  assert.equal(r.etapas[1].taxa_conversao, 70, '28/40 = 70.0%');
  assert.equal(r.etapas[2].taxa_conversao, 67.9, '19/28 arredondado pra 1 casa decimal');
});

test('etapa com volume anterior zero não gera divisão por zero (taxa fica null)', () => {
  const leadsPorStatus = [
    { status: 'triagem', total: 0 },
    { status: 'atendimento_inicial', total: 0 },
  ];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas[1].taxa_conversao, null);
});

test('etapa ausente do leads_por_status conta como volume 0, não quebra', () => {
  const leadsPorStatus = [{ status: 'triagem', total: 10 }];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas.length, 7);
  assert.equal(r.etapas[1].volume, 0, 'atendimento_inicial ausente vira 0');
  assert.equal(r.etapas[1].taxa_conversao, 0, '0/10 = 0%, não null (volume anterior existe e é > 0)');
});

test('separa os 4 status de desfecho do funil de etapas ativas', () => {
  const leadsPorStatus = [
    { status: 'triagem', total: 10 },
    { status: 'perdida', total: 3 },
    { status: 'fechada', total: 2 },
    { status: 'convertido', total: 1 },
    { status: 'newsletter', total: 50 },
  ];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.equal(r.etapas.length, 7, 'nenhum desfecho entra na lista de etapas ativas');
  assert.ok(!r.etapas.some((e) => ['perdida', 'fechada', 'convertido', 'newsletter'].includes(e.status)));
  assert.deepEqual(r.desfechos, { fechados: 3, perdidos: 3, newsletter: 50 }, 'fechada+convertido somam em "fechados"');
});

test('desfechos ausentes do leads_por_status contam como 0, não undefined', () => {
  const leadsPorStatus = [{ status: 'triagem', total: 10 }];
  const r = calcularFunilConversao(leadsPorStatus);
  assert.deepEqual(r.desfechos, { fechados: 0, perdidos: 0, newsletter: 0 });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx tsc && node --test tests/dashboardComercialFunil.test.mjs`
Expected: FAIL — `dist/routes/dashboards/comercial.js` não exporta `calcularFunilConversao` (ainda não existe).

- [ ] **Step 3: Implementar a função e integrar na rota**

Editar `src/routes/dashboards/comercial.ts`. Adicionar a função exportada logo após os imports (antes de `const router = Router();`), e chamá-la dentro do handler da rota, adicionando `funil_conversao` ao JSON de resposta:

```typescript
import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

// Etapas ativas do funil (espelha FUNNEL_ORDER do frontend, public/app.js:3841).
// Não inclui os 4 status de desfecho do ENUM de leads.status — esses são
// resultados finais (virou cliente, foi perdido, ou é assinante de
// newsletter que nunca entra no funil de triagem), não etapas do funil.
const ETAPAS_FUNIL = [
  'triagem', 'atendimento_inicial', 'reuniao',
  'documentacao_pendente', 'proposta', 'proposta_em_analise', 'contrato_assinado',
];

export function calcularFunilConversao(leadsPorStatus: { status: string; total: number }[]) {
  const porStatus: Record<string, number> = {};
  for (const row of leadsPorStatus) porStatus[row.status] = row.total;

  const etapas = ETAPAS_FUNIL.map((status, i) => {
    const volume = porStatus[status] || 0;
    if (i === 0) return { status, volume, taxa_conversao: null as number | null };
    const volumeAnterior = porStatus[ETAPAS_FUNIL[i - 1]] || 0;
    const taxa = volumeAnterior === 0 ? null : Math.round((volume / volumeAnterior) * 1000) / 10;
    return { status, volume, taxa_conversao: taxa };
  });

  const desfechos = {
    fechados: (porStatus['fechada'] || 0) + (porStatus['convertido'] || 0),
    perdidos: porStatus['perdida'] || 0,
    newsletter: porStatus['newsletter'] || 0,
  };

  return { etapas, desfechos };
}

const router = Router();
```

Depois, dentro do handler `router.get('/', async (req, res) => { ... })`, logo após a query que popula `leadsPorStatus` (linha 23-26 atual), calcular o funil:

```typescript
    const [leadsPorStatus] = await db.query(
      'SELECT status, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY status ORDER BY total DESC',
      [userId]
    ) as any;
    const funil_conversao = calcularFunilConversao(leadsPorStatus);
```

E adicionar `funil_conversao` ao objeto `res.json({...})` existente (logo após `leads_por_status: leadsPorStatus,`):

```typescript
      leads_por_status:    leadsPorStatus,
      funil_conversao,
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsc && node --test tests/dashboardComercialFunil.test.mjs`
Expected: PASS — 5/5 testes.

- [ ] **Step 5: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de pass/fail/skip de antes desta task, mais os 5 novos testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dashboards/comercial.ts tests/dashboardComercialFunil.test.mjs
git commit -m "feat: taxa de conversão etapa-a-etapa no funil comercial (backend)"
```

---

### Task 2: Exibir a taxa de conversão no painel Comercial (frontend)

**Files:**
- Modify: `public/app.js` (função `dashComercial`, linhas 3933-3960 na versão atual)

**Interfaces:**
- Consumes: `funil_conversao.etapas[i].{status,volume,taxa_conversao}` e `funil_conversao.desfechos.{fechados,perdidos,newsletter}` — campos novos da resposta de `GET /api/dashboards/comercial`, produzidos pela Task 1.

- [ ] **Step 1: Editar `dashComercial` para consumir e exibir `funil_conversao`**

Em `public/app.js`, localizar a função `dashComercial` (busque por `async function dashComercial(c) {`). Ela hoje monta `funnelHTML` a partir de `byStatus` (derivado de `d.leads_por_status`) e `FUNNEL_ORDER`. Substituir o bloco de construção do funil para usar `d.funil_conversao` (que já vem na ordem correta de `ETAPAS_FUNIL`, idêntica a `FUNNEL_ORDER`) e mostrar a taxa ao lado de cada barra:

Código atual (a remover):
```javascript
async function dashComercial(c) {
  const d = await api('/api/dashboards/comercial');
  const byStatus = Object.fromEntries((d.leads_por_status || []).map((s) => [s.status, s.total]));
  const maxFunnel = Math.max(1, ...FUNNEL_ORDER.map((k) => byStatus[k] || 0));
  const funnelHTML = FUNNEL_ORDER.map((k) => {
    const n = byStatus[k] || 0;
    return `<div class="funnel-row"><span class="funnel-label">${LEAD_STATUS_PT[k]}</span>
      <div class="funnel-bar"><div class="funnel-fill" style="width:${Math.round((n / maxFunnel) * 100)}%"></div></div>
      <strong class="funnel-num">${n}</strong></div>`;
  }).join('');
```

Código novo (substitui o bloco acima, mesma função `dashComercial`):
```javascript
async function dashComercial(c) {
  const d = await api('/api/dashboards/comercial');
  const funil = d.funil_conversao || { etapas: [], desfechos: { fechados: 0, perdidos: 0, newsletter: 0 } };
  const maxFunnel = Math.max(1, ...funil.etapas.map((e) => e.volume));
  const funnelHTML = funil.etapas.map((e) => {
    const taxaHTML = e.taxa_conversao == null ? '' : `<small class="funnel-taxa">${e.taxa_conversao}%</small>`;
    return `<div class="funnel-row"><span class="funnel-label">${LEAD_STATUS_PT[e.status]}</span>
      <div class="funnel-bar"><div class="funnel-fill" style="width:${Math.round((e.volume / maxFunnel) * 100)}%"></div></div>
      <strong class="funnel-num">${e.volume}</strong>${taxaHTML}</div>`;
  }).join('');
  const desfechosHTML = `<div class="funnel-desfechos" style="margin-top:10px;font-size:12px;color:var(--text-muted)">
    ${funil.desfechos.fechados} convertido${funil.desfechos.fechados === 1 ? '' : 's'} ·
    ${funil.desfechos.perdidos} perdido${funil.desfechos.perdidos === 1 ? '' : 's'} no período
    ${funil.desfechos.newsletter ? ` · ${funil.desfechos.newsletter} assinante${funil.desfechos.newsletter === 1 ? '' : 's'} de newsletter` : ''}
  </div>`;
```

E no template final da função, dentro do card "Funil comercial" (busque por `<strong style="color:var(--navy)">Funil comercial</strong>`), adicionar `desfechosHTML` logo após `funnelHTML`:

Código atual (a localizar e editar):
```javascript
    <div class="card" style="margin-bottom:20px;padding:18px"><strong style="color:var(--navy)">Funil comercial</strong>
      <div class="funnel" style="margin-top:12px">${funnelHTML}</div></div>
```

Código novo:
```javascript
    <div class="card" style="margin-bottom:20px;padding:18px"><strong style="color:var(--navy)">Funil comercial</strong>
      <div class="funnel" style="margin-top:12px">${funnelHTML}</div>${desfechosHTML}</div>
```

O restante da função (`kpi-grid`, `dash-2col`, `miniList` de campanhas) não muda.

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check public/app.js`
Expected: sem erro (arquivo sem build step, só valida sintaxe JS).

- [ ] **Step 3: Teste manual no navegador (best-effort)**

Se houver servidor local rodando neste ambiente: abrir o painel Comercial e confirmar visualmente que cada barra do funil (exceto a primeira, "Novo Lead") mostra uma porcentagem ao lado do número, e que a linha de desfechos aparece abaixo do funil com os totais de convertidos/perdidos/newsletter. Se não houver servidor local disponível no ambiente de implementação, documentar como pendência no relatório em vez de tentar configurar banco/servidor.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: exibe taxa de conversão e desfechos no funil comercial (frontend)"
```

---

## Self-Review

**1. Cobertura da spec:**
- Decisão 1 (mesmo painel, sem painel novo) → Task 2 edita `dashComercial` existente, não cria rota/tela nova. ✅
- Decisão 2 (leads perdidos separados como contador à parte) → Task 1 `desfechos.perdidos` + Task 2 `desfechosHTML`; ampliado corretamente para os 4 status de desfecho reais do ENUM (perdida/fechada/convertido/newsletter), não só perdida, mantendo a intenção da spec. ✅
- Decisão 3 (só `leads.status`, sem tabela nova) → nenhuma migration neste plano. ✅
- Testes da spec (unidade para o cálculo, regressão em `leads_por_status`) → Task 1 Step 1 cobre ambos (`leads_por_status` continua sendo devolvido sem alteração, só `funil_conversao` é adicionado). ✅
- Fora de escopo (coorte histórica, filtro de período, mudança em `FUNNEL_ORDER`) → nenhuma task toca nisso. ✅

**2. Placeholder scan:** nenhum "TBD"/"adicionar validação"/código incompleto encontrado nos steps.

**3. Consistência de tipos:** `calcularFunilConversao` tem a mesma assinatura em Task 1 (produtor) e é consumida via `d.funil_conversao` em Task 2 — os nomes de campo (`etapas`, `volume`, `taxa_conversao`, `desfechos.fechados/perdidos/newsletter`) são idênticos nos dois lugares.
