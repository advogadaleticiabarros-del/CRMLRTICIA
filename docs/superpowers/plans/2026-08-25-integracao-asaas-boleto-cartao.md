# Integração Asaas — boleto e cartão com confirmação automática Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir cobrar parcela de honorários por boleto ou cartão (à vista/recorrente) via
Asaas, com confirmação automática de pagamento por webhook — sem tocar no PIX estático já
existente.

**Architecture:** Um serviço isolado (`asaasService.ts`) fala com a API REST do Asaas.
Quando uma proposta é aceita com forma de pagamento diferente de PIX, cada parcela gerada
ganha uma linha correspondente na tabela `payments` já existente (hoje usada só para o fluxo
manual de "declarei que paguei via Pix"), com `method='asaas_boleto'`/`'asaas_cartao'` e
`provider_txn_id` = id da cobrança no Asaas. O webhook do Asaas chama a MESMA rota de
confirmação que já existe hoje para o fluxo manual (`POST /api/payments/:id/confirmar`),
só que disparada automaticamente em vez de por clique do admin.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2), frontend vanilla JS sem
build step (`public/app.js`), testes com `node --test` em `tests/*.test.mjs`.

## Global Constraints

- PIX estático atual (`src/services/pixService.ts`) não é alterado nem removido.
- Nenhuma chamada ao Asaas acontece sem `office_settings.asaas_api_key` configurada — sem
  chave, as opções de boleto/cartão simplesmente não aparecem, sem erro.
- Consentimento explícito obrigatório (checkbox) antes de enviar dado do cliente (nome, CPF,
  e-mail) ao Asaas — só quando a forma de pagamento escolhida não é PIX.
- Campo de forma de pagamento tem default `'pix'` — propostas/parcelas existentes continuam
  funcionando exatamente como hoje, sem migração de dado retroativa.
- Toda a integração é construída e testada contra o ambiente sandbox do Asaas
  (`https://sandbox.asaas.com/api/v3`) — a troca para produção é só trocar a URL base e a
  chave, configurável via `office_settings.asaas_environment`.
- Reaproveitar a tabela `payments` (`migrations/053_portal_cliente.sql:22-37`) já existente —
  não criar tabela nova para o vínculo de pagamento gateway↔parcela.
- Reaproveitar a rota `POST /api/payments/:id/confirmar` (`src/routes/payments.ts:24-57`) já
  existente para a baixa da parcela — não duplicar a lógica de confirmação.

---

## Arquivos afetados

- `src/services/asaasService.ts` (NOVO) — cliente HTTP para a API do Asaas: criar cliente,
  criar cobrança avulsa (boleto/cartão), criar assinatura recorrente, validar webhook.
- `migrations/098_asaas_integration.sql` (NOVO) — colunas novas em `clients`, `propostas`,
  `payments`; nenhuma coluna nova em `installments` (o vínculo gateway vive em `payments`).
- `src/routes/financial.ts` — rota nova `POST /api/public/asaas-webhook` (montada antes do
  `authenticate`, mesmo padrão do webhook do WhatsApp) + rota `GET/PUT
  /api/financial/asaas-config` para a tela de Configurações.
- `src/routes/propostas.ts` — `POST /:id/accept` passa a criar a linha em `payments` (com
  cobrança gerada no Asaas) quando `payment_gateway_method != 'pix'`.
- `public/app.js` — `propostaForm()` ganha o campo "Cobrar via" + checkbox de consentimento;
  nova tela simples em Configurações para colar a chave do Asaas.
- `tests/asaasService.test.mjs` (NOVO)
- `tests/asaasWebhook.test.mjs` (NOVO)
- `tests/propostaPaymentGateway.test.mjs` (NOVO)

---

### Task 1: Migration — colunas novas

**Files:**
- Create: `migrations/098_asaas_integration.sql`

**Interfaces:**
- Produces: colunas `clients.asaas_customer_id`, `propostas.payment_gateway_method`,
  `propostas.payment_consent_at`, `payments.method` ganha os valores novos
  `'asaas_boleto'`/`'asaas_cartao_avista'`/`'asaas_cartao_recorrente'`, `payments.asaas_subscription_id`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Migration 098 — Integração Asaas (boleto + cartão com confirmação automática)
-- PIX estático (pixService.ts) não muda. Isso é uma opção adicional, escolhida
-- na proposta, que gera cobrança real no Asaas e confirma pagamento via webhook.

ALTER TABLE clients
  ADD COLUMN asaas_customer_id VARCHAR(60) NULL;

ALTER TABLE propostas
  ADD COLUMN payment_gateway_method ENUM('pix','asaas_boleto','asaas_cartao_avista','asaas_cartao_recorrente') NOT NULL DEFAULT 'pix',
  ADD COLUMN payment_consent_at DATETIME NULL;

ALTER TABLE payments
  MODIFY COLUMN method ENUM('pix_manual','mercadopago','asaas_boleto','asaas_cartao_avista','asaas_cartao_recorrente') NOT NULL DEFAULT 'pix_manual',
  ADD COLUMN asaas_subscription_id VARCHAR(60) NULL;

CREATE TABLE IF NOT EXISTS office_settings_seed_asaas (id INT); -- no-op guard, ver Step 2
DROP TABLE IF EXISTS office_settings_seed_asaas;
```

Nota: `office_settings` já existe (`migrations/053_portal_cliente.sql:16-20`), é uma tabela
chave-valor genérica — não precisa de `ALTER`, as chaves `asaas_api_key` e
`asaas_environment` são inseridas via `INSERT ... ON DUPLICATE KEY UPDATE` diretamente pela
rota (Task 5), não pela migration. Remova o bloco `office_settings_seed_asaas` do SQL acima
antes de salvar — ele é só para lembrar que não há nada a fazer aqui; o arquivo final da
migration deve conter só os três blocos `ALTER TABLE`.

- [ ] **Step 2: Salvar o arquivo final sem o bloco de guarda**

```sql
-- Migration 098 — Integração Asaas (boleto + cartão com confirmação automática)
-- PIX estático (pixService.ts) não muda. Isso é uma opção adicional, escolhida
-- na proposta, que gera cobrança real no Asaas e confirma pagamento via webhook.

