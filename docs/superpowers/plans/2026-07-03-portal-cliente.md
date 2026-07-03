# Portal do Cliente 2.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal do cliente com andamento amigável + recado, documentos liberados, pagamento Pix do escritório ("Já paguei" → em processamento → alerta → baixa manual), e controles do escritório.

**Architecture:** Migration 053 adiciona `client_message`, `visible_to_client`, `office_settings`, `payments` e o status `em_processamento`. Backend: gerador Pix EMV puro (`pixService.ts`, testado com node:test), rotas novas `settings.ts` e `payments.ts`, extensão de `portal.ts`. Frontend: portal repaginado em `app.js` + controles no GED/produção/Configurações/Financeiro.

**Tech Stack:** Node/Express/TS + MySQL + vanilla JS. Nova dep: `qrcode` (PNG data-URI). Testes: `node:test` nativo (só p/ lógica pura do Pix).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-03-portal-cliente-design.md` (aprovada).
- Design system: ícones SVG via `svgIcon()` (NUNCA emoji como ícone), navy+dourado, responsivo, temas (`[data-theme]`), copy em PT-BR.
- Git: SEMPRE `git fetch origin && git rebase origin/main` antes de push (vários terminais). Deploy = push na `main` (Railway roda migrations).
- Isolamento: TODA rota do portal filtra por `clientId` do middleware `loadClientId`.
- Validar antes de commit: `npx tsc --noEmit` e `node --check public/app.js`.
- `installments.status` é ENUM — a migration DEVE fazer `MODIFY COLUMN` para incluir `em_processamento`.

---

### Task 1: Migration 053 (schema do portal)

**Files:**
- Create: `migrations/053_portal_cliente.sql`

**Interfaces:**
- Produces: colunas `cases.client_message` (TEXT NULL), `documents.visible_to_client` (TINYINT(1) DEFAULT 0), tabelas `office_settings(setting_key, setting_value, updated_at)` e `payments(...)`, ENUM de `installments.status` com `em_processamento`.

- [ ] **Step 1: Criar a migration**

```sql
-- ============================================================
-- Migration 053 — Portal do Cliente 2.0
-- Recado ao cliente, documentos liberados, config do escritório (Pix/WhatsApp)
-- e pagamentos declarados pelo cliente (Pix manual; pronto p/ gateway depois).
-- ============================================================

ALTER TABLE cases
  ADD COLUMN client_message TEXT NULL;

ALTER TABLE documents
  ADD COLUMN visible_to_client TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE installments
  MODIFY COLUMN status ENUM('pendente','pago','vencido','cancelado','em_processamento') NOT NULL DEFAULT 'pendente';

