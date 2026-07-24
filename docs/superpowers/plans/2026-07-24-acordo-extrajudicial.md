# Acordo Extrajudicial (cliente x empresa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o módulo `agreements` (Acordos) para suportar acordos extrajudiciais cliente x empresa: qualificação completa da empresa/advogado da parte contrária, forma de pagamento, fluxo do dinheiro (direto ao cliente ou via escritório com repasse) e geração automática do Termo de Acordo Extrajudicial em papel timbrado.

**Architecture:** Extensão pura de tabelas/rotas/tela já existentes (não é módulo novo). Uma migration adiciona colunas em `agreements`, cria `agreement_client_payouts` (repasse ao cliente, deliberadamente separada de `repasses` que é só para parceiros) e insere um novo `document_templates` com o texto do termo. `src/routes/acordos.ts` ganha os campos novos no create/update e três rotas (repasses, marcar repassado, gerar termo). `public/app.js` ganha campos no formulário e dois botões de ação por linha, reaproveitando o `docViewer` já existente pra visualizar/imprimir/assinar o termo gerado.

**Tech Stack:** Node.js/TypeScript/Express, MySQL2, node:test (funções puras), vanilla JS no front-end (`public/app.js`).

## Global Constraints

- Migrations rodam automaticamente no boot (`src/config/migrations.ts`), aplicadas em ordem numérica — não existe passo manual de "rodar migration localmente". O deploy (`railway up --ci`) já aplica.
- `npm test` roda contra `dist/**` (JS compilado) — é preciso `npm run build` antes de rodar testes que importem funções novas.
- Nenhuma query nova em `cashflow_entries`/`financial_records` neste plano — `agreement_client_payouts` é dinheiro de terceiro (cliente), não deve aparecer em nenhum relatório financeiro do escritório (DRE, Visão Geral, Pulso do escritório).
- Todo texto do termo gerado usa exatamente os padrões de cláusula encontrados nos 3 modelos reais pesquisados (ver spec) — nenhuma cláusula jurídica nova foi inventada.
- Seguir a convenção existente: apenas funções puras ganham teste `node:test` (`montarCronogramaAcordo` não tem teste hoje, mas as novas funções puras deste plano ganham). Rotas Express com banco são validadas por checagem manual/produção, não por teste automatizado — mesmo padrão já usado em todo o resto do projeto.

---

## Task 1: Migration 076 — schema e modelo do termo

**Files:**
- Create: `migrations/076_acordo_extrajudicial.sql`

**Interfaces:**
- Produces: colunas novas em `agreements` (`is_extrajudicial`, `opposing_cnpj`, `opposing_address`, `opposing_legal_rep_name`, `opposing_legal_rep_cpf`, `opposing_lawyer_name`, `opposing_lawyer_oab`, `payment_method`, `payment_flow`, `agreement_object`, `penalty_percentage`, `jurisdiction_forum`); tabela `agreement_client_payouts`; um registro em `document_templates` com `name = 'Termo de Acordo Extrajudicial'`.

- [ ] **Step 1: Criar o arquivo da migration**

Crie `migrations/076_acordo_extrajudicial.sql` com o conteúdo exato abaixo:

```sql
-- ============================================================
-- Migration 076 — Acordo Extrajudicial (cliente x empresa)
-- Qualificacao completa da empresa/advogado da parte contraria, forma de
-- pagamento, fluxo do dinheiro (direto ao cliente ou via escritorio com
-- repasse) e o modelo do Termo de Acordo Extrajudicial gerado pelo sistema.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE agreements
  ADD COLUMN is_extrajudicial BOOLEAN NOT NULL DEFAULT 0,
  ADD COLUMN opposing_cnpj VARCHAR(20) NULL,
  ADD COLUMN opposing_address VARCHAR(500) NULL,
  ADD COLUMN opposing_legal_rep_name VARCHAR(255) NULL,
  ADD COLUMN opposing_legal_rep_cpf VARCHAR(20) NULL,
  ADD COLUMN opposing_lawyer_name VARCHAR(255) NULL,
  ADD COLUMN opposing_lawyer_oab VARCHAR(30) NULL,
  ADD COLUMN payment_method VARCHAR(30) NULL,
  ADD COLUMN payment_flow VARCHAR(20) NOT NULL DEFAULT 'direto_cliente',
  ADD COLUMN agreement_object TEXT NULL,
  ADD COLUMN penalty_percentage DECIMAL(5,2) NULL,
  ADD COLUMN jurisdiction_forum VARCHAR(255) NULL

CREATE TABLE IF NOT EXISTS agreement_client_payouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agreement_id INT UNSIGNED NOT NULL,
  tranche_label VARCHAR(60) NOT NULL,
  valor_bruto DECIMAL(14,2) NOT NULL,
  valor_honorarios DECIMAL(14,2) NOT NULL DEFAULT 0,
  valor_liquido DECIMAL(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pendente',
  data_prevista DATE NULL,
  data_repasse DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payout_agreement (agreement_id),
  INDEX idx_payout_status (status),
  CONSTRAINT fk_payout_agreement FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

INSERT INTO document_templates (name, category, content) VALUES ('Termo de Acordo Extrajudicial', 'acordos', 'TERMO DE ACORDO EXTRAJUDICIAL\n\nPRIMEIRO ACORDANTE: {{empresa_nome}}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {{empresa_cnpj}}, com sede em {{empresa_endereco}}, neste ato representada por {{empresa_representante_nome}}, inscrito(a) no CPF sob o nº {{empresa_representante_cpf}}{{empresa_advogado_texto}}.\n\nSEGUNDO ACORDANTE: {{cliente_nome}}, {{cliente_estado_civil}}, {{cliente_profissao}}, inscrito(a) no CPF sob o nº {{cliente_cpf}}, residente e domiciliado(a) em {{cliente_endereco}}, {{cliente_cidade}}/{{cliente_estado}}, neste ato assistido(a) por {{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}.\n\nAs partes acima identificadas têm, entre si, justo e acertado o presente Termo de Acordo Extrajudicial, que se regerá pelas cláusulas seguintes.\n\n1 - DO OBJETO DO ACORDO\nCláusula 1ª. {{acordo_objeto}}\n\n2 - DO VALOR E DA FORMA DE PAGAMENTO\nCláusula 2ª. As partes fixam o valor do presente acordo em {{acordo_valor_total}}, a ser pago por {{acordo_forma_pagamento}}, conforme o seguinte cronograma: {{acordo_cronograma}}\n\n3 - DA QUITAÇÃO\nCláusula 3ª. Cumpridas as obrigações previstas neste instrumento, as partes outorgam, uma à outra, a mais ampla, geral, irrevogável e irretratável quitação quanto ao objeto deste acordo, nada mais tendo a reclamar, em juízo ou fora dele, a qualquer título, em relação à matéria aqui tratada.\n\n{{acordo_clausula_penal}}\n\n5 - DO FORO\nCláusula 5ª. Fica eleito o foro de {{acordo_foro}} para dirimir quaisquer dúvidas oriundas do presente instrumento.\n\nPor estarem assim justos e acordados, firmam o presente instrumento em 2 (duas) vias de igual teor, na presença das testemunhas abaixo.\n\n{{cliente_cidade}}, {{data_extenso}}.\n\n_______________________________________\nPRIMEIRO ACORDANTE — {{empresa_nome}}\n\n_______________________________________\nSEGUNDO ACORDANTE — {{cliente_nome}}\n\n_______________________________________\nTESTEMUNHA (1) — CPF:\n\n_______________________________________\nTESTEMUNHA (2) — CPF:')
```

- [ ] **Step 2: Conferir a sintaxe manualmente**

Não há banco local — a migration só é validada de fato quando aplicada no
boot (Task 8, no deploy). Por enquanto, confira visualmente que:
- Não há `;` dentro das strings do `INSERT` (o texto do termo usa `.` em vez
  de reticências e não tem `;`).
- Não há linha começando com `--` dentro do bloco de conteúdo.
- Os três statements (`ALTER TABLE`, `CREATE TABLE`, `INSERT`) estão
  separados por `;` no fim de cada um (adicione `;` ao final de cada bloco
  acima se ainda não tiver — releia o arquivo criado e confirme).

- [ ] **Step 3: Commit**

```bash
git add migrations/076_acordo_extrajudicial.sql
git commit -m "feat(acordos): migration do acordo extrajudicial (schema + termo)"
```

---

## Task 2: `agreementFinance.ts` — repasse ao cliente e texto do cronograma

**Files:**
- Modify: `src/services/agreementFinance.ts`
- Test: `tests/acordos.test.mjs` (novo arquivo)

**Interfaces:**
- Consumes: `Tranche` (já existe em `agreementFinance.ts`), `montarCronogramaAcordo` (já existe).
- Produces: `RepasseCliente` interface, `montarRepassesCliente(a): RepasseCliente[]`, `cronogramaAcordoTexto(tranches: Tranche[]): string`, `syncAgreementClientPayouts(agreementId: number): Promise<{ criados: number }>`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/acordos.test.mjs`:

```javascript
// tests/acordos.test.mjs — acordo extrajudicial: repasse ao cliente e texto do cronograma
import { test } from 'node:test';
import assert from 'node:assert';
import { montarRepassesCliente, cronogramaAcordoTexto } from '../dist/services/agreementFinance.js';

test('montarRepassesCliente: honorário retido proporcional a cada tranche, resto líquido', () => {
  const acordo = {
    total_agreement_value: 10000, entrada_value: 2000, entrada_date: '2026-01-01',
    installments_count: 2, first_due_date: '2026-02-01', honorarium_value: 2000,
  };
  const payouts = montarRepassesCliente(acordo);
  assert.strictEqual(payouts.length, 3);
  assert.deepStrictEqual(payouts[0], { tranche_label: 'Entrada', valor_bruto: 2000, valor_honorarios: 400, valor_liquido: 1600, data_prevista: '2026-01-01' });
  assert.deepStrictEqual(payouts[1], { tranche_label: '1ª parcela', valor_bruto: 4000, valor_honorarios: 800, valor_liquido: 3200, data_prevista: '2026-02-01' });
  assert.deepStrictEqual(payouts[2], { tranche_label: '2ª parcela', valor_bruto: 4000, valor_honorarios: 800, valor_liquido: 3200, data_prevista: '2026-03-01' });
});