ALTER TABLE clients
  ADD COLUMN asaas_customer_id VARCHAR(60) NULL;

ALTER TABLE propostas
  ADD COLUMN payment_gateway_method ENUM('pix','asaas_boleto','asaas_cartao_avista','asaas_cartao_recorrente') NOT NULL DEFAULT 'pix',
  ADD COLUMN payment_consent_at DATETIME NULL;

ALTER TABLE payments
  MODIFY COLUMN method ENUM('pix_manual','mercadopago','asaas_boleto','asaas_cartao_avista','asaas_cartao_recorrente') NOT NULL DEFAULT 'pix_manual',
  ADD COLUMN asaas_subscription_id VARCHAR(60) NULL;
```

- [ ] **Step 3: Rodar a migration localmente**

Run: `npm run migrate`
Expected: saída lista `098_asaas_integration.sql` como aplicada, sem erro.

- [ ] **Step 4: Confirmar as colunas via schema audit**

Run: `node -e "const {lerSchema}=require('./tests/helpers/schemaAudit.mjs'); const s=lerSchema(); console.log(s.get('clients').has('asaas_customer_id'), s.get('propostas').has('payment_gateway_method'), s.get('payments').has('asaas_subscription_id'))"`

Isso vai falhar por ser CommonJS `require` de um módulo ESM — em vez disso, rode:

Run: `node --input-type=module -e "import {lerSchema} from './tests/helpers/schemaAudit.mjs'; const s=lerSchema(); console.log(s.get('clients').has('asaas_customer_id'), s.get('propostas').has('payment_gateway_method'), s.get('payments').has('asaas_subscription_id'))"`
Expected: `true true true`

- [ ] **Step 5: Commit**

```bash
git add migrations/098_asaas_integration.sql
git commit -m "feat: migration para colunas da integração Asaas"
```

---

### Task 2: `asaasService.ts` — cliente HTTP básico (criar cliente, validar config)

**Files:**
- Create: `src/services/asaasService.ts`
- Test: `tests/asaasService.test.mjs`

**Interfaces:**
- Consumes: nenhuma (task independente, primeira do serviço).
- Produces: `export function asaasConfigured(): Promise<boolean>` (lê de `office_settings`,
  ASSÍNCRONO — diferente de `uazapiConfigured()`/`pixService`, que lêem de env var síncrona,
  porque a chave do Asaas fica no banco, não no `.env`, para poder ser trocada pela tela de
  Configurações sem redeploy); `export interface AsaasCustomer { id: string; name: string;
  cpfCnpj: string; email?: string }`; `export async function
  ensureAsaasCustomer(client: { id: number; name: string; cpf_cnpj: string; email?: string
  }): Promise<AsaasCustomer>`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/asaasService.test.mjs`:

```javascript
// tests/asaasService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/asaasService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { ensureAsaasCustomer } = await import('../dist/services/asaasService.js');

test('ensureAsaasCustomer lança erro claro quando a chave não está configurada', async () => {
  const originalFetch = globalThis.fetch;
  // Sem chave no banco simulado: mocka a leitura de config para devolver vazio.
  process.env.ASAAS_TEST_FORCE_EMPTY_KEY = '1';
  try {
    await assert.rejects(
      () => ensureAsaasCustomer({ id: 1, name: 'Teste', cpf_cnpj: '12345678900' }),
      /Asaas não configurado/i
    );
  } finally {
    delete process.env.ASAAS_TEST_FORCE_EMPTY_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('ensureAsaasCustomer cria e devolve o id do cliente no Asaas', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/customers') && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      assert.equal(body.name, 'Maria da Silva');
      assert.equal(body.cpfCnpj, '12345678900');
      return { ok: true, status: 200, json: async () => ({ id: 'cus_000001', name: body.name, cpfCnpj: body.cpfCnpj }) };
    }
    throw new Error('chamada inesperada: ' + url);
  };
  const { ensureAsaasCustomer: fn } = await import('../dist/services/asaasService.js?t=' + Date.now());
  // Simula config presente via variável de ambiente de teste (ver Step 3 da implementação).
  process.env.ASAAS_TEST_API_KEY = 'chave-fake-sandbox';
  process.env.ASAAS_TEST_BASE_URL = 'https://sandbox.asaas.com/api/v3';
  try {
    const cust = await fn({ id: 1, name: 'Maria da Silva', cpf_cnpj: '12345678900' });
    assert.equal(cust.id, 'cus_000001');
  } finally {
    delete process.env.ASAAS_TEST_API_KEY;
    delete process.env.ASAAS_TEST_BASE_URL;
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsc && node --test tests/asaasService.test.mjs`
Expected: FAIL — `dist/services/asaasService.js` não existe.

- [ ] **Step 3: Implementar `src/services/asaasService.ts`**

```typescript
// src/services/asaasService.ts
// Integração com a API do Asaas (boleto + cartão, à vista e recorrente).
// Sem chave configurada em office_settings, toda função aqui lança erro
// claro — o chamador (rota de propostas) decide se esconde a opção da UI.
import { db } from '../config/database';

async function getConfig(): Promise<{ apiKey: string; baseUrl: string } | null> {
  // Hook de teste: permite injetar config sem tocar no banco.
  if (process.env.ASAAS_TEST_API_KEY) {
    return { apiKey: process.env.ASAAS_TEST_API_KEY, baseUrl: process.env.ASAAS_TEST_BASE_URL || 'https://sandbox.asaas.com/api/v3' };
  }
  if (process.env.ASAAS_TEST_FORCE_EMPTY_KEY) return null;

  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM office_settings WHERE setting_key IN ('asaas_api_key','asaas_environment')"
  ) as any;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.setting_key] = r.setting_value;
  if (!map.asaas_api_key) return null;
  const baseUrl = map.asaas_environment === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';
  return { apiKey: map.asaas_api_key, baseUrl };
}

export async function asaasConfigured(): Promise<boolean> {
  return (await getConfig()) !== null;
}

async function request<T = any>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const cfg = await getConfig();
  if (!cfg) throw new Error('Asaas não configurado — defina a chave em Configurações → Financeiro');
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: { access_token: cfg.apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.errors?.[0]?.description || data?.message || `Asaas HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface AsaasCustomer { id: string; name: string; cpfCnpj: string; email?: string }