CREATE TABLE IF NOT EXISTS office_settings (
  setting_key   VARCHAR(60) PRIMARY KEY,
  setting_value TEXT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  installment_id INT UNSIGNED NOT NULL,
  client_id      INT UNSIGNED NOT NULL,
  method         ENUM('pix_manual','mercadopago') NOT NULL DEFAULT 'pix_manual',
  status         ENUM('em_processamento','confirmado','recusado') NOT NULL DEFAULT 'em_processamento',
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  note           VARCHAR(500) NULL,
  provider_txn_id VARCHAR(120) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at   DATETIME NULL,
  confirmed_by   INT UNSIGNED NULL,
  INDEX idx_payments_installment (installment_id),
  INDEX idx_payments_status (status),
  INDEX idx_payments_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

(Obs.: o runner de migrations divide por `;` e ignora linhas `--`; não usar `;` dentro de statement.)

- [ ] **Step 2: Verificar sintaxe da migration no MySQL local (se disponível) ou revisar manualmente**

Run: `node -e "const s=require('fs').readFileSync('migrations/053_portal_cliente.sql','utf8'); console.log(s.split(';').map(x=>x.trim()).filter(Boolean).length + ' statements')"
Expected: `5 statements`

- [ ] **Step 3: Commit**

```bash
git add migrations/053_portal_cliente.sql
git commit -m "feat(portal): migration 053 - client_message, visible_to_client, office_settings, payments, status em_processamento"
```

---

### Task 2: Gerador Pix (BR Code EMV) com TDD

**Files:**
- Create: `src/services/pixService.ts`
- Test: `tests/pix.test.mjs` (node:test nativo, roda contra o build)
- Modify: `package.json` (dep `qrcode`, script `test`)

**Interfaces:**
- Produces: `buildPixPayload(opts: { key: string; name: string; city: string; amount?: number; txid?: string }): string` — payload EMV copia-e-cola com CRC16.
- Produces: `pixQrDataUri(payload: string): Promise<string>` — PNG data-URI do QR (usa `qrcode`).

- [ ] **Step 1: Instalar a dependência e o script de teste**

```bash
npm i qrcode && npm i -D @types/qrcode
```

Em `package.json` → scripts, adicionar: `"test": "node --test tests/"`.

- [ ] **Step 2: Escrever o teste que falha**

```js
// tests/pix.test.mjs — valida o payload EMV (formato + CRC16)
import { test } from 'node:test';
import assert from 'node:assert';
import { buildPixPayload } from '../dist/services/pixService.js';

test('payload começa com 000201 e contém a chave pix', () => {
  const p = buildPixPayload({ key: 'chave@pix.com', name: 'LETICIA BARROS', city: 'VITORIA' });
  assert.ok(p.startsWith('000201'), 'deve começar com 000201');
  assert.ok(p.includes('chave@pix.com'));
  assert.ok(p.includes('br.gov.bcb.pix'));
});

test('valor formatado com 2 casas e campo 54', () => {
  const p = buildPixPayload({ key: 'k', name: 'N', city: 'C', amount: 123.4 });
  assert.ok(p.includes('5406123.40'), 'campo 54 (valor) com tamanho 06 e 123.40');
});

test('CRC16 confere (recalculado bate com o sufixo)', () => {
  const p = buildPixPayload({ key: 'k', name: 'N', city: 'C' });
  const semCrc = p.slice(0, -4);
  // recalcula CRC16-CCITT (0xFFFF, poly 0x1021) do payload sem os 4 últimos chars
  let crc = 0xffff;
  for (const ch of semCrc) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  assert.strictEqual(p.slice(-4), crc.toString(16).toUpperCase().padStart(4, '0'));
});

test('nome truncado a 25 chars e cidade a 15', () => {
  const p = buildPixPayload({ key: 'k', name: 'NOME MUITO GRANDE QUE PASSA DE VINTE E CINCO', city: 'CIDADE MUITO GRANDE QUE PASSA' });
  assert.ok(!p.includes('QUE PASSA DE VINTE E CINCO'));
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run build && npm test`
Expected: FAIL (`Cannot find module '../dist/services/pixService.js'`)

- [ ] **Step 4: Implementar o serviço**

```ts
// src/services/pixService.ts
import QRCode from 'qrcode';

/** Campo EMV: id + tamanho (2 dígitos) + valor. */
function emv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC16-CCITT (0xFFFF / 0x1021) exigido pelo BR Code. */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (const ch of payload) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();

/** Monta o payload Pix copia-e-cola (BR Code EMV estático). */
export function buildPixPayload(opts: { key: string; name: string; city: string; amount?: number; txid?: string }): string {
  const name = ascii(opts.name).slice(0, 25) || 'RECEBEDOR';
  const city = ascii(opts.city).slice(0, 15) || 'BRASIL';
  const mai = emv('00', 'br.gov.bcb.pix') + emv('01', opts.key.trim());
  let p = emv('00', '01') + emv('26', mai) + emv('52', '0000') + emv('53', '986');
  if (opts.amount && opts.amount > 0) p += emv('54', opts.amount.toFixed(2));
  p += emv('58', 'BR') + emv('59', name) + emv('60', city);
  p += emv('62', emv('05', (opts.txid || '***').slice(0, 25)));
  p += '6304';
  return p + crc16(p);
}

/** Gera o QR do payload como PNG data-URI (para <img src=...>). */
export async function pixQrDataUri(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { margin: 1, width: 280 });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run build && npm test`
Expected: `4 passing`

- [ ] **Step 6: Commit**

```bash
git add src/services/pixService.ts tests/pix.test.mjs package.json package-lock.json
git commit -m "feat(pix): gerador BR Code EMV (copia-e-cola + QR) com testes node:test"
```

---

### Task 3: Rotas de configurações do escritório e pagamentos (staff)

**Files:**
- Create: `src/routes/office-settings.ts`
- Create: `src/routes/payments.ts`
- Modify: `src/app.ts` (imports + mounts)

**Interfaces:**
- Consumes: `db` (mysql2 pool), `notificationService.create(...)`, `sendEmail` de `./EmailService`.
- Produces: `GET/PATCH /api/office-settings` (admin) — objeto `{ pix_key, pix_nome, pix_cidade, whatsapp }`.
- Produces: `GET /api/payments?status=em_processamento` (staff), `POST /api/payments/:id/confirmar`, `POST /api/payments/:id/recusar`.

- [ ] **Step 1: Criar `src/routes/office-settings.ts`**

```ts
import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();
const KEYS = ['pix_key', 'pix_nome', 'pix_cidade', 'whatsapp'];

// ── GET /api/office-settings — config do escritório (Pix, WhatsApp) ─────────
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT setting_key, setting_value FROM office_settings') as any;
  const out: Record<string, string> = {};
  for (const k of KEYS) out[k] = '';
  for (const r of rows) if (KEYS.includes(r.setting_key)) out[r.setting_key] = r.setting_value || '';
  res.json(out);
});

// ── PATCH /api/office-settings — grava (upsert) as chaves conhecidas ────────
router.patch('/', async (req: Request, res: Response) => {
  for (const k of KEYS) {
    if (req.body[k] === undefined) continue;
    await db.query(
      'INSERT INTO office_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [k, String(req.body[k] ?? '').trim()]
    );
  }
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: Criar `src/routes/payments.ts`**

```ts
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

// ── POST /api/payments/:id/confirmar — baixa de fato a parcela ──────────────
router.post('/:id/confirmar', async (req: Request, res: Response) => {
  const [[p]] = await db.query('SELECT * FROM payments WHERE id = ? AND status = "em_processamento"', [req.params.id]) as any;
  if (!p) { res.status(404).json({ error: 'Pagamento não encontrado ou já tratado' }); return; }
  await db.query('UPDATE payments SET status = "confirmado", confirmed_at = NOW(), confirmed_by = ? WHERE id = ?', [req.user!.id, p.id]);
  await db.query('UPDATE installments SET status = "pago", paid_at = NOW() WHERE id = ?', [p.installment_id]);
  await logTimeline({ clientId: p.client_id, eventType: 'financeiro', description: `Pagamento da parcela confirmado (R$ ${Number(p.amount).toFixed(2)})` }).catch(() => {});
  res.json({ success: true });
});

// ── POST /api/payments/:id/recusar — devolve a parcela para pendente ────────
router.post('/:id/recusar', async (req: Request, res: Response) => {
  const [[p]] = await db.query('SELECT * FROM payments WHERE id = ? AND status = "em_processamento"', [req.params.id]) as any;
  if (!p) { res.status(404).json({ error: 'Pagamento não encontrado ou já tratado' }); return; }
  await db.query('UPDATE payments SET status = "recusado", confirmed_at = NOW(), confirmed_by = ? WHERE id = ?', [req.user!.id, p.id]);
  await db.query('UPDATE installments SET status = "pendente" WHERE id = ?', [p.installment_id]);
  res.json({ success: true });
});

export default router;
```

(Antes de usar `logTimeline`, conferir a assinatura real em `src/services/TimelineService.ts` e ajustar a chamada se necessário; se não houver função compatível, registrar em `client_timeline` por INSERT direto: `INSERT INTO client_timeline (client_id, event_type, description) VALUES (?, 'financeiro', ?)`.)

- [ ] **Step 3: Montar no `src/app.ts`**

Imports (junto dos outros):
```ts
import officeSettingsRoutes from './routes/office-settings';
import paymentsRoutes from './routes/payments';
```
Mounts (perto de `/api/briefing`):
```ts
  app.use('/api/office-settings',       authenticate, requireAdmin, officeSettingsRoutes);
  app.use('/api/payments',              authenticate, requireStaff, paymentsRoutes);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add src/routes/office-settings.ts src/routes/payments.ts src/app.ts
git commit -m "feat(portal): rotas office-settings (pix/whatsapp) e payments (fila confirmar/recusar)"
```

---

### Task 4: Backend do portal (cliente)

**Files:**
- Modify: `src/routes/portal.ts`

**Interfaces:**
- Consumes: `buildPixPayload`, `pixQrDataUri` (Task 2); `office_settings`, `payments` (Task 1); `notificationService` + `sendEmail` p/ alerta.
- Produces (todas sob `loadClientId`):
  - `GET /api/portal/cases` — inclui `client_message`.
  - `GET /api/portal/cases/:id` — inclui `client_message` e `documents` visíveis do caso.
  - `GET /api/portal/documents` — docs `visible_to_client=1` do cliente.
  - `GET /api/portal/contact` — `{ whatsapp }`.
  - `GET /api/portal/pix/:installmentId` — `{ payload, qr, valor, beneficiario }`.
  - `POST /api/portal/installments/:id/pagar` — body `{ note? }`; cria payment + alerta.

- [ ] **Step 1: Adicionar imports no topo de `portal.ts`**

```ts
import { buildPixPayload, pixQrDataUri } from '../services/pixService';
import { notificationService } from '../services/NotificationService';
import { sendEmail, isEmailConfigured } from '../services/EmailService';
```
(Conferir assinaturas reais de `notificationService.create` — usada em `src/crons/index.ts` — e `sendEmail` em `EmailService.ts`; ajustar chamadas conforme.)

- [ ] **Step 2: Incluir `client_message` nos SELECTs de `/cases` e `/cases/:id`**

Em `GET /cases`: `SELECT id, case_number, title, legal_area, phase, status, production_stage, client_message, created_at ...`
Em `GET /cases/:id`: idem + após movements, buscar docs visíveis do caso:
```ts
  const [docs] = await db.query(
    "SELECT id, name, file_url, created_at FROM documents WHERE case_id = ? AND client_id = ? AND visible_to_client = 1 AND file_url IS NOT NULL ORDER BY created_at DESC",
    [req.params.id, clientId]
  ) as any;
  res.json({ ...rows[0], movements, documents: docs });
```

- [ ] **Step 3: Novas rotas no `portal.ts` (antes do `export default`)**

```ts
// ── GET /api/portal/documents — documentos liberados para mim ───────────────
router.get('/documents', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT d.id, d.name, d.file_url, d.created_at, c.title AS case_title
       FROM documents d LEFT JOIN cases c ON c.id = d.case_id
      WHERE d.client_id = ? AND d.visible_to_client = 1 AND d.file_url IS NOT NULL AND d.file_url <> ''
      ORDER BY d.created_at DESC`, [(req as any).clientId]) as any;
  res.json(rows);
});

