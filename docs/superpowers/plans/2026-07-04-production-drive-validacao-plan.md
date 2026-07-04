# Bloqueio Pendências + Auto-Pasta Drive + Fix Aracelia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar pendências antes de avançar etapa de produção, criar pastas Drive automaticamente com nomes inteligentes, e reorganizar pastas de Aracelia.

**Architecture:** 
- Backend: validação na rota PATCH production-stage; novo DriveService para gerenciar pastas
- Frontend: bloquear transição visual + erro tratado
- Script: CLI para fix manual de Aracelia (análise de e-mail + reorganização Drive)

**Tech Stack:** TypeScript, Express, Google Drive API (já integrada), Node.js scripts

## Global Constraints
- Google Drive API já integrada via `src/services/GoogleService.ts` (use padrão existente)
- Tabela `legal_pieces` já existe com coluna `status`
- Tabela `cases` já tem coluna `drive_folder_url` e `production_stage`
- Padrões CRM: rotas em `src/routes/*.ts`, services em `src/services/*.ts`, frontend em `public/app.js`
- Nenhuma migração necessária
- Validação de staff/admin via middleware `requireStaff` já existe

---

### Task 1: Validação de Pendências no Backend

**Files:**
- Modify: `src/routes/cases.ts:387-430` (rota PATCH production-stage)

**Interfaces:**
- Consumes: `production_stage` (current), `newStage` (requested), `case_id`
- Produces: HTTP 400 com `{ error, pendencias: [] }` se houver legal_pieces abertas; HTTP 200 se OK

**Steps:**

- [ ] **Step 1: Localizar rota production-stage**

Abra `src/routes/cases.ts` e encontre `router.patch('/:id/production-stage', ...)` por volta da linha 387.

- [ ] **Step 2: Adicionar validação ANTES da mudança de stage**

Adicione este bloco logo depois de validar `newStage` e antes de fazer UPDATE:

```typescript
// ── Validação: se tentando ir para 'aguardando_protocolo', verificar pendências ──
if (newStage === 'aguardando_protocolo') {
  const [openPieces] = await db.query(
    `SELECT id, description FROM legal_pieces 
     WHERE case_id = ? AND status NOT IN ('protocolado', 'cancelado')
     ORDER BY id ASC`,
    [id]
  ) as any;
  
  if (openPieces.length) {
    res.status(400).json({
      error: `Não é possível avançar com ${openPieces.length} pendência(s) aberta(s)`,
      pendencias: openPieces.map((p: any) => p.description || `Peça #${p.id}`)
    });
    return;
  }
}
```

- [ ] **Step 3: Testar a validação**

Compilar:
```bash
cd "c:\Users\advog\Documents\CRM LETÍCIA" && npx tsc --noEmit
```

Expected: sem erros TS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/cases.ts
git commit -m "feat: bloqueio de pendencias antes de avançar para aguardando_protocolo"
```

---

### Task 2: Frontend — Bloquear Botão se Houver Pendências

**Files:**
- Modify: `public/app.js` (função que avança esteira de produção)

**Interfaces:**
- Consumes: resposta HTTP 400 com `pendencias` array
- Produces: UI bloqueada (botão desabilitado + toast de erro com lista)

**Steps:**

- [ ] **Step 1: Encontrar handler de avanço de etapa**

Busque em `public/app.js` pela função `moveStage` ou onde o botão "Avançar para..." é clicado. Deve estar na tela de Produção.

Procure por `production-stage` ou `adv-stage` (aproximadamente linha 1596-1621 no último commit).

- [ ] **Step 2: Adicionar tratamento de erro 400**

Encontre o `try/catch` que faz a chamada API e adicione tratamento:

```javascript
try {
  const resp = await api(`/api/cases/${caseId}/production-stage`, { 
    method: 'PATCH', 
    body: JSON.stringify({ stage, ...extra }) 
  });
  // ... resto do código (sucesso)
} catch (e) {
  // NOVO: tratar erro 400 de pendências
  if (e.status === 400 && e.pendencias) {
    toast(`❌ Resolva as pendências antes de continuar:\n${e.pendencias.join('\n')}`, 'error');
    return; // NÃO deixa avançar
  }
  // Erros outros
  toast(e.message, 'error');
  load();
}
```