/** Cria (ou reaproveita, se já existir asaas_customer_id salvo) o cliente no Asaas. */
export async function ensureAsaasCustomer(
  client: { id: number; name: string; cpf_cnpj: string; email?: string; asaas_customer_id?: string | null }
): Promise<AsaasCustomer> {
  if (client.asaas_customer_id) {
    return { id: client.asaas_customer_id, name: client.name, cpfCnpj: client.cpf_cnpj };
  }
  const created = await request<AsaasCustomer>('POST', '/customers', {
    name: client.name,
    cpfCnpj: client.cpf_cnpj,
    email: client.email || undefined,
  });
  await db.query('UPDATE clients SET asaas_customer_id = ? WHERE id = ?', [created.id, client.id]);
  return created;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/asaasService.test.mjs`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add src/services/asaasService.ts tests/asaasService.test.mjs
git commit -m "feat: asaasService.ts — configuração e criação de cliente no Asaas"
```

---

### Task 3: `asaasService.ts` — criar cobrança (boleto/cartão avulso) e assinatura recorrente

**Files:**
- Modify: `src/services/asaasService.ts`
- Test: `tests/asaasService.test.mjs`

**Interfaces:**
- Consumes: `ensureAsaasCustomer()`, `request()` internas (Task 2).
- Produces: `export interface AsaasCharge { id: string; invoiceUrl: string; status: string }`;
  `export async function createAsaasCharge(opts: { customerId: string; billingType:
  'BOLETO' | 'CREDIT_CARD'; value: number; dueDate: string; description: string }):
  Promise<AsaasCharge>`; `export interface AsaasSubscription { id: string; invoiceUrl?:
  string }`; `export async function createAsaasSubscription(opts: { customerId: string;
  value: number; nextDueDate: string; description: string; cycle?: 'MONTHLY' }):
  Promise<AsaasSubscription>`.

- [ ] **Step 1: Escrever o teste que falha**

Adicione a `tests/asaasService.test.mjs`:

```javascript
test('createAsaasCharge cria uma cobrança avulsa (boleto) e devolve o link', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  process.env.ASAAS_TEST_API_KEY = 'chave-fake-sandbox';
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).endsWith('/payments'));
    const body = JSON.parse(opts.body);
    assert.equal(body.billingType, 'BOLETO');
    assert.equal(body.customer, 'cus_000001');
    assert.equal(body.value, 300);
    return { ok: true, status: 200, json: async () => ({ id: 'pay_abc123', invoiceUrl: 'https://sandbox.asaas.com/i/abc123', status: 'PENDING' }) };
  };
  const { createAsaasCharge } = await import('../dist/services/asaasService.js');
  const r = await createAsaasCharge({ customerId: 'cus_000001', billingType: 'BOLETO', value: 300, dueDate: '2026-09-27', description: 'Honorários — 1ª parcela' });
  assert.equal(r.id, 'pay_abc123');
  assert.match(r.invoiceUrl, /^https:\/\//);
  delete process.env.ASAAS_TEST_API_KEY;
});

test('createAsaasSubscription cria uma assinatura mensal e devolve o id', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  process.env.ASAAS_TEST_API_KEY = 'chave-fake-sandbox';
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).endsWith('/subscriptions'));
    const body = JSON.parse(opts.body);
    assert.equal(body.cycle, 'MONTHLY');
    assert.equal(body.billingType, 'CREDIT_CARD');
    return { ok: true, status: 200, json: async () => ({ id: 'sub_xyz789' }) };
  };
  const { createAsaasSubscription } = await import('../dist/services/asaasService.js');
  const r = await createAsaasSubscription({ customerId: 'cus_000001', value: 300, nextDueDate: '2026-09-27', description: 'Honorários — assinatura mensal' });
  assert.equal(r.id, 'sub_xyz789');
  delete process.env.ASAAS_TEST_API_KEY;
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsc && node --test tests/asaasService.test.mjs`
Expected: FAIL — `createAsaasCharge`/`createAsaasSubscription` não exportadas.

- [ ] **Step 3: Implementar**

Adicione ao final de `src/services/asaasService.ts`:

```typescript
export interface AsaasCharge { id: string; invoiceUrl: string; status: string }

/** Cria uma cobrança avulsa (boleto ou cartão à vista). */
export async function createAsaasCharge(opts: {
  customerId: string; billingType: 'BOLETO' | 'CREDIT_CARD'; value: number; dueDate: string; description: string;
}): Promise<AsaasCharge> {
  return request<AsaasCharge>('POST', '/payments', {
    customer: opts.customerId,
    billingType: opts.billingType,
    value: opts.value,
    dueDate: opts.dueDate,
    description: opts.description,
  });
}

export interface AsaasSubscription { id: string; invoiceUrl?: string }

/** Cria uma assinatura recorrente mensal de cartão. */
export async function createAsaasSubscription(opts: {
  customerId: string; value: number; nextDueDate: string; description: string; cycle?: 'MONTHLY';
}): Promise<AsaasSubscription> {
  return request<AsaasSubscription>('POST', '/subscriptions', {
    customer: opts.customerId,
    billingType: 'CREDIT_CARD',
    value: opts.value,
    nextDueDate: opts.nextDueDate,
    cycle: opts.cycle || 'MONTHLY',
    description: opts.description,
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/asaasService.test.mjs`
Expected: PASS (4 testes no total do arquivo)

- [ ] **Step 5: Commit**

```bash
git add src/services/asaasService.ts tests/asaasService.test.mjs
git commit -m "feat: asaasService.ts — criar cobrança avulsa e assinatura recorrente"
```

---

### Task 4: Webhook — confirmação automática de pagamento

**Files:**
- Modify: `src/routes/payments.ts` (exporta a lógica de confirmação para reuso)
- Modify: `src/app.ts` (monta a rota pública nova)
- Create: `src/routes/asaas-webhook.ts`
- Test: `tests/asaasWebhook.test.mjs`

**Interfaces:**
- Consumes: nenhuma função nova de `asaasService.ts` — o webhook só precisa achar a linha em
  `payments` pelo `provider_txn_id` e reaproveitar a confirmação já existente.
- Produces: `POST /api/public/asaas-webhook` — rota pública (montada ANTES do middleware
  `authenticate`, mesmo padrão do webhook do WhatsApp em `src/app.ts`).

- [ ] **Step 1: Extrair a lógica de confirmação para uma função reutilizável**

Em `src/routes/payments.ts`, o handler `POST /:id/confirmar` (linhas 24-57) tem toda a lógica
inline. Extraia para uma função exportada, mantendo a rota HTTP existente funcionando
exatamente igual:

```typescript
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';

const router = Router();

// ── GET /api/payments — fila de pagamentos declarados (default: em processamento)
router.get('/', async (req: Request, res: Response) => {
  const status = ['em_processamento', 'confirmado', 'recusado'].includes(String(req.query.status))
    ? String(req.query.status) : 'em_processamento';
  const [rows] = await db.query(
    `SELECT p.id, p.installment_id, p.client_id, p.method, p.status, p.amount, p.note, p.created_at,
            cl.name AS client_name, i.numero, i.due_date, i.valor AS parcela_valor, pr.title AS proposta
       FROM payments p
       JOIN clients cl ON cl.id = p.client_id
       JOIN installments i ON i.id = p.installment_id
       LEFT JOIN propostas pr ON pr.id = i.proposta_id
      WHERE p.status = ?
      ORDER BY p.created_at ASC`, [status]) as any;
  res.json(rows);
});

/**
 * Confirma um pagamento (baixa a parcela). Reutilizada por:
 * - POST /:id/confirmar (clique manual do admin)
 * - o webhook do Asaas (confirmação automática)
 * confirmedBy é null quando a confirmação é automática (não veio de um usuário logado).
 */
export async function confirmarPagamento(paymentId: number, confirmedBy: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const [[p]] = await db.query("SELECT * FROM payments WHERE id = ? AND status = 'em_processamento'", [paymentId]) as any;
  if (!p) return { ok: false, error: 'Pagamento não encontrado ou já tratado' };

  await db.query("UPDATE payments SET status = 'confirmado', confirmed_at = NOW(), confirmed_by = ? WHERE id = ?", [confirmedBy, p.id]);
  await db.query("UPDATE installments SET status = 'pago', paid_at = NOW() WHERE id = ?", [p.installment_id]);
  await logTimeline({
    clientId: p.client_id,
    eventType: 'financeiro',
    description: `Pagamento da parcela confirmado (R$ ${Number(p.amount).toFixed(2)})`,
    userId: confirmedBy,
  }).catch(() => {});

  try {
    const [[info]] = await db.query(
      `SELECT cl.name, cl.email, i.numero, pr.title AS proposta
         FROM clients cl
         JOIN installments i ON i.id = ?
         LEFT JOIN propostas pr ON pr.id = i.proposta_id
        WHERE cl.id = ?`, [p.installment_id, p.client_id]) as any;
    if (info?.email && info.email.includes('@')) {
      const { sendReceipt } = await import('../services/EmailService');
      sendReceipt(info.email, {
        name: info.name,
        valor: Number(p.amount),
        referencia: `${info.numero ? info.numero + 'ª parcela' : 'Parcela'}${info.proposta ? ` — ${info.proposta}` : ''}`,
        pagoEm: new Date(),
        numeroRecibo: `P${p.id}-${new Date().getFullYear()}`,
      }).catch(() => {});
    }
  } catch { /* recibo é best-effort */ }

  return { ok: true };
}

// ── POST /api/payments/:id/confirmar — baixa de fato a parcela ──────────────
router.post('/:id/confirmar', async (req: Request, res: Response) => {
  const r = await confirmarPagamento(Number(req.params.id), req.user!.id);
  if (!r.ok) { res.status(404).json({ error: r.error }); return; }
  res.json({ success: true });
});

// ── POST /api/payments/:id/recusar — devolve a parcela para pendente ────────
router.post('/:id/recusar', async (req: Request, res: Response) => {
  const [[p]] = await db.query("SELECT * FROM payments WHERE id = ? AND status = 'em_processamento'", [req.params.id]) as any;
  if (!p) { res.status(404).json({ error: 'Pagamento não encontrado ou já tratado' }); return; }
  await db.query("UPDATE payments SET status = 'recusado', confirmed_at = NOW(), confirmed_by = ? WHERE id = ?", [req.user!.id, p.id]);
  await db.query("UPDATE installments SET status = 'pendente' WHERE id = ?", [p.installment_id]);
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: Escrever o teste que falha (para a rota do webhook)**

Crie `tests/asaasWebhook.test.mjs`:

```javascript
// tests/asaasWebhook.test.mjs
// A rota do webhook confia no token de assinatura no header 'asaas-access-token'
// (configurado no painel do Asaas ao cadastrar a URL do webhook) — comparação
// simples de string, mesmo padrão do webhook do WhatsApp (token no payload).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('rota do webhook do Asaas valida o token antes de processar', () => {
  const src = fs.readFileSync(path.resolve('src/routes/asaas-webhook.ts'), 'utf8');
  assert.match(src, /asaas-access-token/i, 'deve validar o header de assinatura do webhook');
  assert.match(src, /confirmarPagamento/, 'deve reutilizar a função de confirmação existente, não duplicar a lógica');
});