// ── GET /api/portal/contact — canal com o escritório ────────────────────────
router.get('/contact', async (_req: Request, res: Response) => {
  const [rows] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'whatsapp'") as any;
  res.json({ whatsapp: rows[0]?.setting_value || '' });
});

// ── GET /api/portal/pix/:installmentId — dados do Pix para a parcela ────────
router.get('/pix/:installmentId', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [[inst]] = await db.query(
    "SELECT id, valor, numero FROM installments WHERE id = ? AND client_id = ? AND status IN ('pendente','vencido')",
    [req.params.installmentId, clientId]) as any;
  if (!inst) { res.status(404).json({ error: 'Parcela não encontrada ou já paga' }); return; }
  const [cfg] = await db.query("SELECT setting_key, setting_value FROM office_settings WHERE setting_key IN ('pix_key','pix_nome','pix_cidade')") as any;
  const map: any = {}; for (const r of cfg) map[r.setting_key] = r.setting_value || '';
  if (!map.pix_key) { res.status(400).json({ error: 'O escritório ainda não configurou a chave Pix' }); return; }
  const payload = buildPixPayload({ key: map.pix_key, name: map.pix_nome || 'ADVOCACIA', city: map.pix_cidade || 'BRASIL', amount: Number(inst.valor), txid: `PARC${inst.id}` });
  const qr = await pixQrDataUri(payload);
  res.json({ payload, qr, valor: Number(inst.valor), numero: inst.numero, beneficiario: map.pix_nome || '' });
});

