# Bloqueio de Pendências + Auto-Pasta Drive + Fix Aracelia — Design

**Data:** 2026-07-04 · **Status:** aprovado (brainstorming)

## Objetivo
Três tarefas integradas:
1. **Bloqueio de pendências**: impedir avanço para "aguardando protocolo" se houver legal_pieces abertas
2. **Auto-criar pasta Drive**: ao colocar caso em produção, criar pasta com nome inteligente (`"Cliente - Área - Descrição"`)
3. **Fix Aracelia**: reorganizar pastas e analisar e-mail para identificar casos diferentes

## Decisões

### 1. Bloqueio de Pendências
- **Quando**: ao tentar mover para `aguardando_protocolo` via PATCH `/api/cases/:id/production-stage`
- **Validação**: contar `legal_pieces WHERE case_id = ? AND status NOT IN ('protocolado', 'cancelado')`
- **Se houver abertas**: retornar erro 400 com lista de peças abertas
- **Frontend**: mostrar aviso em vermelho + listar peças; botão "Avançar" fica desabilitado até resolver
- **Comportamento**: "hard block" — não deixa passar

### 2. Auto-Criar Pasta Drive
- **Gatilho**: ao criar caso manualmente OU ao importar via e-mail (ambos entram em `separacao_documentos` = produção ativa)
- **Nome da pasta**: formato `"[ClientName] - [LegalArea] - [DescriptionExtraído]"`
  - ClientName: `clients.name` (ex: "Aracelia Gomes")
  - LegalArea: `cases.legal_area` (ex: "RCC Consumidor")
  - Description: extrair do `cases.title` ou `description` (ex: "Banco Agibankk" ou "RCC Bradesco")
- **Onde criar**: usar Google Drive API (já integrada via `google-callback.ts`)
- **Armazenar**: salvar `drive_folder_url` em `cases.drive_folder_url`
- **Idempotência**: se já existe pasta com esse nome, usar a existente (não duplicar)

### 3. Fix Aracelia (Script Manual)
- **Input**: client_id de Aracelia + e-mail das parcerias
- **Passos**:
  1. Listar todos os `cases` WHERE `client_id = ? AND production_stage IN ('separacao_documentos', 'criacao_inicial', ...)`
  2. Agrupar por `case_number + legal_area + description` para identificar processos diferentes
  3. Para cada processo diferente:
     - Se não tem pasta no Drive → criar via API
     - Se tem pasta mas nome está errado → renomear ou criar nova
  4. Analisar e-mails de Aracelia (body + subject) para extrair:
     - Qual é o processo exato? (ex: "RCC Bradesco")
     - Qual é o banco? (ex: "Bradesco", "Agibankk")
     - Tipo de caso? (ex: "RCC Consumidor")
  5. Atualizar `cases.title` e `cases.drive_folder_url` conforme extraído

## Modelo de Dados
- `legal_pieces`: coluna `status` (já existe; valores: 'rascunho', 'protocolado', 'cancelado', etc.)
- `cases`: coluna `drive_folder_url` (já existe)
- `cases`: coluna `production_stage` (já existe)
- Nenhuma migração necessária

## Backend

### Rota: PATCH /api/cases/:id/production-stage (ajuste)
```typescript
// Antes de mover para 'aguardando_protocolo':
if (newStage === 'aguardando_protocolo') {
  const [openPieces] = await db.query(
    'SELECT id, description FROM legal_pieces WHERE case_id = ? AND status NOT IN ("protocolado", "cancelado")',
    [caseId]
  );
  if (openPieces.length) {
    res.status(400).json({
      error: 'Não é possível avançar com pendências abertas',
      pendencias: openPieces.map(p => p.description)
    });
    return;
  }
}
// ... resto da lógica
```

### Nova rota/função: Auto-criar pasta ao entrar em produção
```typescript
// src/services/DriveService.ts (nova)
export async function createProductionFolder(caseId: number, clientName: string, legalArea: string, description: string): Promise<string | null>
// Retorna: drive_folder_url ou null se falhar
```

**Chamada**: ao salvar `cases` com `production_stage !== null` (primeira vez), chamar `createProductionFolder`.

### Script manual (src/scripts/fixAraceliaFolders.ts)
- Recebe: `clientId` (Aracelia), `partnerInboxEmails` (e-mails das parcerias)
- Retorna: relatório de pastas criadas/renomeadas + casos atualizados

## Frontend

### Validação de pendências (Produção card)
```javascript
// Ao clicar em "Avançar para Aguardando Protocolo":
if (newStage === 'aguardando_protocolo') {
  try {
    await api(`/api/cases/${caseId}/production-stage`, { ... });
  } catch (err) {
    if (err.status === 400 && err.pendencias) {
      toast(`Resolva as pendências: ${err.pendencias.join(', ')}`, 'error');
      // Mostrar lista visual em vermelho
      return; // não avança
    }
  }
}
```

## Segurança
- Auto-criar pasta: validar que `google_token` existe + user autenticado
- Bloqueio pendências: só staff/admin pode avançar etapa (já validado via `requireStaff`)
- Script fix: executar via admin endpoint ou CLI (não expor publicamente)

## Testes / QA
1. Tentar avançar caso com `legal_pieces` abertas → erro 400 com lista
2. Criar caso novo → verifica se pasta foi criada no Drive
3. Importar e-mail nas parcerias → verifica se pasta foi criada
4. Executar fix Aracelia → verifica se pastas foram reorganizadas corretamente

## Fora de escopo (YAGNI)
- Sincronizar arquivos automaticamente (manual por enquanto)
- Múltiplos clientes no fix (só Aracelia por enquanto)
- Backup de pastas antigas