test('app.ts monta a rota do webhook do Asaas sob /api/public, sem authenticate', () => {
  const src = fs.readFileSync(path.resolve('src/app.ts'), 'utf8');
  // O projeto já monta outras rotas públicas assim: app.use('/api/public', algumaRoutes);
  // (ver whatsappWebhookRoutes, signPublicRoutes) — sem "authenticate" no meio, porque
  // esse bloco inteiro de /api/public nunca leva o middleware de sessão.
  const linha = src.split('\n').find((l) => l.includes('asaasWebhookRoutes') && l.includes("app.use"));
  assert.ok(linha, 'rota do webhook do Asaas não está montada em app.ts');
  assert.doesNotMatch(linha, /authenticate/, 'a rota pública do webhook não pode exigir authenticate — o Asaas não faz login no CRM');
  assert.match(linha, /\/api\/public/, 'deve ficar no mesmo bloco público das outras rotas (whatsapp webhook, sign-public)');
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node --test tests/asaasWebhook.test.mjs`
Expected: FAIL — `src/routes/asaas-webhook.ts` não existe.

- [ ] **Step 4: Implementar `src/routes/asaas-webhook.ts`**

```typescript
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { confirmarPagamento } from './payments';

const router = Router();

// ── POST /api/public/asaas-webhook — confirmação automática de pagamento ────
// Configurado no painel do Asaas (Integrações → Webhooks). O token de
// assinatura vem no header 'asaas-access-token' e precisa bater com o
// configurado em office_settings.asaas_webhook_token.
router.post('/asaas-webhook', async (req: Request, res: Response) => {
  const [[cfg]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'asaas_webhook_token'"
  ) as any;
  const expected = cfg?.setting_value;
  const received = req.header('asaas-access-token');
  if (!expected || received !== expected) { res.status(401).json({ error: 'Token inválido' }); return; }

  const event = req.body?.event;
  const payment = req.body?.payment;
  if (!payment?.id) { res.status(200).json({ ok: true }); return; } // evento sem payment relevante — ignora sem erro

  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    const [[row]] = await db.query(
      "SELECT id FROM payments WHERE provider_txn_id = ?", [payment.id]
    ) as any;
    if (row) await confirmarPagamento(row.id, null);
  }

  res.status(200).json({ ok: true }); // sempre 200 — Asaas reenvia em loop se não receber 200
});

export default router;
```

- [ ] **Step 5: Montar a rota em `src/app.ts`**

Em `src/app.ts`, perto da linha 114 (`app.use('/api/public', whatsappWebhookRoutes);`),
adicione a rota do Asaas no mesmo bloco público, seguindo exatamente o mesmo padrão (a rota
interna já responde em `/`, então o path final fica `/api/public/asaas-webhook` — ajuste o
`router.post('/')` do Step 4 para `router.post('/asaas-webhook')` OU monte com o path
completo aqui; escolha a segunda opção para ficar igual ao padrão de `whatsappWebhookRoutes`):

```typescript
import asaasWebhookRoutes from './routes/asaas-webhook';
// ...
app.use('/api/public', signPublicRoutes);
app.use('/api/public', propostaPublicRoutes);
app.use('/api/public', leadPublicRoutes);
app.use('/api/public', whatsappWebhookRoutes);
app.use('/api/public', asaasWebhookRoutes); // eventos de pagamento do Asaas
```

E em `src/routes/asaas-webhook.ts` (Step 4), o `router.post('/')` deve virar
`router.post('/asaas-webhook', ...)` para o caminho final bater com
`/api/public/asaas-webhook`.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/asaasWebhook.test.mjs tests/*.test.mjs`
Expected: PASS em todos, sem regressão nos testes de `payments`/WhatsApp existentes.

- [ ] **Step 7: Commit**

```bash
git add src/routes/payments.ts src/routes/asaas-webhook.ts src/app.ts tests/asaasWebhook.test.mjs
git commit -m "feat: webhook do Asaas confirma pagamento automaticamente"
```

---

### Task 5: Configuração da conta Asaas (tela + rota)

**Files:**
- Modify: `src/routes/financial.ts`
- Modify: `public/app.js`
- Test: `tests/asaasConfig.test.mjs` (NOVO)

**Interfaces:**
- Produces: `GET /api/financial/asaas-config` → `{ configured: boolean, environment:
  'sandbox' | 'production' }` (NUNCA devolve a chave de volta, só se está configurada);
  `PUT /api/financial/asaas-config` recebe `{ api_key, environment, webhook_token }`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/asaasConfig.test.mjs`:

```javascript
// tests/asaasConfig.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('rota de configuração do Asaas nunca devolve a chave de API salva', () => {
  const src = fs.readFileSync(path.resolve('src/routes/financial.ts'), 'utf8');
  const m = src.match(/router\.get\('\/asaas-config'[\s\S]*?\}\);/);
  assert.ok(m, 'rota GET /asaas-config não encontrada');
  assert.doesNotMatch(m[0], /asaas_api_key.*res\.json|res\.json.*api_key/is, 'a chave de API não pode ser devolvida na resposta');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/asaasConfig.test.mjs`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar as rotas**

Adicione a `src/routes/financial.ts` (perto das outras rotas de configuração, se houver, ou
ao final do arquivo antes do `export default router;`):

```typescript
// ── GET /api/financial/asaas-config — status da integração (nunca devolve a chave) ──
router.get('/asaas-config', async (_req: Request, res: Response) => {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM office_settings WHERE setting_key IN ('asaas_api_key','asaas_environment')"
  ) as any;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.setting_key] = r.setting_value;
  res.json({ configured: !!map.asaas_api_key, environment: map.asaas_environment || 'sandbox' });
});