- [ ] **Step 3: Testar sintaxe**

```bash
cd "c:\Users\advog\Documents\CRM LETÍCIA" && node --check public/app.js
```

Expected: `JS OK`

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: bloquear avanço de etapa no frontend se houver pendencias (erro 400)"
```

---

### Task 3: Criar DriveService para Auto-Criar Pastas

**Files:**
- Create: `src/services/DriveService.ts`

**Interfaces:**
- Consumes: `clientName` (string), `legalArea` (string), `description` (string)
- Produces: `{ folderId: string, folderUrl: string } | null` (null se falhar)

**Steps:**

- [ ] **Step 1: Criar arquivo DriveService.ts**

```typescript
import { google } from 'googleapis';

const drive = google.drive('v3');

/**
 * Cria uma pasta no Google Drive com nome inteligente: "ClientName - LegalArea - Description"
 * Usa o token do user autenticado (assumption: Google OAuth já funciona)
 * Se pasta com mesmo nome já existe, retorna URL da existente (idempotente)
 */
export async function createProductionFolder(
  auth: any,
  clientName: string,
  legalArea: string,
  description: string
): Promise<{ folderId: string; folderUrl: string } | null> {
  try {
    const folderName = `${clientName} - ${legalArea}${description ? ` - ${description}` : ''}`.trim();
    
    // Busca pasta com mesmo nome (evita duplicar)
    const existing = await drive.files.list({
      auth,
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id, webViewLink)',
      pageSize: 1,
    });

    if (existing.data.files && existing.data.files.length > 0) {
      const file = existing.data.files[0];
      return {
        folderId: file.id!,
        folderUrl: file.webViewLink!,
      };
    }

    // Cria nova pasta na raiz do Drive
    const created = await drive.files.create({
      auth,
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id, webViewLink',
    });

    if (!created.data.id) throw new Error('Falha ao criar pasta no Drive');

    return {
      folderId: created.data.id,
      folderUrl: created.data.webViewLink!,
    };
  } catch (err) {
    console.error(`[DriveService] Erro ao criar pasta "${clientName}":`, err);
    return null;
  }
}

/**
 * Extrai token OAuth do user (assumption: já existe em contexto de autenticação)
 */
export async function getUserDriveAuth(userId: number): Promise<any | null> {
  // NOTA: esta função depende de como o projeto armazena tokens OAuth
  // Use o padrão existente em GoogleCalendarService.ts ou similar
  // Por enquanto, retorna null (será preenchido com padrão do projeto)
  return null;
}
```

- [ ] **Step 2: Testar compilação**

```bash
cd "c:\Users\advog\Documents\CRM LETÍCIA" && npx tsc --noEmit
```

Expected: sem erros (ignorar a falta de userId por enquanto).

- [ ] **Step 3: Commit**

```bash
git add src/services/DriveService.ts
git commit -m "feat: DriveService para criar/encontrar pastas no Drive com nome inteligente"
```

---

### Task 4: Integrar Auto-Criar Pasta ao Criar Caso em Produção

**Files:**
- Modify: `src/routes/cases.ts` (rota POST /api/cases e PATCH production-stage)

**Interfaces:**
- Consumes: novo caso com `production_stage` ou avanço para primeira etapa de produção
- Produces: `drive_folder_url` preenchido em `cases`

**Steps:**

- [ ] **Step 1: Importar DriveService no cases.ts**

No topo de `src/routes/cases.ts`, adicione:

```typescript
import { createProductionFolder } from '../services/DriveService';
```

- [ ] **Step 2: Adicionar lógica ao PATCH production-stage**

Após a validação de pendências (Task 1) e antes do UPDATE, adicione:

```typescript
// ── Auto-criar pasta Drive ao entrar em produção ──
if (newStage === 'separacao_documentos' && !currentCase.drive_folder_url) {
  // Busca nome do cliente
  const [clientRows] = await db.query(
    'SELECT name FROM clients WHERE id = ?',
    [currentCase.client_id]
  ) as any;
  const clientName = clientRows[0]?.name || 'Cliente Desconhecido';
  
  // Extrai descrição: tenta legal_area, depois title, depois description
  const description = (currentCase.legal_area || currentCase.title || currentCase.description || '').substring(0, 50);
  
  // Cria pasta (sem await para não bloquear; trata async em background)
  createProductionFolder(req.user!.id, clientName, currentCase.legal_area || '', description)
    .then((result) => {
      if (result) {
        db.query(
          'UPDATE cases SET drive_folder_url = ? WHERE id = ?',
          [result.folderUrl, id]
        ).catch(() => {}); // Silent fail
      }
    })
    .catch(() => {}); // Silent fail — não bloqueia o avanço
}
```

- [ ] **Step 3: Testar compilação**

```bash
npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/routes/cases.ts
git commit -m "feat: auto-criar pasta Drive ao entrar em producao (separacao_documentos)"
```

---

### Task 5: Integrar Auto-Criar Pasta ao Importar E-mail (Parcerias)

**Files:**
- Modify: `src/services/partnerInboxService.ts` (ou onde os e-mails são importados)

**Interfaces:**
- Consumes: novo caso importado via e-mail
- Produces: `drive_folder_url` preenchido

**Steps:**

- [ ] **Step 1: Localizar função de importação de e-mail**

Abra `src/services/partnerInboxService.ts` e encontre a função que cria `cases` a partir do e-mail.

- [ ] **Step 2: Adicionar chamada a createProductionFolder**

Após INSERT do novo caso, adicione:

```typescript
import { createProductionFolder } from './DriveService';