test('montarRepassesCliente: sem honorários, repasse é o valor integral', () => {
  const acordo = { total_agreement_value: 5000, entrada_value: 0, entrada_date: null, installments_count: 1, first_due_date: '2026-01-01', honorarium_value: 0 };
  const payouts = montarRepassesCliente(acordo);
  assert.strictEqual(payouts.length, 1);
  assert.deepStrictEqual(payouts[0], { tranche_label: '1ª parcela', valor_bruto: 5000, valor_honorarios: 0, valor_liquido: 5000, data_prevista: '2026-01-01' });
});

test('montarRepassesCliente: sem cronograma definido, lista vazia', () => {
  const acordo = { total_agreement_value: 0, entrada_value: 0, entrada_date: null, installments_count: 0, first_due_date: null, honorarium_value: 0 };
  assert.deepStrictEqual(montarRepassesCliente(acordo), []);
});

test('cronogramaAcordoTexto: entrada + 2 parcelas formatadas em pt-BR', () => {
  const tranches = [
    { label: 'Entrada', valor: 2000, data: '2026-01-01' },
    { label: '1ª parcela', valor: 4000, data: '2026-02-01' },
    { label: '2ª parcela', valor: 4000, data: '2026-03-01' },
  ];
  const texto = cronogramaAcordoTexto(tranches);
  assert.strictEqual(
    texto,
    'Entrada de R$ 2.000,00 em 01/01/2026; 1ª parcela de R$ 4.000,00 em 01/02/2026; 2ª parcela de R$ 4.000,00 em 01/03/2026.'
  );
});