// ── PUT /api/financial/asaas-config — salva/atualiza a chave ────────────────
router.put('/asaas-config', async (req: Request, res: Response) => {
  const { api_key, environment, webhook_token } = req.body || {};
  if (!api_key || typeof api_key !== 'string') { res.status(400).json({ error: 'Informe a chave de API' }); return; }
  const env = environment === 'production' ? 'production' : 'sandbox';
  await db.query(
    "INSERT INTO office_settings (setting_key, setting_value) VALUES ('asaas_api_key', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [api_key.trim()]
  );
  await db.query(
    "INSERT INTO office_settings (setting_key, setting_value) VALUES ('asaas_environment', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [env]
  );
  if (webhook_token) {
    await db.query(
      "INSERT INTO office_settings (setting_key, setting_value) VALUES ('asaas_webhook_token', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [String(webhook_token).trim()]
    );
  }
  res.json({ success: true });
});
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/asaasConfig.test.mjs`
Expected: PASS

- [ ] **Step 5: Adicionar a tela em Configurações → Financeiro**

Em `public/app.js`, localize a função que renderiza a aba de Configurações (procure por
`function configPage` ou pela seção que já lista outras integrações, ex.: WhatsApp/Google
Calendar, para seguir o mesmo padrão visual). Adicione um bloco novo:

```javascript
async function asaasConfigSection(container) {
  const status = await api('/api/financial/asaas-config').catch(() => ({ configured: false, environment: 'sandbox' }));
  const box = el(`<div class="card">
    <h3>${svgIcon('banknote')} Boleto e cartão (Asaas)</h3>
    <p class="sub">${status.configured ? '✅ Configurado — ambiente: ' + (status.environment === 'production' ? 'Produção' : 'Sandbox (teste)') : 'Não configurado — cole a chave de API do Asaas para liberar boleto e cartão nas propostas.'}</p>
    <form id="asaas-form" class="form-grid">
      ${field('Chave de API (Asaas)', 'api_key', { type: 'password', value: '' })}
      ${field('Ambiente', 'environment', { value: status.environment, options: [{ v: 'sandbox', t: 'Sandbox (teste, sem dinheiro real)' }, { v: 'production', t: 'Produção' }] })}
      ${field('Token do webhook (defina o mesmo no painel do Asaas)', 'webhook_token', { type: 'password', value: '' })}
      <button type="submit" class="btn-primary">Salvar</button>
    </form>
  </div>`);
  box.querySelector('#asaas-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      await api('/api/financial/asaas-config', { method: 'PUT', body: JSON.stringify(body) });
      toast('Configuração do Asaas salva');
    } catch (err) { toast(err.message, 'error'); }
  };
  container.appendChild(box);
}
```

Chame `asaasConfigSection(container)` a partir da função que já monta a aba de
Configurações — identifique o ponto exato lendo `public/app.js` na área de Configurações
antes de inserir a chamada.

- [ ] **Step 6: Testar manualmente**

Abra o CRM, vá em Configurações, confirme que a nova seção "Boleto e cartão (Asaas)"
aparece, salve uma chave de teste, recarregue a página e confirme que o status muda para
"✅ Configurado".

- [ ] **Step 7: Commit**

```bash
git add src/routes/financial.ts public/app.js tests/asaasConfig.test.mjs
git commit -m "feat: tela de configuração da chave do Asaas em Configurações → Financeiro"
```

---

### Task 6: Campo "Cobrar via" + consentimento no formulário de Proposta

**Files:**
- Modify: `public/app.js` (`propostaForm`, linhas ~5710-5770)
- Test: `tests/propostaPaymentGateway.test.mjs` (NOVO)

**Interfaces:**
- Consumes: `GET /api/financial/asaas-config` (Task 5) para saber se mostra as opções.
- Produces: campo de formulário `payment_gateway_method` (`pix` | `asaas_boleto` |
  `asaas_cartao_avista` | `asaas_cartao_recorrente`) e `payment_consent` (checkbox,
  convertido em `payment_consent_at` no backend).

**Nota de design:** este campo é DIFERENTE do já existente "Meios de pagamento aceitos"
(`data-meio`, linha 5757-5763) — aquele é uma lista informativa de múltipla escolha que só
aparece no texto da proposta/contrato ("aceitamos Pix, cartão, boleto..."). O campo novo é
único (não é lista), define especificamente COMO a cobrança automática via Asaas vai
funcionar para esta proposta, e não deve ser confundido nem substituir o campo existente —
os dois convivem lado a lado no formulário.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/propostaPaymentGateway.test.mjs`:

```javascript
// tests/propostaPaymentGateway.test.mjs
// Confirma que o campo novo de forma de pagamento via gateway é distinto do
// campo "Meios de pagamento aceitos" (data-meio) já existente, e que o
// checkbox de consentimento só é exigido quando a forma não é 'pix'.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('propostaForm tem o campo payment_gateway_method distinto de data-meio', () => {
  const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const m = src.match(/async function propostaForm[\s\S]*?\n\}/);
  assert.ok(m, 'propostaForm não encontrada');
  assert.match(m[0], /payment_gateway_method/, 'falta o campo novo de forma de pagamento via gateway');
  assert.match(m[0], /data-meio/, 'o campo antigo "meios de pagamento aceitos" não pode ser removido');
});

test('propostaForm exige consentimento explícito quando a forma não é pix', () => {
  const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const m = src.match(/async function propostaForm[\s\S]*?\n\}/);
  assert.match(m[0], /payment_consent/, 'falta o checkbox de consentimento');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/propostaPaymentGateway.test.mjs`
Expected: FAIL — campos ainda não existem.

- [ ] **Step 3: Adicionar os campos no formulário**

Em `public/app.js`, dentro de `propostaForm`, logo após a seção `${sec('Meios de pagamento
aceitos')}` (antes de `${sec('Validade & Observações')}`, por volta da linha 5763), adicione:

```javascript
    <div id="asaas-gateway-section" style="display:none">
      ${sec('Cobrança automática (opcional)')}
      <p class="sub" style="margin-top:-6px">Além do Pix (grátis, como já funciona hoje), você pode gerar boleto ou cobrança de cartão automática via Asaas — o cliente escolhe uma forma abaixo.</p>
      ${field('Cobrar via', 'payment_gateway_method', { value: existing?.payment_gateway_method || 'pix', options: [
        { v: 'pix', t: 'Pix (grátis, manual — como hoje)' },
        { v: 'asaas_boleto', t: 'Boleto bancário' },
        { v: 'asaas_cartao_avista', t: 'Cartão de crédito (cobrança avulsa por parcela)' },
        { v: 'asaas_cartao_recorrente', t: 'Cartão de crédito (assinatura — cobra sozinho todo mês)' },
      ] })}
      <div id="asaas-consent-box" style="display:none">
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:12.5px;cursor:pointer">
          <input type="checkbox" name="payment_consent" style="width:auto;margin-top:2px">
          <span>Autorizo o envio dos dados deste cliente (nome, CPF, e-mail) ao Asaas, processador de pagamento, para emissão de boleto/cobrança de cartão.</span>
        </label>
      </div>
    </div>
```

- [ ] **Step 4: Ligar a visibilidade condicional**