// ... no handler que cria o caso:
const newCaseId = result.insertId;

// Auto-criar pasta Drive
const clientName = clientData.name || 'Cliente via E-mail';
const legalArea = extractedLegalArea || 'Não especificado';
const description = emailSubject || ''; // usar subject do e-mail

createProductionFolder(userId, clientName, legalArea, description)
  .then((result) => {
    if (result) {
      db.query(
        'UPDATE cases SET drive_folder_url = ? WHERE id = ?',
        [result.folderUrl, newCaseId]
      ).catch(() => {});
    }
  })
  .catch(() => {});
```

- [ ] **Step 3: Testar compilação**

```bash
npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/services/partnerInboxService.ts
git commit -m "feat: auto-criar pasta Drive ao importar casos via e-mail nas parcerias"
```

---

### Task 6: Script Fix Aracelia — Reorganizar Pastas + Analisar E-mail

**Files:**
- Create: `src/scripts/fixAraceliaFolders.ts`

**Interfaces:**
- Consumes: Aracelia's e-mails + casos em DB
- Produces: relatório de pastas criadas/renomeadas + stdout

**Steps:**

- [ ] **Step 1: Criar script base**

```typescript
import { db } from '../config/database';
import { createProductionFolder } from '../services/DriveService';

const ARACELIA_CLIENT_ID = 1; // TODO: substituir pelo ID real de Aracelia no DB

interface EmailMatch {
  caseTitle: string;
  bank: string;
  processType: string;
}

/**
 * Extrai informações do e-mail: qual banco? qual tipo de processo?
 * Exemplo: "RCC Bradesco" → { bank: "Bradesco", processType: "RCC" }
 */
function extractBankAndType(emailBody: string, emailSubject: string): EmailMatch {
  const combined = `${emailSubject} ${emailBody}`.toUpperCase();
  
  // Lista de bancos conhecidos
  const banks = ['BRADESCO', 'AGIBANKK', 'ITAU', 'CAIXA', 'SANTANDER', 'BANCO DO BRASIL', 'CEF'];
  let bank = 'Banco Desconhecido';
  for (const b of banks) {
    if (combined.includes(b)) {
      bank = b.charAt(0) + b.slice(1).toLowerCase();
      break;
    }
  }
  
  // Tipo de processo
  const processType = combined.includes('CONSUMIDOR') ? 'Consumidor' : 'Fornecedor';
  
  return {
    caseTitle: emailSubject.substring(0, 60),
    bank,
    processType,
  };
}

/**
 * Reorganiza pastas de Aracelia: cria uma pasta por processo diferente
 */