// ── POST /api/portal/installments/:id/pagar — cliente declara o pagamento ───
router.post('/installments/:id/pagar', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [[inst]] = await db.query(
    "SELECT id, valor, numero FROM installments WHERE id = ? AND client_id = ? AND status IN ('pendente','vencido')",
    [req.params.id, clientId]) as any;
  if (!inst) { res.status(404).json({ error: 'Parcela não encontrada ou já em processamento' }); return; }
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  await db.query(
    "INSERT INTO payments (installment_id, client_id, method, status, amount, note) VALUES (?, ?, 'pix_manual', 'em_processamento', ?, ?)",
    [inst.id, clientId, inst.valor, note]);
  await db.query("UPDATE installments SET status = 'em_processamento' WHERE id = ?", [inst.id]);

  // Alerta ao escritório: sino p/ admins + e-mail (best-effort)
  const [[cl]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
  const [admins] = await db.query("SELECT id, email FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await notificationService.create({
      userId: a.id,
      title: 'Pagamento informado pelo cliente',
      message: `${cl?.name || 'Cliente'} marcou a parcela ${inst.numero ? inst.numero + 'ª' : ''} (R$ ${Number(inst.valor).toFixed(2)}) como paga — confira e dê baixa no Financeiro.`,
      notificationType: 'pagamento_informado',
      channel: 'sistema',
      scheduledAt: new Date(),
    }).catch(() => {});
    if (a.email && isEmailConfigured()) {
      sendEmail({
        to: a.email,
        subject: `Pagamento informado — ${cl?.name || 'Cliente'}`,
        html: `<p><strong>${cl?.name || 'Cliente'}</strong> informou o pagamento da parcela ${inst.numero ? inst.numero + 'ª' : ''} no valor de <strong>R$ ${Number(inst.valor).toFixed(2)}</strong>.</p><p>Confira o extrato e dê baixa em <em>Financeiro → Pagamentos a confirmar</em>.</p>`,
      }).catch(() => {});
    }
  }
  res.json({ success: true, status: 'em_processamento' });
});
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add src/routes/portal.ts
git commit -m "feat(portal): documentos liberados, contato, pix da parcela e 'ja paguei' com alerta ao escritorio"
```

---

### Task 5: Controles do escritório (frontend `public/app.js`)

**Files:**
- Modify: `public/app.js` — 4 pontos: (a) Configurações; (b) painel de produção do caso (recado + toggle docs); (c) GED (toggle); (d) Financeiro (fila de confirmação).

**Interfaces:**
- Consumes: `/api/office-settings`, `/api/payments*`, `PATCH /api/cases/:id/production-meta` (aceitará `client_message` — ver passo b2), `PATCH /api/documents/:id` (aceitará `visible_to_client` — conferir rota existente de documents; se não houver PATCH, criar em `src/routes/documents.ts`).

- [ ] **Step (a): Configurações — cartão "Escritório (Pix e WhatsApp)"**

No `async config(page)`, após o cartão "Aparência", inserir:
```js
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="color:var(--navy);margin-bottom:6px">Escritório — Pix e contato</h3>
        <p class="sub" style="margin-bottom:12px">Usados no portal do cliente (pagar com Pix e falar com o escritório).</p>
        <div class="form-row"><label>Chave Pix<input id="os-pix-key" placeholder="e-mail, CPF/CNPJ, telefone ou aleatória" /></label>
        <label>Nome do beneficiário<input id="os-pix-nome" placeholder="ex.: Leticia Barros Advocacia" /></label></div>
        <div class="form-row"><label>Cidade<input id="os-pix-cidade" placeholder="ex.: Vitória" /></label>
        <label>WhatsApp do escritório<input id="os-whats" placeholder="ex.: 5527999998888" /></label></div>
        <button class="btn-gold btn-sm" id="os-save" style="margin-top:8px">Salvar</button>
      </div>