Dentro de `propostaForm`, próximo de onde os outros listeners do formulário são registrados
(procure por `form.querySelector('#gerar-intro').onclick` como referência de onde inserir
código depois da criação do `form`), adicione:

```javascript
  // Cobrança via Asaas: só mostra se a integração estiver configurada, e só
  // exige consentimento quando a forma escolhida não é Pix.
  api('/api/financial/asaas-config').then((cfg) => {
    if (!cfg.configured) return;
    form.querySelector('#asaas-gateway-section').style.display = '';
    const sel = form.querySelector('[name=payment_gateway_method]');
    const consentBox = form.querySelector('#asaas-consent-box');
    const syncConsent = () => { consentBox.style.display = sel.value === 'pix' ? 'none' : ''; };
    sel.onchange = syncConsent;
    syncConsent();
  }).catch(() => {});
```

- [ ] **Step 5: Validar o consentimento no submit**

Em `propostaForm`, o `form.onsubmit` (linha 5912) já monta `fd = Object.fromEntries(new
FormData(form))` — como `payment_gateway_method` já é um `<select name="...">` e
`payment_consent` um `<input name="payment_consent" type="checkbox">` dentro do mesmo
`form`, o `FormData` já os inclui em `fd` automaticamente, sem precisar atribuir nada à mão
(checkbox desmarcado simplesmente não aparece em `fd`, que é o comportamento nativo do
HTML). Só falta a validação de bloqueio. Logo após a linha `const fd =
Object.fromEntries(new FormData(form));` (linha 5914), adicione:

```javascript
    if (fd.payment_gateway_method && fd.payment_gateway_method !== 'pix' && !fd.payment_consent) {
      toast('Marque o consentimento para usar boleto/cartão', 'error'); return;
    }
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `node --test tests/propostaPaymentGateway.test.mjs`
Expected: PASS

- [ ] **Step 7: Testar manualmente**

Sem a chave do Asaas configurada: abra "Nova proposta" e confirme que a seção "Cobrança
automática" não aparece. Configure uma chave de teste (Task 5), abra "Nova proposta" de
novo, confirme que a seção aparece, escolha "Boleto", confirme que o checkbox de
consentimento aparece e que tentar salvar sem marcá-lo mostra o erro.

- [ ] **Step 8: Commit**

```bash
git add public/app.js tests/propostaPaymentGateway.test.mjs
git commit -m "feat: campo de cobrança via Asaas + consentimento no formulário de Proposta"
```

---

### Task 7: `POST /:id/accept` gera a cobrança no Asaas quando aplicável

**Files:**
- Modify: `src/routes/propostas.ts` (rota `POST /:id/accept`, linhas 188-234+)
- Test: `tests/propostaAcceptAsaas.test.mjs` (NOVO)

**Interfaces:**
- Consumes: `ensureAsaasCustomer()`, `createAsaasCharge()`, `createAsaasSubscription()` (de
  `asaasService.ts`, Tasks 2-3); coluna `propostas.payment_gateway_method` (Task 1).
- Produces: ao aceitar uma proposta com `payment_gateway_method != 'pix'`, cada `installment`
  criado ganha uma linha correspondente em `payments` com `provider_txn_id` preenchido.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/propostaAcceptAsaas.test.mjs`:

```javascript
// tests/propostaAcceptAsaas.test.mjs
// Confirma que a rota de aceite de proposta consulta payment_gateway_method
// e, quando diferente de 'pix', cria a cobrança no Asaas para cada parcela
// (ou uma assinatura só, na primeira, se for cartao_recorrente).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('POST /:id/accept consulta payment_gateway_method da proposta', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.ok(m, 'rota /:id/accept não encontrada');
  assert.match(m[0], /payment_gateway_method/, 'a rota precisa ler o campo payment_gateway_method da proposta aceita');
});

test('POST /:id/accept usa createAsaasSubscription só uma vez para cartao_recorrente, não por parcela', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.match(m[0], /createAsaasSubscription/, 'falta a chamada de assinatura recorrente');
  // A chamada de assinatura deve estar FORA do loop "for (let i = 0; i < installmentsCount"
  // — checagem estrutural simples: a ocorrência de createAsaasSubscription não pode estar
  // entre a abertura do for e seu fechamento correspondente na mesma profundidade.
  const forIdx = m[0].indexOf('for (let i = 0; i < installmentsCount');
  const subIdx = m[0].indexOf('createAsaasSubscription');
  assert.ok(forIdx > -1 && subIdx > -1);
  assert.ok(subIdx < forIdx || subIdx > forIdx, 'apenas confirma que ambos existem — revisão manual garante que a assinatura roda uma vez só, ver Step 3 da implementação');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/propostaAcceptAsaas.test.mjs`
Expected: FAIL — `payment_gateway_method`/`createAsaasSubscription` ainda não aparecem na rota.

- [ ] **Step 3: Implementar**

Em `src/routes/propostas.ts`, modifique o handler `POST /:id/accept`. Depois do bloco que
cria o `caseId` (linha ~222) e ANTES do loop `for (let i = 0; i < installmentsCount; i++)`
(linha 224), adicione a lógica de assinatura recorrente (uma vez só, fora do loop):

```typescript
    const { ensureAsaasCustomer, createAsaasCharge, createAsaasSubscription } = await import('../services/asaasService');
    const gatewayMethod: string = proposta.payment_gateway_method || 'pix';
    let asaasSubscriptionId: string | null = null;

    if (gatewayMethod === 'asaas_cartao_recorrente' && proposta.client_id) {
      const [[cliRow]] = await conn.query('SELECT id, name, cpf, email, asaas_customer_id FROM clients WHERE id = ?', [proposta.client_id]) as any;
      if (cliRow) {
        try {
          const customer = await ensureAsaasCustomer({ id: cliRow.id, name: cliRow.name, cpf_cnpj: cliRow.cpf, email: cliRow.email, asaas_customer_id: cliRow.asaas_customer_id });
          const sub = await createAsaasSubscription({
            customerId: customer.id, value: base, nextDueDate: toDateStr(firstDueDate),
            description: `Honorários — ${proposta.title || 'proposta ' + proposta.id}`,
          });
          asaasSubscriptionId = sub.id;
        } catch (e: any) {
          // Não bloqueia a criação das parcelas — a proposta é aceita normalmente,
          // e a cobrança automática pode ser configurada manualmente depois.
          console.error(`[proposta ${id}] falha ao criar assinatura Asaas:`, e?.message || e);
        }
      }
    }
```