test('cronogramaAcordoTexto: sem tranches, texto de pagamento à vista', () => {
  assert.strictEqual(cronogramaAcordoTexto([]), 'pagamento à vista, conforme acordado entre as partes');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test 2>&1 | grep -A3 "acordos.test"`
Expected: falha com `Cannot find module '../dist/services/agreementFinance.js'` ou
`montarRepassesCliente is not a function` (as funções ainda não existem).

- [ ] **Step 3: Implementar as funções**

Em `src/services/agreementFinance.ts`, adicione ao final do arquivo (depois
de `syncAgreementFinanceLaunches`):

```typescript
export interface RepasseCliente {
  tranche_label: string;
  valor_bruto: number;
  valor_honorarios: number;
  valor_liquido: number;
  data_prevista: string;
}

/**
 * Quanto de cada tranche do acordo (entrada/parcelas) o escritório retém
 * como honorário e quanto repassa ao cliente — só relevante quando o
 * dinheiro passa pela conta do escritório (payment_flow = 'via_escritorio').
 * Mesmo cálculo proporcional de syncAgreementFinanceLaunches, para os dois
 * nunca divergirem.
 */
export function montarRepassesCliente(a: {
  total_agreement_value: number; entrada_value?: number; entrada_date?: string | Date | null;
  installments_count: number; first_due_date: string | Date; honorarium_value?: number;
}): RepasseCliente[] {
  const tranches = montarCronogramaAcordo(a);
  const total = Number(a.total_agreement_value) || 0;
  const honTotal = Number(a.honorarium_value) || 0;
  if (!tranches.length || total <= 0) return [];
  return tranches.map((t) => {
    const honTranche = round2((honTotal * t.valor) / total);
    return {
      tranche_label: t.label,
      valor_bruto: t.valor,
      valor_honorarios: honTranche,
      valor_liquido: round2(t.valor - honTranche),
      data_prevista: t.data,
    };
  });
}

/** Cronograma em texto corrido pro termo gerado (mesmo estilo de contractTemplates.ts). */
export function cronogramaAcordoTexto(tranches: Tranche[]): string {
  if (!tranches.length) return 'pagamento à vista, conforme acordado entre as partes';
  const money = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const dt = (s: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '');
  return tranches.map((t) => `${t.label} de ${money(t.valor)} em ${dt(t.data)}`).join('; ') + '.';
}

/**
 * Gera (ou refaz) os repasses PENDENTES ao cliente para este acordo, quando
 * o dinheiro passa pela conta do escritório. Idempotente como
 * syncAgreementFinanceLaunches: apaga só os PENDENTES antes de recriar — o
 * que já foi marcado como repassado fica intacto. Se o acordo não for
 * via_escritorio, garante que não sobra nenhum repasse pendente órfão (caso
 * o fluxo tenha sido trocado depois de criado).
 */
export async function syncAgreementClientPayouts(agreementId: number): Promise<{ criados: number }> {
  const [[a]] = await db.query('SELECT * FROM agreements WHERE id = ?', [agreementId]) as any;
  if (!a) return { criados: 0 };

  await db.query("DELETE FROM agreement_client_payouts WHERE agreement_id = ? AND status = 'pendente'", [agreementId]);

  if (a.payment_flow !== 'via_escritorio') return { criados: 0 };

  const payouts = montarRepassesCliente(a);
  let criados = 0;
  for (const p of payouts) {
    if (p.valor_liquido <= 0) continue;
    await db.query(
      `INSERT INTO agreement_client_payouts (agreement_id, tranche_label, valor_bruto, valor_honorarios, valor_liquido, status, data_prevista)
       VALUES (?, ?, ?, ?, ?, 'pendente', ?)`,
      [agreementId, p.tranche_label, p.valor_bruto, p.valor_honorarios, p.valor_liquido, p.data_prevista]
    );
    criados++;
  }
  return { criados };
}
```

- [ ] **Step 4: Compilar e rodar os testes**

Run: `npm run build && npm test 2>&1 | tail -20`
Expected: as 5 novas asserções em `acordos.test.mjs` passam; total de testes
sobe (64 = 59 anteriores + 5 novos); `pass` bate com `tests`, `fail: 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/agreementFinance.ts tests/acordos.test.mjs
git commit -m "feat(acordos): repasse ao cliente e texto do cronograma (funções puras + sync)"
```

---

## Task 3: `acordos.ts` — campos novos no create/update

**Files:**
- Modify: `src/routes/acordos.ts`

**Interfaces:**
- Consumes: `syncAgreementClientPayouts` (Task 2).
- Produces: `POST /api/acordos` e `PUT /api/acordos/:id` passam a aceitar e
  persistir os 12 campos novos; `PAYMENT_FLOWS` constante exportável dentro
  do arquivo (não precisa ser exportada do módulo).

- [ ] **Step 1: Adicionar a constante de validação e o import**

No topo de `src/routes/acordos.ts`, troque:

```typescript
import { syncAgreementFinanceLaunches, montarCronogramaAcordo } from '../services/agreementFinance';
```

por:

```typescript
import { syncAgreementFinanceLaunches, syncAgreementClientPayouts, montarCronogramaAcordo, cronogramaAcordoTexto } from '../services/agreementFinance';
```

E logo abaixo de `const STATUSES = [...]`, adicione:

```typescript
const PAYMENT_FLOWS = ['direto_cliente', 'via_escritorio'];
```

- [ ] **Step 2: Estender o `POST /` (criar)**

Troque o bloco de destructuring do body (início do handler `router.post('/', ...)`):

```typescript
  const {
    client_id, case_id, process_number, opposing_party,
    total_agreement_value, entrada_value, entrada_date, installments_count, first_due_date,
    honorarium_percentage, honorarium_value, sucumbencia_value, sucumbencia_due_date,
    receiving_method, notes,
  } = req.body;
```

por:

```typescript
  const {
    client_id, case_id, process_number, opposing_party,
    total_agreement_value, entrada_value, entrada_date, installments_count, first_due_date,
    honorarium_percentage, honorarium_value, sucumbencia_value, sucumbencia_due_date,
    receiving_method, notes,
    is_extrajudicial, opposing_cnpj, opposing_address, opposing_legal_rep_name, opposing_legal_rep_cpf,
    opposing_lawyer_name, opposing_lawyer_oab, payment_method, payment_flow, agreement_object,
    penalty_percentage, jurisdiction_forum,
  } = req.body;
```

Logo depois de `const honValue = ...`, adicione:

```typescript
  const flow = PAYMENT_FLOWS.includes(payment_flow) ? payment_flow : 'direto_cliente';
  const penalty = penalty_percentage !== undefined && penalty_percentage !== null && penalty_percentage !== ''
    ? Number(penalty_percentage) : null;
```

Troque o `INSERT INTO agreements`:

```typescript
  const [result] = await db.query(
    `INSERT INTO agreements
       (client_id, case_id, process_number, opposing_party, total_agreement_value, entrada_value, entrada_date,
        installments_count, first_due_date, honorarium_percentage, honorarium_value,
        sucumbencia_value, sucumbencia_due_date, receiving_method, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposto', ?)`,
    [client_id, case_id ?? null, process_number ?? null, opposing_party.trim(), totalValue,
     round2(entrada_value), entrada_date || null, Number(installments_count) || 1, first_due_date, honPct, honValue,
     round2(sucumbencia_value), sucumbencia_due_date || null,
     receiving_method || 'Acordo', notes ?? null]
  ) as any;
```

por:

```typescript
  const [result] = await db.query(
    `INSERT INTO agreements
       (client_id, case_id, process_number, opposing_party, total_agreement_value, entrada_value, entrada_date,
        installments_count, first_due_date, honorarium_percentage, honorarium_value,
        sucumbencia_value, sucumbencia_due_date, receiving_method, status, notes,
        is_extrajudicial, opposing_cnpj, opposing_address, opposing_legal_rep_name, opposing_legal_rep_cpf,
        opposing_lawyer_name, opposing_lawyer_oab, payment_method, payment_flow, agreement_object,
        penalty_percentage, jurisdiction_forum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client_id, case_id ?? null, process_number ?? null, opposing_party.trim(), totalValue,
     round2(entrada_value), entrada_date || null, Number(installments_count) || 1, first_due_date, honPct, honValue,
     round2(sucumbencia_value), sucumbencia_due_date || null,
     receiving_method || 'Acordo', notes ?? null,
     is_extrajudicial ? 1 : 0, opposing_cnpj || null, opposing_address || null,
     opposing_legal_rep_name || null, opposing_legal_rep_cpf || null,
     opposing_lawyer_name || null, opposing_lawyer_oab || null,
     payment_method || null, flow, agreement_object || null, penalty, jurisdiction_forum || null]
  ) as any;
```

Logo após a linha `const { lancados } = await syncAgreementFinanceLaunches(result.insertId, req.user!.id)...`,
adicione:

```typescript
  await syncAgreementClientPayouts(result.insertId).catch((e) => console.error('❌ [acordo-repasses] falha ao gerar repasses (create):', e?.message || e));
```

- [ ] **Step 3: Estender o `PUT /:id` (atualizar)**

Logo antes de `setIf('receiving_method', req.body.receiving_method);`, adicione:

```typescript
  setIf('is_extrajudicial', req.body.is_extrajudicial !== undefined ? (req.body.is_extrajudicial ? 1 : 0) : undefined);
  setIf('opposing_cnpj', req.body.opposing_cnpj);
  setIf('opposing_address', req.body.opposing_address);
  setIf('opposing_legal_rep_name', req.body.opposing_legal_rep_name);
  setIf('opposing_legal_rep_cpf', req.body.opposing_legal_rep_cpf);
  setIf('opposing_lawyer_name', req.body.opposing_lawyer_name);
  setIf('opposing_lawyer_oab', req.body.opposing_lawyer_oab);
  setIf('payment_method', req.body.payment_method);
  setIf('payment_flow', req.body.payment_flow, PAYMENT_FLOWS.includes(req.body.payment_flow));
  setIf('agreement_object', req.body.agreement_object);
  setIf('penalty_percentage', req.body.penalty_percentage !== undefined
    ? (req.body.penalty_percentage === null || req.body.penalty_percentage === '' ? null : Number(req.body.penalty_percentage))
    : undefined);
  setIf('jurisdiction_forum', req.body.jurisdiction_forum);
```

Logo após a linha `const { lancados } = await syncAgreementFinanceLaunches(Number(id), req.user!.id)...`
(dentro do `PUT /:id`), adicione:

```typescript
  await syncAgreementClientPayouts(Number(id)).catch((e) => console.error('❌ [acordo-repasses] falha ao gerar repasses (update):', e?.message || e));
```

- [ ] **Step 4: Compilar**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/routes/acordos.ts
git commit -m "feat(acordos): campos de acordo extrajudicial no create/update + repasse automático"
```

---

## Task 4: `acordos.ts` — endpoints de repasse ao cliente

**Files:**
- Modify: `src/routes/acordos.ts`

**Interfaces:**
- Produces: `GET /api/acordos/:id/repasses`, `PATCH /api/acordos/repasses/:payoutId/marcar-repassado`.

- [ ] **Step 1: Adicionar as rotas**

Logo após o bloco da rota `GET /:id/cronograma` (antes de `// ── POST /api/acordos — criar`), adicione:

```typescript
// ── GET /api/acordos/:id/repasses — repasses ao cliente (quando via_escritorio)
router.get('/:id/repasses', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    'SELECT * FROM agreement_client_payouts WHERE agreement_id = ? ORDER BY data_prevista ASC',
    [req.params.id]
  ) as any;
  res.json(rows);
});

// ── PATCH /api/acordos/repasses/:payoutId/marcar-repassado ──────────────────
router.patch('/repasses/:payoutId/marcar-repassado', async (req: Request, res: Response) => {
  const [result] = await db.query(
    "UPDATE agreement_client_payouts SET status = 'repassado', data_repasse = NOW() WHERE id = ?",
    [req.params.payoutId]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Repasse não encontrado' }); return; }
  const [[row]] = await db.query('SELECT * FROM agreement_client_payouts WHERE id = ?', [req.params.payoutId]) as any;
  res.json(row);
});
```

- [ ] **Step 2: Compilar**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/routes/acordos.ts
git commit -m "feat(acordos): endpoints de listagem e baixa dos repasses ao cliente"
```

---

## Task 5: `acordos.ts` — geração do Termo de Acordo Extrajudicial

**Files:**
- Modify: `src/routes/acordos.ts`

**Interfaces:**
- Consumes: `cronogramaAcordoTexto`, `montarCronogramaAcordo` (Task 2/já existente), `logTimeline` (já importado no arquivo).
- Produces: `POST /api/acordos/:id/gerar-termo` — cria uma linha em `documents` e devolve o objeto completo (mesmo shape do `POST /api/documents/generate`).

- [ ] **Step 1: Adicionar a rota**

No final de `src/routes/acordos.ts`, logo antes de `export default router;`,
adicione:

```typescript
// ── POST /api/acordos/:id/gerar-termo — Termo de Acordo Extrajudicial ───────
// Reusa o mecanismo de document_templates (mesmo de Procuração/Contrato de
// Honorários) com o modelo inserido na migration 076.
router.post('/:id/gerar-termo', async (req: Request, res: Response) => {
  const [[a]] = await db.query('SELECT * FROM agreements WHERE id = ?', [req.params.id]) as any;
  if (!a) { res.status(404).json({ error: 'Acordo não encontrado' }); return; }
  const [[client]] = await db.query('SELECT * FROM clients WHERE id = ?', [a.client_id]) as any;
  if (!client) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }
  const [[tpl]] = await db.query("SELECT * FROM document_templates WHERE name = 'Termo de Acordo Extrajudicial'") as any;
  if (!tpl) { res.status(500).json({ error: 'Modelo do termo não encontrado — confira se a migration 076 foi aplicada' }); return; }
  const [[lawyer]] = await db.query("SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1") as any;

  const money = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const dataExtenso = () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  const empresaAdvogadoTexto = a.opposing_lawyer_name
    ? `, neste ato assistida por seu advogado ${a.opposing_lawyer_name}${a.opposing_lawyer_oab ? ` (OAB ${a.opposing_lawyer_oab})` : ''}`
    : '';
  const clausulaPenal = a.penalty_percentage
    ? `4 - DA CLÁUSULA PENAL\nCláusula 4ª. Em caso de descumprimento de qualquer obrigação prevista neste instrumento, incidirá multa de ${Number(a.penalty_percentage)}% sobre o valor da parcela vencida e não paga, sem prejuízo de correção monetária e juros legais.`
    : '';

  const map: Record<string, string> = {
    cliente_nome: client.name || '',
    cliente_cpf: client.cpf_cnpj || '',
    cliente_endereco: client.address || '',
    cliente_cidade: client.city || '',
    cliente_estado: client.state || '',
    cliente_profissao: client.profession || '',
    cliente_estado_civil: client.marital_status || '',
    advogada_nome: lawyer?.name || '',
    advogada_oab: lawyer ? `${lawyer.oab_number || ''}${lawyer.oab_uf ? '/' + lawyer.oab_uf : ''}` : '',
    empresa_nome: a.opposing_party || '',
    empresa_cnpj: a.opposing_cnpj || '',
    empresa_endereco: a.opposing_address || '',
    empresa_representante_nome: a.opposing_legal_rep_name || '',
    empresa_representante_cpf: a.opposing_legal_rep_cpf || '',
    empresa_advogado_texto: empresaAdvogadoTexto,
    acordo_objeto: a.agreement_object || '',
    acordo_valor_total: money(a.total_agreement_value),
    acordo_forma_pagamento: a.payment_method || 'a combinar entre as partes',
    acordo_cronograma: cronogramaAcordoTexto(montarCronogramaAcordo(a)),
    acordo_clausula_penal: clausulaPenal,
    acordo_foro: a.jurisdiction_forum || client.city || '',
    data_extenso: dataExtenso(),
  };
  const content = String(tpl.content).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => (map[k] !== undefined ? map[k] : ''));

  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, template_id, status, created_by)
     VALUES (?, ?, ?, 'gerado', ?, ?, ?, 'pendente', ?)`,
    [a.client_id, a.case_id ?? null, tpl.name, tpl.category, content, tpl.id, req.user!.id]
  ) as any;

  await logTimeline({
    clientId: a.client_id, caseId: a.case_id ?? null, eventType: 'documento_gerado',
    description: `Termo de acordo extrajudicial gerado — ${a.opposing_party}`, userId: req.user!.id,
  }).catch(() => {});

  const [rows] = await db.query('SELECT * FROM documents WHERE id = ?', [r.insertId]) as any;
  res.status(201).json(rows[0]);
});
```

- [ ] **Step 2: Compilar**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/routes/acordos.ts
git commit -m "feat(acordos): gera o Termo de Acordo Extrajudicial em papel timbrado"
```

---

## Task 6: Frontend — formulário e ações do acordo extrajudicial

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `field()`, `moneyField()`, `el()`, `api()`, `openModal()`, `closeModal()`, `toast()`, `money()`, `badge()`, `docViewer(id, onSave)` (todos já existem no arquivo).
- Produces: `acordoRepassesModal(agreementId)` (função nova).

- [ ] **Step 1: Adicionar os campos novos no formulário `acordoForm`**

Em `public/app.js`, na função `acordoForm`, troque:

```javascript
    ${field('Parte contrária *', 'opposing_party', { value: e0.opposing_party || '' })}
    ${field('Nº do processo', 'process_number', { value: e0.process_number || '' })}

    <div class="prop-sec">Valor do acordo — entrada + parcelamento</div>
```

por:

```javascript
    ${field('Parte contrária *', 'opposing_party', { value: e0.opposing_party || '' })}
    ${field('Nº do processo', 'process_number', { value: e0.process_number || '' })}

    <div class="prop-sec">Extrajudicial (opcional)</div>
    <label><input type="checkbox" name="is_extrajudicial" ${e0.is_extrajudicial ? 'checked' : ''} /> Este é um acordo extrajudicial (sem processo por trás)</label>
    <div class="form-row">${field('CNPJ da empresa', 'opposing_cnpj', { value: e0.opposing_cnpj || '' })}${field('Endereço da empresa', 'opposing_address', { value: e0.opposing_address || '' })}</div>
    <div class="form-row">${field('Representante legal (nome)', 'opposing_legal_rep_name', { value: e0.opposing_legal_rep_name || '' })}${field('Representante legal (CPF)', 'opposing_legal_rep_cpf', { value: e0.opposing_legal_rep_cpf || '' })}</div>
    <div class="form-row">${field('Advogado da parte contrária', 'opposing_lawyer_name', { value: e0.opposing_lawyer_name || '' })}${field('OAB do advogado', 'opposing_lawyer_oab', { value: e0.opposing_lawyer_oab || '' })}</div>
    ${field('Objeto do acordo', 'agreement_object', { type: 'textarea', value: e0.agreement_object || '' })}
    <div class="form-row">
      ${field('Forma de pagamento', 'payment_method', { value: e0.payment_method || '', options: [{v:'',t:'—'},{v:'PIX',t:'PIX'},{v:'TED',t:'TED'},{v:'Boleto',t:'Boleto'},{v:'Cheque',t:'Cheque'},{v:'Dinheiro',t:'Dinheiro'},{v:'Outro',t:'Outro'}] })}
      ${field('Fluxo do dinheiro', 'payment_flow', { value: e0.payment_flow || 'direto_cliente', options: [{v:'direto_cliente',t:'Direto ao cliente'},{v:'via_escritorio',t:'Via escritório (com repasse)'}] })}
    </div>
    <div class="form-row">${field('Cláusula penal (%)', 'penalty_percentage', { type: 'number', value: e0.penalty_percentage ?? '' })}${field('Foro de eleição', 'jurisdiction_forum', { value: e0.jurisdiction_forum || '' })}</div>

    <div class="prop-sec">Valor do acordo — entrada + parcelamento</div>
```

- [ ] **Step 2: Enviar o checkbox corretamente no submit**

Na mesma função, troque:

```javascript
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    ['total_agreement_value', 'entrada_value', 'honorarium_value', 'sucumbencia_value'].forEach((n) => { body[n] = parseMoneyBR(body[n]); });
    if (!body.case_id) delete body.case_id;
```

por:

```javascript
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    body.is_extrajudicial = form.querySelector('[name=is_extrajudicial]').checked;
    ['total_agreement_value', 'entrada_value', 'honorarium_value', 'sucumbencia_value'].forEach((n) => { body[n] = parseMoneyBR(body[n]); });
    if (!body.case_id) delete body.case_id;
```

(`FormData` não inclui checkboxes desmarcados — por isso o valor é lido
direto do input, não do `FormData`.)

- [ ] **Step 3: Adicionar a função do modal de repasses**

Logo depois da função `acordoForm` (antes de `async function receitaForm`),
adicione:

```javascript
async function acordoRepassesModal(agreementId) {
  const rows = await api(`/api/acordos/${agreementId}/repasses`);
  const wrap = el(`<div>
    ${rows.length ? `<table><thead><tr><th>Tranche</th><th>Bruto</th><th>Honorários</th><th>Líquido</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${r.tranche_label}</td>
      <td>${money(r.valor_bruto)}</td>
      <td>${money(r.valor_honorarios)}</td>
      <td>${money(r.valor_liquido)}</td>
      <td>${badge(r.status === 'repassado' ? 'Repassado' : 'Pendente')}</td>
      <td>${r.status === 'pendente' ? `<button class="btn-sm" data-payout-mark="${r.id}">Marcar como repassado</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="empty">Nenhum repasse gerado para este acordo.</div>'}
  </div>`);
  wrap.querySelectorAll('[data-payout-mark]').forEach((b) => b.onclick = async () => {
    try {
      await api(`/api/acordos/repasses/${b.dataset.payoutMark}/marcar-repassado`, { method: 'PATCH', body: '{}' });
      toast('Repasse marcado');
      closeModal();
      acordoRepassesModal(agreementId);
    } catch (e) { toast(e.message, 'error'); }
  });
  openModal('Repasses ao cliente', wrap);
}
```

- [ ] **Step 4: Adicionar os botões "Gerar termo" e "Repasses" na lista**

Na função `finAcordos`, dentro de `load()`, troque:

```javascript
        const acoes = [`<button class="btn-sm" data-acd-edit="${a.id}">Editar</button>`];
        if (a.status === 'Proposto') acoes.push(`<button class="btn-sm" data-acd-sign="${a.id}">Assinar</button>`);
        if (['Aceito','Homologado','Em pagamento'].includes(a.status)) acoes.push(`<button class="btn-sm" data-acd-close="${a.id}">Encerrar</button>`);
        if (!['Quitado','Descumprido'].includes(a.status)) acoes.push(`<button class="btn-sm" data-acd-cancel="${a.id}">Cancelar</button>`);
```

por:

```javascript
        const acoes = [`<button class="btn-sm" data-acd-edit="${a.id}">Editar</button>`];
        if (a.status === 'Proposto') acoes.push(`<button class="btn-sm" data-acd-sign="${a.id}">Assinar</button>`);
        if (['Aceito','Homologado','Em pagamento'].includes(a.status)) acoes.push(`<button class="btn-sm" data-acd-close="${a.id}">Encerrar</button>`);
        if (!['Quitado','Descumprido'].includes(a.status)) acoes.push(`<button class="btn-sm" data-acd-cancel="${a.id}">Cancelar</button>`);
        if (a.is_extrajudicial) acoes.push(`<button class="btn-sm" data-acd-termo="${a.id}">Gerar termo</button>`);
        if (a.payment_flow === 'via_escritorio') acoes.push(`<button class="btn-sm" data-acd-repasses="${a.id}">Repasses</button>`);
```

E logo depois do bloco `act('[data-acd-cancel]', ...)`, adicione:

```javascript
    document.querySelectorAll('[data-acd-termo]').forEach((b) => b.onclick = async () => {
      try { const doc = await api(`/api/acordos/${b.dataset.acdTermo}/gerar-termo`, { method: 'POST', body: '{}' }); toast('Termo gerado'); docViewer(doc.id); }
      catch (e) { toast(e.message, 'error'); }
    });
    document.querySelectorAll('[data-acd-repasses]').forEach((b) => b.onclick = () => acordoRepassesModal(b.dataset.acdRepasses));
```

- [ ] **Step 5: Checar a sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem saída (sintaxe válida).

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(acordos): tela do acordo extrajudicial (campos, repasses, gerar termo)"
```

---

## Task 7: Deploy e validação contra produção

**Files:** nenhum (deploy + verificação manual)

**Interfaces:** nenhuma nova — só valida o que as Tasks 1-6 produziram.

- [ ] **Step 1: Compilar e rodar a suíte completa**

Run: `npx tsc --noEmit && npm run build && npm test 2>&1 | tail -15`
Expected: `tsc` sem erros; `npm test` reporta `fail: 0` e o total de testes
inclui os 5 novos de `acordos.test.mjs`.

- [ ] **Step 2: Deploy**

```bash
railway up --ci
```

Expected: `Deploy complete`. Confirme o status com
`railway deployment list --json` (procure `"status": "SUCCESS"` no
deployment mais recente) antes de seguir.

- [ ] **Step 3: Validar a migration foi aplicada**

Gere um JWT local (mesmo procedimento já usado neste projeto: ler
`JWT_SECRET` via `railway variables --kv` para um arquivo em
`C:/tmp/`, nunca imprimir no chat, assinar com `jsonwebtoken`, apagar o
arquivo depois de usar) e confira:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "https://crm.advogadaleticiabarros.com.br/api/acordos/stats/resumo"
```

Expected: HTTP 200 com JSON válido (confirma que a rota `agreements` segue
funcionando após a migration adicionar colunas).

- [ ] **Step 4: Criar um acordo extrajudicial de teste e gerar o termo**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":1,"opposing_party":"Empresa Teste LTDA","opposing_cnpj":"00.000.000/0001-00","opposing_address":"Rua Teste, 123","opposing_legal_rep_name":"Fulano de Tal","opposing_legal_rep_cpf":"000.000.000-00","payment_method":"PIX","payment_flow":"via_escritorio","agreement_object":"Rescisão de contrato de prestação de serviços","total_agreement_value":3000,"installments_count":1,"first_due_date":"2026-08-01","honorarium_percentage":30,"is_extrajudicial":true,"penalty_percentage":10,"jurisdiction_forum":"Vitória/ES"}' \
  "https://crm.advogadaleticiabarros.com.br/api/acordos"
```

Expected: HTTP 201, JSON com `is_extrajudicial: 1`, `payment_flow:
"via_escritorio"` e os campos de empresa ecoados de volta.

Anote o `id` retornado (`ACORDO_ID`) e confira os repasses gerados:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "https://crm.advogadaleticiabarros.com.br/api/acordos/ACORDO_ID/repasses"
```

Expected: 1 linha (`tranche_label: "1ª parcela"`), `valor_bruto: "3000.00"`,
`valor_honorarios: "900.00"` (30% de 3000), `valor_liquido: "2100.00"`,
`status: "pendente"`.

Gere o termo:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" "https://crm.advogadaleticiabarros.com.br/api/acordos/ACORDO_ID/gerar-termo"
```

Expected: HTTP 201, JSON com `content` contendo o texto do termo já
preenchido — confira visualmente que `{{empresa_nome}}` virou "Empresa
Teste LTDA", `{{acordo_valor_total}}` virou "R$ 3.000,00" e a cláusula penal
aparece com "10%".

- [ ] **Step 5: Apagar o acordo de teste**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" "https://crm.advogadaleticiabarros.com.br/api/acordos/ACORDO_ID/cancelar" -H "Content-Type: application/json" -d '{"observacao":"acordo de teste da implementação — cancelado"}'
```

(Não existe endpoint de exclusão física de acordos — cancelar é o
equivalente seguro e reversível; deixa registro na auditoria em vez de
apagar dado silenciosamente.)

- [ ] **Step 6: Apagar os arquivos temporários com credenciais**

```bash
rm -f /c/tmp/.rw_vars.env /c/tmp/.token
```