```
E o handler (junto dos outros):
```js
    (async () => {
      try {
        const os = await api('/api/office-settings');
        $('#os-pix-key').value = os.pix_key || ''; $('#os-pix-nome').value = os.pix_nome || '';
        $('#os-pix-cidade').value = os.pix_cidade || ''; $('#os-whats').value = os.whatsapp || '';
      } catch {}
    })();
    $('#os-save').onclick = async () => {
      try {
        await api('/api/office-settings', { method: 'PATCH', body: JSON.stringify({
          pix_key: $('#os-pix-key').value, pix_nome: $('#os-pix-nome').value,
          pix_cidade: $('#os-pix-cidade').value, whatsapp: $('#os-whats').value }) });
        toast('Configurações do escritório salvas');
      } catch (e) { toast(e.message, 'error'); }
    };
```

- [ ] **Step (b1): Painel de produção — campo "Recado ao cliente"**

No painel de produção (perto do campo `#prod-drive`), inserir:
```js
        <div style="margin-top:10px"><small style="color:var(--text-muted)">Recado ao cliente (aparece no portal, em linguagem simples)</small>
          <div style="display:flex;gap:6px;margin-top:4px"><input id="prod-climsg" placeholder="ex.: Seu processo foi protocolado; agora aguardamos a resposta do INSS" value="${esc(p.client_message || '')}" style="flex:1"><button class="btn-sm" type="button" id="prod-climsg-save">Salvar</button></div></div>
```
Handler (junto de `dsave`):
```js
      const cmsave = panel.querySelector('#prod-climsg-save');
      if (cmsave) cmsave.onclick = async () => { try { await api(`/api/cases/${id}/production-meta`, { method: 'PATCH', body: JSON.stringify({ client_message: panel.querySelector('#prod-climsg').value.trim() }) }); toast('Recado salvo — visível no portal do cliente'); } catch (e) { toast(e.message, 'error'); } };
```

- [ ] **Step (b2): Backend aceita `client_message` no production-meta**

Em `src/routes/cases.ts`, no `PATCH /:id/production-meta`, adicionar:
```ts
  const { labels, assignee, drive_folder_url, client_message } = req.body;
  ...
  if (client_message !== undefined) { sets.push('client_message = ?'); params.push(client_message ? String(client_message).trim() : null); }
```
E conferir que o `GET /:id/production` retorna `client_message` (o SELECT usa `c.*`, então já vem).

- [ ] **Step (c): Toggle "visível ao cliente" nos documentos do caso (painel produção)**

Onde os documentos do caso são listados no painel (`#prod-docs`), adicionar por documento um botão de alternância:
```js
  <button class="btn-sm" type="button" data-vis="${d.id}" data-on="${d.visible_to_client ? 1 : 0}" title="Mostrar/ocultar no portal do cliente">${d.visible_to_client ? 'Visível ao cliente ✓' : 'Liberar p/ cliente'}</button>
```
Handler:
```js
      panel.querySelectorAll('[data-vis]').forEach((b) => b.onclick = async () => {
        const on = b.dataset.on !== '1';
        try { await api(`/api/documents/${b.dataset.vis}`, { method: 'PATCH', body: JSON.stringify({ visible_to_client: on }) }); toast(on ? 'Documento liberado no portal' : 'Documento oculto do portal'); loadProd(); }
        catch (e) { toast(e.message, 'error'); }
      });
```
Backend: em `src/routes/documents.ts`, garantir `PATCH /:id` que aceite `visible_to_client` (se já existir PATCH, estender; senão criar):
```ts
router.patch('/:id', async (req: Request, res: Response) => {
  const sets: string[] = []; const params: any[] = [];
  if (req.body.visible_to_client !== undefined) { sets.push('visible_to_client = ?'); params.push(req.body.visible_to_client ? 1 : 0); }
  if (!sets.length) { res.status(400).json({ error: 'Nada para atualizar' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});
```
E o SELECT do painel de produção que lista os docs do caso deve incluir `visible_to_client` (conferir em cases.ts `GET /:id/production` a query de documents e adicionar a coluna).

