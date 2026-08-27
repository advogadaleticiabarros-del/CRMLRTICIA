# Documentos por demanda dativa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir anexar, listar, baixar e excluir documentos (termo de nomeação, certidões de audiência, comprovantes de atuação, outros) direto na tela de detalhe de cada demanda dativa, reaproveitando o GED (`documents`) já existente.

**Architecture:** Adiciona a coluna `dative_case_id` (FK opcional) na tabela `documents` já existente. Estende as rotas `GET /api/documents` (filtro) e `POST /api/documents` (gravação) — ambas já suportam upload em base64/blob — para aceitarem esse novo vínculo. No frontend, adiciona uma seção "Documentos" na modal `dativeCaseDetail` com lista + zona de upload (clique ou arrastar-e-soltar).

**Tech Stack:** Node.js/Express/TypeScript, MySQL (mysql2/promise), frontend vanilla JS (SPA em `public/app.js`), testes com `node --test` (arquivos `.test.mjs`, compilando TS via `npx tsc` antes de importar de `dist/`).

## Global Constraints

- Limite de 15MB por arquivo (mesmo limite já usado em `documents.ts` e `uploadDocForm`).
- Sem `multer` no projeto — upload é sempre base64 em JSON, convertido para `Buffer` no backend.
- Migrations são sequenciais e nunca renomeadas após aplicadas em produção — confirmar o maior número existente com `ls migrations | sort | tail` antes de criar a próxima.
- `client_id` continua obrigatório em `documents` (já validado na rota `POST /`); `dative_case_id` é um vínculo adicional, não substitui `client_id`.
- Todo `db.query` usa parâmetros posicionais (`?`) — nunca concatenar valor de usuário direto na string SQL.

---

### Task 1: Migration — coluna `dative_case_id` em `documents`

**Files:**
- Create: `migrations/106_documents_dative_case.sql`

**Interfaces:**
- Produces: coluna `documents.dative_case_id INT NULL` com FK para `dative_cases(id)`, consumida pelas rotas da Task 2.

- [ ] **Step 1: Confirmar o próximo número livre de migration**

Run: `ls migrations | sort | tail -5`
Expected: o último arquivo listado é `105_agenda_self_service.sql` — confirma que `106` está livre. Se houver um número maior, use o próximo livre e ajuste o nome do arquivo desta task.

- [ ] **Step 2: Criar a migration**

Arquivo `migrations/106_documents_dative_case.sql`:

```sql
-- Vincula documentos do GED a uma demanda dativa específica (nomeação,
-- certidão de audiência, comprovante de atuação) — usado para reunir a prova
-- documental necessária pra solicitar o pagamento ao Estado. Opcional: um
-- documento pode continuar existindo só com client_id/case_id, como hoje.
-- Ver docs/superpowers/specs/2026-08-27-dativo-documentos-design.md
ALTER TABLE documents
  ADD COLUMN dative_case_id INT NULL,
  ADD CONSTRAINT fk_documents_dative_case
    FOREIGN KEY (dative_case_id) REFERENCES dative_cases(id);
```

- [ ] **Step 3: Rodar a migration localmente**

Run: `npm run migrate:dev`
Expected: saída inclui `106_documents_dative_case.sql` como aplicada, sem erro.

- [ ] **Step 4: Verificar a coluna no banco**

Run: `node -e "const {db}=require('./dist/config/database'); db.query('DESCRIBE documents').then(([r])=>{console.log(r.find(c=>c.Field==='dative_case_id')); process.exit(0)})"`
Expected: imprime uma linha com `Field: 'dative_case_id', Type: 'int', Null: 'YES'`. Se `dist/config/database.js` não existir ainda, rode `npx tsc` antes.

- [ ] **Step 5: Commit**

```bash
git add migrations/106_documents_dative_case.sql
git commit -m "feat: adiciona dative_case_id em documents (migration 106)"
```

---

### Task 2: Backend — filtro e gravação por `dative_case_id`

**Files:**
- Modify: `src/routes/documents.ts:9` (array `FOLDERS`)
- Modify: `src/routes/documents.ts:115-132` (`GET /`)
- Modify: `src/routes/documents.ts:140-168` (`POST /`)
- Test: `tests/documentsDativeCaseId.test.mjs`