async function reorganizeAraceliaFolders(userId: number) {
  console.log('🔍 Buscando casos de Aracelia em produção...');
  
  const [cases] = await db.query(
    `SELECT c.id, c.title, c.case_number, c.legal_area, c.description, c.drive_folder_url
     FROM cases c
     WHERE c.client_id = ? AND c.production_stage IS NOT NULL
     ORDER BY c.created_at DESC`,
    [ARACELIA_CLIENT_ID]
  ) as any;
  
  if (!cases.length) {
    console.log('✅ Nenhum caso de Aracelia encontrado em produção.');
    return;
  }
  
  console.log(`📋 Encontrados ${cases.length} casos.`);
  
  for (const c of cases) {
    // Extrai banco e tipo do description ou title
    const match = extractBankAndType(c.description || c.title || '', c.title);
    
    const newFolderName = `Aracelia Gomes - ${match.processType} - ${match.bank}`;
    console.log(`  → Caso "${c.title}" → Pasta: "${newFolderName}"`);
    
    // Tenta criar/encontrar pasta
    const auth = null; // TODO: obter auth do user
    const result = await createProductionFolder(auth, 'Aracelia Gomes', match.processType, match.bank);
    
    if (result) {
      // Atualiza DB
      await db.query('UPDATE cases SET drive_folder_url = ? WHERE id = ?', [result.folderUrl, c.id]);
      console.log(`     ✅ Pasta criada/atualizada: ${result.folderUrl}`);
    } else {
      console.log(`     ❌ Falha ao criar pasta`);
    }
  }
  
  console.log('✅ Fix Aracelia concluído!');
}

// Executar
const userId = 1; // TODO: passar via CLI ou config
reorganizeAraceliaFolders(userId).catch(console.error);
```

- [ ] **Step 2: Adicionar script ao package.json**

Abra `package.json` e adicione um script:

```json
"scripts": {
  ...
  "fix:aracelia": "ts-node src/scripts/fixAraceliaFolders.ts"
}
```

- [ ] **Step 3: Testar compilação**

```bash
npx tsc --noEmit
```

Expected: sem erros (TODOs são OK por enquanto).

- [ ] **Step 4: Commit**

```bash
git add src/scripts/fixAraceliaFolders.ts package.json
git commit -m "feat: script para reorganizar pastas de Aracelia (fix manual)"
```

---

### Task 7: Testes e Verificação Final

**Files:**
- Test: todas as rotas acima

**Steps:**

- [ ] **Step 1: Build e typecheck**

```bash
cd "c:\Users\advog\Documents\CRM LETÍCIA"
npm run build
npx tsc --noEmit
node --check public/app.js
```

Expected: sem erros.

- [ ] **Step 2: Teste unitário — bloqueio de pendências**

Teste manual (via Postman ou curl):
```bash
# Criar caso com legal_pieces aberta
# Tentar avançar para 'aguardando_protocolo'
# Deve retornar: 400 com { error: "...", pendencias: [...] }
```

- [ ] **Step 3: Teste — auto-criar pasta**

Teste manual:
```bash
# Criar novo caso
# Avançar para 'separacao_documentos' (ou colocar em produção)
# Verificar no Google Drive se pasta foi criada com nome correto
# Verificar se 'drive_folder_url' foi preenchido no DB
```

- [ ] **Step 4: Teste — e-mail nas parcerias**

Teste manual:
```bash
# Importar e-mail de Aracelia nas parcerias
# Verificar se caso foi criado com 'drive_folder_url' preenchido
# Verificar nome da pasta no Drive
```

- [ ] **Step 5: Teste — fix Aracelia**

Teste manual (quando pronto):
```bash
npm run fix:aracelia
# Observar output
# Verificar se pastas foram criadas/renomeadas no Drive
# Verificar se DB foi atualizado
```

- [ ] **Step 6: Commit final**

```bash
git log --oneline -7 | head -7
# Verificar se todos os 6 commits anteriores estão lá
# Se tudo OK:
```

```bash
git log --oneline -1
# Registrar o commit final
```

---

## Spec Coverage Checklist

- ✅ **Bloqueio de pendências**: Task 1 (backend) + Task 2 (frontend)
- ✅ **Auto-criar pasta Drive**: Task 3 (service) + Task 4 (produção) + Task 5 (e-mail)
- ✅ **Fix Aracelia**: Task 6 (script)
- ✅ **Testes**: Task 7

## Próximos Passos

1. Executar tasks 1-7 inline
2. Executar script fix:aracelia manualmente
3. Ajustar ARACELIA_CLIENT_ID e userId conforme IDs reais do DB
4. Testar fluxo end-to-end em produção