- [ ] **Step (d): Financeiro — aba "Pagamentos a confirmar"**

Na tela `financeiro` (onde estão as abas), adicionar a aba `Pagamentos` e a função:
```js
async function finPagamentos(c) {
  const rows = await api('/api/payments?status=em_processamento');
  c.innerHTML = rows.length ? `
    <div class="card"><table><thead><tr><th>Cliente</th><th>Parcela</th><th>Valor</th><th>Informado em</th><th>Obs.</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td><strong>${esc(p.client_name)}</strong></td>
      <td>${p.numero ? p.numero + 'ª' : '—'}${p.proposta ? `<br><small style="color:var(--text-muted)">${esc(p.proposta)}</small>` : ''}</td>
      <td>${money(p.amount)}</td><td>${fmtDate(p.created_at)}</td><td>${esc(p.note || '—')}</td>
      <td style="white-space:nowrap"><button class="btn-gold btn-sm" data-pay-ok="${p.id}">Confirmar baixa</button> <button class="btn-sm" data-pay-no="${p.id}">Recusar</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nenhum pagamento aguardando confirmação</div>';
  c.querySelectorAll('[data-pay-ok]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/payments/${b.dataset.payOk}/confirmar`, { method: 'POST' }); toast('Baixa confirmada — parcela paga'); finPagamentos(c); } catch (e) { toast(e.message, 'error'); }
  });
  c.querySelectorAll('[data-pay-no]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/payments/${b.dataset.payNo}/recusar`, { method: 'POST' }); toast('Pagamento recusado — parcela voltou a pendente'); finPagamentos(c); } catch (e) { toast(e.message, 'error'); }
  });
}
```
Registrar a aba no objeto de abas do financeiro (seguir o padrão existente `tabs = { ... }`).

- [ ] **Step: Validar e commitar**

Run: `npx tsc --noEmit && node --check public/app.js`
Expected: sem erros
```bash
git add public/app.js src/routes/cases.ts src/routes/documents.ts
git commit -m "feat(portal): controles do escritorio - config pix/whatsapp, recado ao cliente, liberar documento, fila de pagamentos"
```

---

### Task 6: Portal do cliente repaginado (frontend `public/app.js` + CSS)

**Files:**
- Modify: `public/app.js` — funções `portal(page)` e `portalFinanceiro(page)`, `portalCaseDetail`.
- Modify: `public/styles.css` — estilos `.stepper` (linha de etapas) e painel Pix.

**Interfaces:**
- Consumes: `/api/portal/me|cases|cases/:id|documents|contact|pix/:id`, `POST /api/portal/installments/:id/pagar`.

- [ ] **Step 1: CSS — linha de etapas + painel pix (final do styles.css)**

```css
/* ── Portal do cliente: linha de etapas amigável ── */
.stepper { display: flex; align-items: flex-start; gap: 0; margin: 10px 0 4px; }
.step { flex: 1; text-align: center; position: relative; min-width: 0; }
.step::before { content: ''; position: absolute; top: 10px; left: -50%; width: 100%; height: 2px; background: var(--border); }
.step:first-child::before { display: none; }
.step .dot { position: relative; z-index: 1; width: 22px; height: 22px; margin: 0 auto; border-radius: 50%;
  background: var(--surface); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted); }