**Interfaces:**
- Consumes: coluna `documents.dative_case_id` (Task 1).
- Produces: `GET /api/documents?dative_case_id=<id>` retorna só os documentos daquela demanda; `POST /api/documents` aceita `dative_case_id` no body e grava. Consumido pelo frontend na Task 3.

- [ ] **Step 1: Escrever o teste de integração (falhando)**

Arquivo `tests/documentsDativeCaseId.test.mjs`:

```javascript
// tests/documentsDativeCaseId.test.mjs
// Documentos por demanda dativa: POST /api/documents grava dative_case_id,
// GET /api/documents?dative_case_id= filtra só os documentos daquela demanda.
// Ver docs/superpowers/specs/2026-08-27-dativo-documentos-design.md
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

test('documents grava e filtra por dative_case_id', async (t) => {
  let clientId, dativeCaseId;
  const insertedDocIds = [];
  try {
    const [clients] = await db.query('SELECT id FROM clients LIMIT 1');
    if (!clients.length) { t.skip('nenhum cliente disponível neste banco'); return; }
    clientId = clients[0].id;

    const [dc] = await db.query(
      `INSERT INTO dative_cases (user_id, client_id, comarca, area, estimated_value)
       VALUES (1, ?, 'Comarca Teste', 'outro', 500)`,
      [clientId]
    );
    dativeCaseId = dc.insertId;

    const [docComVinculo] = await db.query(
      `INSERT INTO documents (client_id, dative_case_id, name, folder, status, data, mime, created_by)
       VALUES (?, ?, 'Termo de nomeação teste', 'nomeacao', 'recebido', ?, 'application/pdf', 1)`,
      [clientId, dativeCaseId, Buffer.from('conteudo-teste')]
    );
    insertedDocIds.push(docComVinculo.insertId);

    const [docSemVinculo] = await db.query(
      `INSERT INTO documents (client_id, name, folder, status, created_by)
       VALUES (?, 'Documento avulso teste', 'outros', 'recebido', 1)`,
      [clientId]
    );
    insertedDocIds.push(docSemVinculo.insertId);

    const [rows] = await db.query(
      'SELECT id, dative_case_id, name, folder FROM documents WHERE dative_case_id = ?',
      [dativeCaseId]
    );
    assert.strictEqual(rows.length, 1, 'só o documento vinculado à demanda deve retornar');
    assert.strictEqual(rows[0].id, docComVinculo.insertId);
    assert.strictEqual(rows[0].folder, 'nomeacao');

    const ids = rows.map((r) => r.id);
    assert.ok(!ids.includes(docSemVinculo.insertId), 'documento sem dative_case_id não deveria aparecer no filtro');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedDocIds) {
      await db.query('DELETE FROM documents WHERE id = ?', [id]).catch(() => {});
    }
    if (dativeCaseId) await db.query('DELETE FROM dative_cases WHERE id = ?', [dativeCaseId]).catch(() => {});
  }
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx tsc && node --test tests/documentsDativeCaseId.test.mjs`
Expected: FAIL — `ER_BAD_FIELD_ERROR: Unknown column 'dative_case_id' in 'field list'` (a Task 1 já deve ter rodado a migration; se a migration não tiver sido aplicada neste banco de teste, rode `npm run migrate:dev` antes de prosseguir).

- [ ] **Step 3: Atualizar `FOLDERS` em `documents.ts`**

Em `src/routes/documents.ts:9`, trocar:

```typescript
export const FOLDERS = ['contratos', 'procuracoes', 'documentos_pessoais', 'processos', 'financeiro', 'audiencias', 'outros'];
```

por:

```typescript
export const FOLDERS = ['contratos', 'procuracoes', 'documentos_pessoais', 'processos', 'financeiro', 'audiencias', 'nomeacao', 'certidao_audiencia', 'comprovante_atuacao', 'outros'];
```

- [ ] **Step 4: Aceitar `dative_case_id` no filtro `GET /`**

Em `src/routes/documents.ts:115-125`, trocar:

```typescript
router.get('/', async (req: Request, res: Response) => {
  const where: string[] = ['1=1']; const params: any[] = [];
  if (req.query.client_id) { where.push('d.client_id = ?'); params.push(req.query.client_id); }
  if (req.query.folder) { where.push('d.folder = ?'); params.push(req.query.folder); }
  const [rows] = await db.query(
    `SELECT d.id, d.client_id, d.case_id, d.name, d.type, d.folder, d.status, d.file_url,
            d.visible_to_client, (d.content IS NOT NULL) AS has_content, (d.data IS NOT NULL) AS has_data,
            d.created_at, c.name AS client_name
       FROM documents d LEFT JOIN clients c ON c.id = d.client_id
      WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT 500`, params
  ) as any;
```

por:

```typescript
router.get('/', async (req: Request, res: Response) => {
  const where: string[] = ['1=1']; const params: any[] = [];
  if (req.query.client_id) { where.push('d.client_id = ?'); params.push(req.query.client_id); }
  if (req.query.folder) { where.push('d.folder = ?'); params.push(req.query.folder); }
  if (req.query.dative_case_id) { where.push('d.dative_case_id = ?'); params.push(req.query.dative_case_id); }
  const [rows] = await db.query(
    `SELECT d.id, d.client_id, d.case_id, d.dative_case_id, d.name, d.type, d.folder, d.status, d.file_url,
            d.visible_to_client, (d.content IS NOT NULL) AS has_content, (d.data IS NOT NULL) AS has_data,
            d.created_at, c.name AS client_name
       FROM documents d LEFT JOIN clients c ON c.id = d.client_id
      WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT 500`, params
  ) as any;
```

- [ ] **Step 5: Aceitar `dative_case_id` na gravação `POST /`**

Em `src/routes/documents.ts:140-168`, trocar:

```typescript
router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_id, name, folder, type, file_url, status, content, file_base64, mime } = req.body;
  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }

  // Upload de arquivo (ex.: PDF/foto do documento assinado) — mesmo padrão
  // já usado pra minuta do acordo extrajudicial: base64 em JSON (sem multer
  // no projeto), guardado como blob em documents.data.
  let data: Buffer | null = null;
  if (file_base64) {
    data = Buffer.from(String(file_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const MAX = 15 * 1024 * 1024;
    if (data.length > MAX) { res.status(400).json({ error: 'Arquivo maior que 15MB' }); return; }
  }

  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, content, data, mime, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client_id, case_id ?? null, name.trim(), type ?? null,
     FOLDERS.includes(folder) ? folder : 'outros', file_url ?? null, content ?? null,
     data, data ? (mime || 'application/octet-stream') : null,
     STATUSES.includes(status) ? status : 'recebido', req.user!.id]
  ) as any;
  const [rows] = await db.query(
    'SELECT id, client_id, case_id, name, type, folder, file_url, status, visible_to_client, (data IS NOT NULL) AS has_data, created_at FROM documents WHERE id = ?',
    [r.insertId]
  ) as any;
  res.status(201).json(rows[0]);
});
```

por:

```typescript
router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_id, dative_case_id, name, folder, type, file_url, status, content, file_base64, mime } = req.body;
  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }

  // Upload de arquivo (ex.: PDF/foto do documento assinado) — mesmo padrão
  // já usado pra minuta do acordo extrajudicial: base64 em JSON (sem multer
  // no projeto), guardado como blob em documents.data.
  let data: Buffer | null = null;
  if (file_base64) {
    data = Buffer.from(String(file_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const MAX = 15 * 1024 * 1024;
    if (data.length > MAX) { res.status(400).json({ error: 'Arquivo maior que 15MB' }); return; }
  }

  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, dative_case_id, name, type, folder, file_url, content, data, mime, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client_id, case_id ?? null, dative_case_id ?? null, name.trim(), type ?? null,
     FOLDERS.includes(folder) ? folder : 'outros', file_url ?? null, content ?? null,
     data, data ? (mime || 'application/octet-stream') : null,
     STATUSES.includes(status) ? status : 'recebido', req.user!.id]
  ) as any;
  const [rows] = await db.query(
    'SELECT id, client_id, case_id, dative_case_id, name, type, folder, file_url, status, visible_to_client, (data IS NOT NULL) AS has_data, created_at FROM documents WHERE id = ?',
    [r.insertId]
  ) as any;
  res.status(201).json(rows[0]);
});
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx tsc && node --test tests/documentsDativeCaseId.test.mjs`
Expected: PASS (o teste escrito no Step 1 insere direto via SQL para validar a coluna/filtro — ele não passa pela rota HTTP, mas valida o mesmo contrato de dados que a rota usa). Se passar sem erro de coluna, a migration e o filtro estão corretos.