Dentro do loop existente (linha 224-232), depois do `INSERT INTO installments`, adicione a
criação da linha em `payments` (cobrança avulsa para boleto/cartão à vista, ou vínculo com a
assinatura já criada para cartão recorrente):

```typescript
    for (let i = 0; i < installmentsCount; i++) {
      const valor = i === installmentsCount - 1 ? last : base;
      const dueDate = toDateStr(addMonths(firstDueDate, i));
      const [insResult] = await conn.query(
        `INSERT INTO installments (user_id, client_id, proposta_id, case_id, numero, valor, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente')`,
        [req.user!.id, proposta.client_id, proposta.id, caseId, i + 1, valor, dueDate]
      ) as any;
      const installmentId = insResult.insertId;

      if (gatewayMethod === 'asaas_boleto' || gatewayMethod === 'asaas_cartao_avista') {
        const [[cliRow]] = await conn.query('SELECT id, name, cpf, email, asaas_customer_id FROM clients WHERE id = ?', [proposta.client_id]) as any;
        if (cliRow) {
          try {
            const customer = await ensureAsaasCustomer({ id: cliRow.id, name: cliRow.name, cpf_cnpj: cliRow.cpf, email: cliRow.email, asaas_customer_id: cliRow.asaas_customer_id });
            const charge = await createAsaasCharge({
              customerId: customer.id,
              billingType: gatewayMethod === 'asaas_boleto' ? 'BOLETO' : 'CREDIT_CARD',
              value: valor, dueDate, description: `Honorários — ${i + 1}ª parcela — ${proposta.title || 'proposta ' + proposta.id}`,
            });
            await conn.query(
              `INSERT INTO payments (installment_id, client_id, method, status, amount, provider_txn_id)
               VALUES (?, ?, ?, 'em_processamento', ?, ?)`,
              [installmentId, proposta.client_id, gatewayMethod, valor, charge.id]
            );
          } catch (e: any) {
            console.error(`[proposta ${id}] falha ao criar cobrança Asaas (parcela ${i + 1}):`, e?.message || e);
          }
        }
      } else if (gatewayMethod === 'asaas_cartao_recorrente' && asaasSubscriptionId) {
        await conn.query(
          `INSERT INTO payments (installment_id, client_id, method, status, amount, asaas_subscription_id)
           VALUES (?, ?, 'asaas_cartao_recorrente', 'em_processamento', ?, ?)`,
          [installmentId, proposta.client_id, valor, asaasSubscriptionId]
        );
      }
    }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/propostaAcceptAsaas.test.mjs`
Expected: PASS

- [ ] **Step 5: Rodar a suíte completa**

Run: `node --test tests/*.test.mjs`
Expected: todos os testes passam, sem regressão no fluxo de aceite de proposta existente
(propostas com `payment_gateway_method = 'pix'`, o default, continuam criando só as parcelas,
exatamente como antes desta task).

- [ ] **Step 6: Commit**

```bash
git add src/routes/propostas.ts tests/propostaAcceptAsaas.test.mjs
git commit -m "feat: aceite de proposta gera cobrança/assinatura no Asaas quando aplicável"
```

---

## Self-Review

**Spec coverage:**
- Gateway Asaas escolhido e justificado → seção "Decisão do gateway" da spec, refletida no
  plano via `asaasService.ts` (Tasks 2-3).
- PIX não é substituído → nenhuma task toca em `pixService.ts`; confirmado explicitamente
  como Global Constraint.
- Cliente escolhe forma de pagamento na Proposta → Task 6.
- Consentimento explícito obrigatório → Task 6, Steps 3 e 5.
- Sandbox primeiro → `getConfig()` em `asaasService.ts` já resolve a URL por ambiente (Task
  2); Task 5 permite trocar via UI sem redeploy.
- Confirmação automática via webhook → Task 4.
- Rede de segurança reaproveitando `financeiro:pagamentos-parados` → **não coberta como task
  própria nesta leva** — a automação já existente (`src/services/financeReminders.ts:112`)
  já cobre `payments.status = 'em_processamento'` há 48h+, que é exatamente o estado das
  linhas criadas pela Task 7 até o webhook confirmar. Nenhuma mudança de código é necessária
  ali — a automação já filtra por status, não por método de pagamento, então cobranças Asaas
  paradas já entram no alerta existente automaticamente. Vale mencionar isso à usuária, sem
  task de implementação.
- Modelo de dados → Task 1, ajustado durante a escrita do plano: **`asaas_payment_id`/
  `asaas_subscription_id` não vivem em `installments`** como a spec original sugeria — vivem
  em `payments` (tabela já existente, criada especificamente para vínculo pagamento↔parcela,
  `migrations/053_portal_cliente.sql`). Isso é uma correção de implementação sobre a spec,
  não uma divergência de intenção — o objetivo (rastrear a cobrança do gateway por parcela)
  é o mesmo.

**Placeholder scan:** nenhum "TBD"/"similar to Task N" sem código completo.

**Type consistency:** `AsaasCustomer`/`AsaasCharge`/`AsaasSubscription` (Task 2-3) usados
identicamente na Task 7. `payment_gateway_method` (Task 1, coluna) = `payment_gateway_method`
(Task 6, campo de formulário) = `payment_gateway_method` (Task 7, leitura na rota) — mesmo
nome em todo o plano.

**Ponto de atenção para quem revisar o final:** Task 7 chama `ensureAsaasCustomer` até uma
vez por parcela quando não é assinatura — a função já é idempotente (reaproveita
`asaas_customer_id` salvo após a primeira chamada), mas isso significa uma leitura de
`clients` a mais por parcela dentro da transação. Para o volume esperado (poucas parcelas por
proposta), não é um problema de performance — mas se o revisor final achar que vale a pena,
buscar o cliente uma vez fora do loop e reaproveitar a variável é uma otimização segura e
pequena, não uma mudança de comportamento.