.step.done .dot { background: var(--gold); border-color: var(--gold); color: #fff; }
.step.now .dot { border-color: var(--gold); color: var(--gold); font-weight: 700; box-shadow: 0 0 0 4px rgba(193,154,78,.15); }
.step.done::before, .step.now::before { background: var(--gold); }
.step .lb { font-size: 10.5px; margin-top: 6px; color: var(--text-muted); line-height: 1.25; }
.step.now .lb { color: var(--navy-deep); font-weight: 600; }
/* recado da advogada */
.client-msg { background: rgba(193,154,78,.08); border-left: 3px solid var(--gold); border-radius: 10px; padding: 11px 14px; font-size: 13.5px; color: var(--text); margin-top: 10px; }
/* painel pix */
.pix-box { border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: var(--surface-2); margin-top: 10px; }
.pix-box img { display: block; margin: 10px auto; border-radius: 10px; max-width: 240px; }
.pix-copy { display: flex; gap: 6px; margin-top: 8px; }
.pix-copy input { flex: 1; font-size: 12px; }
@media (max-width: 560px) { .step .lb { font-size: 9px; } }
```

- [ ] **Step 2: JS — helper de etapas amigáveis**

```js
// Etapas amigáveis do processo para o cliente (produção → judicial)
const PORTAL_STEPS = [
  { id: 'documentos', label: 'Documentos' },
  { id: 'elaboracao', label: 'Elaboração' },
  { id: 'protocolo', label: 'Protocolo' },
  { id: 'andamento', label: 'Em andamento' },
  { id: 'conclusao', label: 'Conclusão' },
];
function portalStepIndex(c) {
  // produção: separacao_documentos→0, criacao/revisao→1, aguardando_protocolo→2, protocolado→3
  const ps = c.production_stage;
  if (ps === 'separacao_documentos') return 0;
  if (ps === 'criacao_inicial' || ps === 'revisao_inicial') return 1;
  if (ps === 'aguardando_protocolo') return 2;
  if (c.status === 'encerrado' || c.phase === 'encerrado' || ps === 'concluido') return 4;
  if (ps === 'protocolado' || c.case_number) return 3;
  return 0;
}
function stepperHtml(c) {
  const cur = portalStepIndex(c);
  return `<div class="stepper">${PORTAL_STEPS.map((s, i) => `
    <div class="step ${i < cur ? 'done' : ''} ${i === cur ? 'now' : ''}">
      <div class="dot">${i < cur ? '✓' : i + 1}</div><div class="lb">${s.label}</div>
    </div>`).join('')}</div>`;
}
```

- [ ] **Step 3: JS — reescrever `portal(page)`**

```js
  async portal(page) {
    const [me, cases, contact] = await Promise.all([
      api('/api/portal/me'), api('/api/portal/cases'), api('/api/portal/contact').catch(() => ({ whatsapp: '' })),
    ]);
    const wa = (contact.whatsapp || '').replace(/\D/g, '');
    page.innerHTML = `
      <div class="page-header"><div><h2>Olá, ${esc((me.name || '').split(' ')[0])}</h2><p class="sub">Acompanhe seus processos e pagamentos</p></div>
        ${wa ? `<a class="btn-gold" href="https://wa.me/${wa}" target="_blank" rel="noopener">Falar com o escritório</a>` : ''}</div>
      <div class="kpi-grid">
        ${kpi('Processos ativos', me.resumo.processos_ativos)}
        ${kpi('Valores a pagar', money(me.resumo.a_pagar), 'money')}
        ${kpi('Em atraso', money(me.resumo.vencido), 'money')}
      </div>
      <div id="portal-cases"></div>
      <div class="card" style="margin-top:16px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Meus documentos</strong></div><div id="portal-docs"></div></div>
      <div class="card" style="margin-top:16px"><div style="padding:14px 18px;border-bottom:1px solid var(--border)"><strong style="color:var(--navy)">Atualizações</strong></div><div id="portal-tl"></div></div>`;
    $('#portal-cases').innerHTML = cases.length ? cases.map((c) => `
      <div class="card" style="padding:18px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
          <strong style="font-size:15.5px;color:var(--navy-deep)">${esc(c.title)}</strong>
          <small style="color:var(--text-muted)">${c.case_number ? 'Processo ' + esc(c.case_number) : 'Em preparação'}</small>
        </div>
        ${stepperHtml(c)}
        ${c.client_message ? `<div class="client-msg">${esc(c.client_message)}</div>` : ''}
        <div style="margin-top:10px"><button class="btn-sm" data-pcase="${c.id}">Ver detalhes</button></div>
      </div>`).join('') : '<div class="empty">Nenhum processo no momento</div>';
    document.querySelectorAll('[data-pcase]').forEach((b) => b.onclick = () => portalCaseDetail(b.dataset.pcase));
    api('/api/portal/documents').then((docs) => {
      $('#portal-docs').innerHTML = docs.length ? docs.map((d) => `
        <div class="mini-row"><span>${esc(d.name)}${d.case_title ? `<br><small style="color:var(--text-muted)">${esc(d.case_title)}</small>` : ''}</span>
        <a class="btn-sm" href="${esc(d.file_url)}" target="_blank" rel="noopener">Baixar</a></div>`).join('')
        : '<div class="empty" style="padding:16px">Nenhum documento liberado ainda</div>';
    }).catch(() => { $('#portal-docs').innerHTML = '<div class="empty" style="padding:16px">—</div>'; });
    api('/api/portal/timeline').then((tl) => {
      $('#portal-tl').innerHTML = tl.length ? tl.map((e) => `<div class="notif-item"><strong>${esc(e.description)}</strong><div style="margin-top:4px"><small>${e.case_number ? 'Proc. ' + esc(e.case_number) + ' · ' : ''}${fmtDate(e.created_at)}</small></div></div>`).join('') : '<div class="empty">Sem atualizações ainda</div>';
    });
  },
```

- [ ] **Step 4: JS — `portalFinanceiro(page)` com "Pagar com Pix" e "Já paguei"**

```js
  async portalFinanceiro(page) {
    const load = async () => {
      const items = await api('/api/portal/financial');
      const totalPagar = items.filter((i) => ['pendente', 'em_processamento'].includes(i.status)).reduce((s, i) => s + Number(i.valor), 0);
      page.innerHTML = `
        <div class="page-header"><div><h2>Valores a Pagar</h2><p class="sub">Suas parcelas — pague com Pix e avise com um clique</p></div></div>
        <div class="kpi-grid">${kpi('Total a pagar', money(totalPagar), 'money')}</div>
        <div id="pf-list"></div>`;
      $('#pf-list').innerHTML = items.length ? items.map((i) => `
        <div class="card" style="padding:16px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
            <div><strong>${i.numero ? i.numero + 'ª parcela' : 'Parcela'}</strong>${i.proposta ? ` <small style="color:var(--text-muted)">· ${esc(i.proposta)}</small>` : ''}
              <div style="font-size:13px;color:var(--text-muted)">vence ${fmtDate(i.due_date)} ${i.vencida ? '<span class="badge vencido">vencida</span>' : ''}</div></div>
            <div style="display:flex;align-items:center;gap:10px">
              <strong style="font-size:17px;color:var(--navy-deep)">${money(i.valor)}</strong>
              ${i.status === 'pago' ? '<span class="badge pago">paga</span>'
                : i.status === 'em_processamento' ? '<span class="badge em_processamento" style="background:var(--amber-bg);color:var(--amber)">em processamento</span>'
                : `<button class="btn-gold btn-sm" data-pix="${i.id}">Pagar com Pix</button>`}
            </div>
          </div>
          <div id="pix-${i.id}"></div>
        </div>`).join('') : '<div class="empty">Nenhuma parcela registrada</div>';
      $('#pf-list').querySelectorAll('[data-pix]').forEach((b) => b.onclick = async () => {
        const id = b.dataset.pix; const box = $(`#pix-${id}`);
        if (box.innerHTML) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="spinner"></div>';
        try {
          const r = await api('/api/portal/pix/' + id);
          box.innerHTML = `<div class="pix-box">
            <div style="font-size:13.5px"><strong>Como pagar:</strong> abra o app do seu banco, escolha <strong>Pix</strong>, e aponte a câmera para o código abaixo — ou copie e cole a chave.</div>
            <img src="${r.qr}" alt="QR Code Pix">
            <div class="pix-copy"><input readonly value="${esc(r.payload)}" id="pixv-${id}"><button class="btn-sm" data-copy-pix="${id}">Copiar</button></div>
            <div style="text-align:center;margin-top:12px">
              <button class="btn-primary" data-paguei="${id}" style="width:auto">Já paguei ✓</button>
              <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Depois de pagar, clique acima — o escritório vai conferir e confirmar.</div>
            </div></div>`;
          box.querySelector(`[data-copy-pix]`).onclick = () => { const inp = $(`#pixv-${id}`); inp.select(); try { navigator.clipboard.writeText(inp.value); toast('Código Pix copiado'); } catch { document.execCommand('copy'); toast('Código copiado'); } };
          box.querySelector(`[data-paguei]`).onclick = async (ev) => {
            ev.target.disabled = true; ev.target.textContent = 'Enviando…';
            try { await api(`/api/portal/installments/${id}/pagar`, { method: 'POST', body: '{}' }); toast('Aviso enviado! O escritório vai confirmar o pagamento.'); load(); }
            catch (e) { toast(e.message, 'error'); ev.target.disabled = false; ev.target.textContent = 'Já paguei ✓'; }
          };
        } catch (e) { box.innerHTML = ''; toast(e.message, 'error'); }
      });
    };
    await load();
  },
```

- [ ] **Step 5: `GET /api/portal/financial` retorna o id da parcela**

Em `portal.ts`, o SELECT de `/financial` deve incluir `i.id` (hoje começa em `i.numero`). Ajustar: `SELECT i.id, i.numero, ...`.

- [ ] **Step 6: Validar e commitar**

Run: `npx tsc --noEmit && node --check public/app.js`
Expected: sem erros
```bash
git add public/app.js public/styles.css src/routes/portal.ts
git commit -m "feat(portal): experiencia do cliente - etapas amigaveis, recado, documentos, pagar com pix e 'ja paguei'"
```

---

### Task 7: Verificação final e deploy

- [ ] **Step 1: Rodar tudo**

Run: `npm run build && npm test && npx tsc --noEmit && node --check public/app.js`
Expected: build ok, 4 testes pix passando, sem erros TS/JS.

- [ ] **Step 2: Sync e push (deploy automático + migration 053 no Railway)**

```bash
git fetch origin && git rebase origin/main && git push
```

- [ ] **Step 3: Verificar produção (após ~2 min)**

- `GET https://crm.advogadaleticiabarros.com.br/health` → ok.
- `POST /api/portal/installments/1/pagar` sem token → 401 (rota existe).
- `GET /api/office-settings` sem token → 401.

- [ ] **Step 4: Roteiro de teste manual (com a usuária)**

1. Configurações → preencher chave Pix, nome, cidade, WhatsApp → Salvar.
2. Num processo: escrever "Recado ao cliente" e liberar um documento.
3. Logar como cliente (usuário papel `cliente`): ver etapas, recado, documento, e pagar → "Já paguei".
4. Como admin: sino + e-mail recebidos; Financeiro → Pagamentos a confirmar → Confirmar baixa.
5. Como cliente: parcela aparece "paga".