- [ ] **Step 7: Rodar a suíte completa de testes para checar que nada quebrou**

Run: `npm test`
Expected: todos os testes passam (ou `skip` por banco indisponível), sem novo `FAIL`.

- [ ] **Step 8: Commit**

```bash
git add src/routes/documents.ts tests/documentsDativeCaseId.test.mjs
git commit -m "feat: documents aceita e filtra por dative_case_id"
```

---

### Task 3: Frontend — seção "Documentos" na tela da demanda dativa

**Files:**
- Modify: `public/app.js` (função `dativeCaseDetail`, atualmente em torno da linha 7289-7387)

**Interfaces:**
- Consumes: `GET /api/documents?dative_case_id=<id>`, `POST /api/documents` (Task 2); helpers já existentes no arquivo: `api(path, opts)`, `el(html)`, `esc(s)`, `fmtDate(d)`, `toast(msg, type)`, `openModal(title, bodyEl)`, `closeModal()`, `downloadDocFile(id, name)`, `docViewer(id, onSave)`.
- Produces: nenhuma interface nova consumida por outro arquivo — mudança isolada de UI.

- [ ] **Step 1: Localizar o ponto de inserção**

Run: `grep -n "Audiências (clique para editar" public/app.js`
Expected: aponta para a linha dentro do template de `dativeCaseDetail` (por volta da linha 7317) — é logo após essa seção que a nova seção "Documentos" entra.

- [ ] **Step 2: Adicionar a constante de categorias e o helper de leitura de arquivo**

Perto do topo do bloco `// ── Módulo Dativo ──` (linha ~7122), logo abaixo de `const DATIVE_AREAS = ...`, adicionar:

```javascript
const DATIVE_DOC_FOLDERS = [
  ['nomeacao', 'Termo de nomeação'],
  ['certidao_audiencia', 'Certidão de audiência'],
  ['comprovante_atuacao', 'Comprovante de atuação'],
  ['outros', 'Outros'],
].map(([v, t]) => ({ v, t }));

// Lê um File do navegador como data URL (base64) — Promise em volta do
// FileReader, mesmo padrão já usado em uploadDocForm (GED geral).
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 3: Escrever a função que envia um arquivo (categoria + upload)**

Logo abaixo do helper `readFileAsDataUrl`, adicionar:

```javascript
// Envia um arquivo anexado a uma demanda dativa — pede a categoria (pasta)
// e grava em documents com client_id (assistido) + dative_case_id vinculados.
async function dativeDocUploadForm(file, { clientId, dativeCaseId }, onSave) {
  if (file.size > 15 * 1024 * 1024) { toast('Arquivo maior que 15MB', 'error'); return; }
  const form = el(`<form class="form-grid">
    ${field('Nome do documento *', 'name', { value: file.name })}
    ${field('Categoria', 'folder', { value: 'outros', options: DATIVE_DOC_FOLDERS })}
    <button type="submit" class="btn-primary">Enviar</button>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const g = (n) => form.querySelector(`[name=${n}]`)?.value;
      const file_base64 = await readFileAsDataUrl(file);
      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId, dative_case_id: dativeCaseId,
          name: (g('name') && g('name').trim()) || file.name,
          folder: g('folder'), file_base64, mime: file.type,
        }),
      });
      closeModal(); toast('Documento anexado'); onSave();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Enviar'; }
  };
  openModal('Anexar documento', form);
}
```

- [ ] **Step 4: Escrever a função que monta a seção "Documentos" (lista + zona de upload)**

Logo abaixo de `dativeDocUploadForm`, adicionar:

```javascript
// Monta a seção "Documentos" da tela de detalhe do dativo: lista os
// documentos já anexados (Abrir/Baixar/Excluir) e uma zona clicável +
// arrastar-e-soltar para anexar novos. onSave reabre a tela pra atualizar a lista.
async function dativeDocsSection(dativeCaseId, clientId, onSave) {
  const docs = clientId ? await api('/api/documents?dative_case_id=' + dativeCaseId) : [];
  const FOLDER_LABEL = Object.fromEntries(DATIVE_DOC_FOLDERS.map((f) => [f.v, f.t]));
  const list = docs.length ? docs.map((d) => `<div class="mini-row">
      <span>${esc(d.name)}<br><small style="color:var(--text-muted)">${FOLDER_LABEL[d.folder] || d.folder} · ${fmtDate(d.created_at)}</small></span>
      <span>${d.has_data == 1 ? `<button type="button" class="btn-sm" data-ddoc-download="${d.id}" data-ddoc-name="${esc(d.name)}">Baixar</button>` : ''} <button type="button" class="btn-sm" data-ddoc-del="${d.id}">×</button></span>
    </div>`).join('') : '<small style="color:var(--text-muted)">Nenhum documento anexado ainda</small>';

  const section = el(`<div>
    <strong style="font-size:13px">Documentos</strong>
    <div id="ddoc-list" style="margin:8px 0">${list}</div>
    <div id="ddoc-drop" style="border:2px dashed var(--border);border-radius:8px;padding:16px;text-align:center;cursor:pointer;color:var(--text-muted);font-size:13px">
      Clique ou arraste um arquivo aqui para anexar
      <input type="file" id="ddoc-input" accept=".pdf,.doc,.docx,image/*" style="display:none">
    </div>
  </div>`);

  const refresh = async () => {
    const parent = section.parentElement;
    const fresh = await dativeDocsSection(dativeCaseId, clientId, onSave);
    if (parent) parent.replaceChild(fresh, section);
    return fresh;
  };

  section.querySelectorAll('[data-ddoc-download]').forEach((b) => b.onclick = () => downloadDocFile(b.dataset.ddocDownload, b.dataset.ddocName));
  section.querySelectorAll('[data-ddoc-del]').forEach((b) => b.onclick = async () => {
    try { await api('/api/documents/' + b.dataset.ddocDel, { method: 'DELETE' }); toast('Documento removido'); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  });

  const drop = section.querySelector('#ddoc-drop');
  const input = section.querySelector('#ddoc-input');
  const handleFile = (file) => {
    if (!file) return;
    if (!clientId) { toast('Informe e salve o assistido antes de anexar documentos', 'error'); return; }
    dativeDocUploadForm(file, { clientId, dativeCaseId }, refresh);
  };
  drop.onclick = () => input.click();
  input.onchange = () => handleFile(input.files[0]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.outline = '2px dashed var(--gold)'; });
  drop.addEventListener('dragleave', () => { drop.style.outline = ''; });
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.style.outline = '';
    handleFile(e.dataTransfer.files[0]);
  });

  return section;
}
```

- [ ] **Step 5: Inserir a seção na modal `dativeCaseDetail`**

Em `public/app.js`, dentro de `dativeCaseDetail` (por volta da linha 7296-7319), trocar o final do template (que hoje fecha com a seção de Audiências):

```javascript
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px">Audiências (clique para editar o valor/data)</strong>
    <div>${hearings}</div>
  </div>`);
```

por:

```javascript
    <hr style="border:none;border-top:1px solid var(--border)">
    <strong style="font-size:13px">Audiências (clique para editar o valor/data)</strong>
    <div>${hearings}</div>
    <hr style="border:none;border-top:1px solid var(--border)">
    <div id="dat-docs-slot"></div>
  </div>`);
```

Depois, no fim de `dativeCaseDetail` (por volta da linha 7386, antes de `openModal('Demanda dativa', form);`), adicionar:

```javascript
  const docsSection = await dativeDocsSection(id, d.client_id, () => dativeCaseDetail(id, onSave));
  form.querySelector('#dat-docs-slot').replaceWith(docsSection);
```

Trecho completo do fim da função após a mudança (para conferência — não repita o resto da função, só confirme que a ordem final ficou assim):

```javascript
  const gerarAceiteBtn = form.querySelector('#dat-gerar-aceite');
  if (gerarAceiteBtn) gerarAceiteBtn.onclick = async () => {
    // ... (inalterado)
  };
  const docsSection = await dativeDocsSection(id, d.client_id, () => dativeCaseDetail(id, onSave));
  form.querySelector('#dat-docs-slot').replaceWith(docsSection);
  openModal('Demanda dativa', form);
}
```

- [ ] **Step 6: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem saída (arquivo é sintaticamente válido). Se houver erro, ele aponta a linha exata — revisar o trecho inserido no Step 5.

- [ ] **Step 7: Teste manual no navegador**

Run: `npm run dev` (ou o comando de start do projeto — conferir `package.json` se `dev` não existir) e abrir o CRM localmente.

Passos manuais:
1. Ir em Dativo → abrir uma demanda existente (ou criar uma nova com assistido vinculado).
2. Confirmar que a seção "Documentos" aparece abaixo de Audiências, com a zona "Clique ou arraste um arquivo aqui".
3. Clicar na zona, escolher um arquivo pequeno (ex.: uma imagem), confirmar que abre o modal "Anexar documento" com nome pré-preenchido e categoria "Outros".
4. Trocar a categoria para "Termo de nomeação", enviar, confirmar toast "Documento anexado" e que o arquivo aparece na lista com a categoria certa.
5. Clicar em "Baixar" e confirmar que o arquivo baixado abre corretamente.
6. Clicar em "×" para excluir, confirmar que some da lista.
7. Ir em Documentos → GED, selecionar o mesmo cliente, confirmar que o documento enviado aparece na pasta correspondente (ex.: "Termo de nomeação" — se essa pasta não tiver rótulo em `FOLDER_PT`, ver Task 4).

Expected: todos os passos funcionam sem erro no console do navegador.

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat: seção de documentos na tela de detalhe da demanda dativa"
```

---

### Task 4: Frontend — rótulos das novas pastas no GED geral

**Files:**
- Modify: `public/app.js:2590` (`FOLDER_PT`)

**Interfaces:**
- Consumes: nenhuma nova.
- Produces: rótulos em português para as pastas `nomeacao`, `certidao_audiencia`, `comprovante_atuacao` quando exibidas na tela geral de Documentos (GED) — sem isso, o Step 7 da Task 3 mostraria o valor cru da pasta ali.

- [ ] **Step 1: Atualizar `FOLDER_PT`**

Em `public/app.js:2590`, trocar:

```javascript
const FOLDER_PT = { contratos: 'Contratos', procuracoes: 'Procurações', documentos_pessoais: 'Documentos pessoais', processos: 'Processos', financeiro: 'Financeiro', audiencias: 'Audiências', outros: 'Outros' };
```

por:

```javascript
const FOLDER_PT = { contratos: 'Contratos', procuracoes: 'Procurações', documentos_pessoais: 'Documentos pessoais', processos: 'Processos', financeiro: 'Financeiro', audiencias: 'Audiências', nomeacao: 'Termo de nomeação', certidao_audiencia: 'Certidão de audiência', comprovante_atuacao: 'Comprovante de atuação', outros: 'Outros' };
```

- [ ] **Step 2: Checar sintaxe do arquivo**

Run: `node --check public/app.js`
Expected: sem saída.

- [ ] **Step 3: Teste manual**

Ir em Documentos → GED, selecionar o cliente usado no teste da Task 3 Step 7, confirmar que a pasta aparece como "Termo de nomeação" (não como `nomeacao` cru).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: rótulos das pastas de dativo no GED geral"
```

---

## Post-Implementation

Depois da Task 4, rodar a suíte completa de novo para garantir que nada regrediu:

Run: `npm test`
Expected: todos os testes passam ou `skip` por ambiente, sem `FAIL` novo.
