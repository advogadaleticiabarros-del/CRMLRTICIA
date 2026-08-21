# Redesign da tela de Conversas do WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar visualmente o cabeçalho e a lista de conversas do WhatsApp (cor de
urgência + pendência crítica à vista) e fazer o botão "Resumir conversa com IA" transcrever
áudios pendentes e descrever fotos automaticamente antes de montar o resumo.

**Architecture:** Duas mudanças independentes na mesma tela. (1) Visual: `GET /chats` ganha
2 campos agregados novos (`proxima_audiencia_dias`, `parcela_vencendo_dias`); uma função pura
`severidadeConversa()` em `public/whatsapp.js` decide cor/etiqueta a partir deles;
`renderLista()` e o CSS do cabeçalho/lista são reescritos para o layout navy+dourado
aprovado no mockup. (2) Transcrição automática: extrai a lógica de transcrição de áudio de
`POST /media/:id/transcricao` para uma função `transcreverAudio()` reutilizável, adiciona
`descreverImagem()` (usa `aiExtractFromFile` já existente) e um orquestrador
`garantirMidiaTranscrita(phone)` chamado no início de `POST /chats/:phone/resumo`.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2), frontend vanilla JS sem
build step (`public/*.js` carregado direto como script, sem módulos ES — funções e `ICONS`
são globais compartilhados entre arquivos), testes com `node --test` em `tests/*.test.mjs`.

## Global Constraints

- Cores de urgência (mesmas do Briefing Jurídico Matinal, já em produção): crítica
  `#b3432f`, atenção `#a67626`, neutra `#e2ddd1`.
- Cabeçalho da coluna de conversas: fundo navy `#1f3047`, friso inferior dourado `#c19a4e`
  de 3px, título em Georgia serif.
- Limiares de severidade (idênticos ao Briefing): audiência ≤2 dias OU pagamento
  vencido/hoje = crítica; audiência ≤7 dias OU pagamento ≤3 dias = atenção; caso contrário,
  neutra.
- `GET /chats` não pode virar N+1 — os 2 campos novos são subqueries agregadas únicas, não
  uma query por chat. Orçamento: não pode adicionar mais que ~50ms perceptíveis à rota
  (108 clientes na base atual).
- Marcador gravado no `body` da mensagem para descrição de foto: `'\n🖼️ Descrição: '`
  (mesma convenção do marcador de áudio já existente, `'\n📝 Transcrição: '`).
- `garantirMidiaTranscrita()` processa no máximo 15 itens de mídia pendente por chamada,
  priorizando os mais recentes quando houver mais que 15.
- Falha individual ao transcrever/descrever um item não interrompe os demais (try/catch por
  item).
- Fora de escopo (não mexer): painel de mensagens (coluna 2) e ficha de contexto (coluna 3)
  além do que já está listado nas tasks abaixo; qualquer botão "transcrever tudo" separado
  do resumo (foi descartado — é a mesma ação do botão de resumo já existente).

---

## Arquivos afetados

- `src/services/whatsappTranscricao.ts` (NOVO) — `transcreverAudio()`, `descreverImagem()`,
  `garantirMidiaTranscrita()`. Extraído para arquivo próprio (não inflar ainda mais
  `whatsapp-instance.ts`, que já tem 500+ linhas) — mesmo padrão de `briefingSeverity.ts`
  como módulo de lógica pura/quase-pura separado da rota HTTP.
- `src/routes/whatsapp-instance.ts` — `POST /media/:id/transcricao` passa a chamar
  `transcreverAudio()`; `GET /chats` ganha as 2 subqueries agregadas; `POST
  /chats/:phone/resumo` chama `garantirMidiaTranscrita()` antes de `conversaTexto()`.
- `public/whatsapp.js` — nova função pura `severidadeConversa(chat)`; `renderLista()`
  reescrita para usar a severidade e mostrar a pill de pendência; markup do cabeçalho da
  coluna 1 (`.wa-side`) ganha o bloco `.wa-head-col`.
- `public/styles.css` — novas regras `.wa-head-col`, `.wa-pill`; regras existentes de
  `.wa-item`/`.wa-side`/`.wa-search`/`.wa-filters` ajustadas para o layout aprovado.
- `tests/whatsappTranscricao.test.mjs` (NOVO)
- `tests/whatsappSeveridade.test.mjs` (NOVO)
- `tests/whatsappChatsQuery.test.mjs` (NOVO) — auditoria de schema das subqueries novas.

---

### Task 1: `transcreverAudio()` extraída e reutilizável

**Files:**
- Create: `src/services/whatsappTranscricao.ts`
- Modify: `src/routes/whatsapp-instance.ts:114-145` (rota `POST /media/:id/transcricao`)
- Test: `tests/whatsappTranscricao.test.mjs`

**Interfaces:**
- Produces: `export async function transcreverAudio(media: { id: number; file_name: string;
  mime: string; data: Buffer }): Promise<{ ok: true; texto: string } | { ok: false; erro:
  string }>` — NÃO grava no banco; só chama o Whisper e devolve o texto. Quem chama decide
  se grava (mantém a função testável sem mockar `db`).

Hoje a lógica de transcrição (chamada ao Whisper via Groq + gravação no `body`) está
misturada dentro da rota HTTP em `src/routes/whatsapp-instance.ts:117-145`. Isso impede
reaproveitar a mesma lógica no orquestrador automático da Task 3. Esta task separa "chamar o
Whisper" (pura o suficiente pra testar) de "gravar no banco" (fica na rota/orquestrador).

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/whatsappTranscricao.test.mjs`:

```javascript
// tests/whatsappTranscricao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/whatsappTranscricao.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { transcreverAudio } = await import('../dist/services/whatsappTranscricao.js');

test('transcreverAudio devolve erro quando GROQ_API_KEY não está configurada', async () => {
  const originalKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    const r = await transcreverAudio({ id: 1, file_name: 'audio.ogg', mime: 'audio/ogg', data: Buffer.from('x') });
    assert.equal(r.ok, false);
    assert.match(r.erro, /GROQ_API_KEY/);
  } finally {
    if (originalKey) process.env.GROQ_API_KEY = originalKey;
  }
});

test('transcreverAudio recusa arquivo que não é áudio/vídeo', async () => {
  process.env.GROQ_API_KEY = 'chave-de-teste';
  try {
    const r = await transcreverAudio({ id: 2, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('x') });
    assert.equal(r.ok, false);
    assert.match(r.erro, /áudio/i);
  } finally {
    delete process.env.GROQ_API_KEY;
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsc && node --test tests/whatsappTranscricao.test.mjs`
Expected: FAIL — `dist/services/whatsappTranscricao.js` não existe (módulo não criado ainda),
ou `transcreverAudio` não exportada.

- [ ] **Step 3: Criar `src/services/whatsappTranscricao.ts` com `transcreverAudio()`**

```typescript
// src/services/whatsappTranscricao.ts
// Transcrição de áudio (Whisper/Groq) e descrição de imagem (Gemini Vision) das
// mensagens de WhatsApp recebidas — usado tanto pelo botão manual "Transcrever
// áudio" quanto pelo orquestrador automático chamado pelo botão de Resumo.
import { db } from '../config/database';
import { aiExtractFromFile } from './aiAssistant';

export interface MediaRow {
  id: number;
  file_name: string;
  mime: string;
  data: Buffer;
}

export type TranscricaoResultado = { ok: true; texto: string } | { ok: false; erro: string };

/** Chama o Whisper (Groq) para transcrever um áudio/vídeo. NÃO grava no banco. */
export async function transcreverAudio(media: MediaRow): Promise<TranscricaoResultado> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, erro: 'Transcrição requer GROQ_API_KEY configurada' };
  if (!String(media.mime).startsWith('audio/') && !String(media.mime).startsWith('video/')) {
    return { ok: false, erro: 'Este arquivo não é um áudio' };
  }
  try {
    const fd = new FormData();
    fd.append('file', new Blob([media.data], { type: media.mime }), media.file_name || 'audio.ogg');
    fd.append('model', 'whisper-large-v3');
    fd.append('language', 'pt');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd as any,
    });
    const d: any = await r.json();
    if (!r.ok) return { ok: false, erro: d?.error?.message || 'Falha na transcrição' };
    const texto = String(d.text || '').trim();
    if (!texto) return { ok: false, erro: 'Não foi possível entender o áudio' };
    return { ok: true, texto };
  } catch (e: any) {
    return { ok: false, erro: e?.message || 'Falha na transcrição' };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/whatsappTranscricao.test.mjs`
Expected: PASS (2 testes)

- [ ] **Step 5: Fazer a rota existente usar a função extraída**

Em `src/routes/whatsapp-instance.ts`, substitua o corpo de `POST /media/:id/transcricao`
(linhas 117-145) por:

```typescript
router.post('/media/:id/transcricao', async (req: Request, res: Response) => {
  const [[m]] = await db.query('SELECT id, file_name, mime, data FROM whatsapp_media WHERE id = ?', [req.params.id]) as any;
  if (!m) { res.status(404).json({ error: 'Áudio não encontrado' }); return; }
  const { transcreverAudio } = await import('../services/whatsappTranscricao');
  const r = await transcreverAudio(m);
  if (!r.ok) { res.status(400).json({ error: r.erro }); return; }
  // Grava na mensagem (vira registro permanente e pesquisável)
  await db.query(
    "UPDATE whatsapp_messages SET body = CONCAT(body, '\n📝 Transcrição: ', ?) WHERE media_id = ? AND body NOT LIKE '%📝 Transcrição:%'",
    [r.texto.slice(0, 3000), m.id]).catch(() => {});
  res.json({ texto: r.texto });
});
```

Mantenha o comentário de cabeçalho da rota (linhas 114-116) como está.

- [ ] **Step 6: Rodar toda a suíte de whatsapp para garantir que nada quebrou**

Run: `npx tsc && node --test tests/whatsapp*.test.mjs`
Expected: PASS em todos os arquivos `tests/whatsapp*.test.mjs` existentes.

- [ ] **Step 7: Commit**

```bash
git add src/services/whatsappTranscricao.ts src/routes/whatsapp-instance.ts tests/whatsappTranscricao.test.mjs
git commit -m "refactor: extrai transcreverAudio() para módulo reutilizável"
```

---

### Task 2: `descreverImagem()` e orquestrador `garantirMidiaTranscrita()`

**Files:**
- Modify: `src/services/whatsappTranscricao.ts`
- Test: `tests/whatsappTranscricao.test.mjs`

**Interfaces:**
- Consumes: `transcreverAudio()` (Task 1), `aiExtractFromFile(base64: string, mimeType:
  string, instruction: string): Promise<{ ok: boolean; text?: string; message?: string }>`
  de `src/services/aiAssistant.ts:81-97` (já existe, não mexer).
- Produces: `export async function descreverImagem(media: MediaRow):
  Promise<TranscricaoResultado>`; `export async function
  garantirMidiaTranscrita(phone: string): Promise<void>`.

- [ ] **Step 1: Escrever os testes que falham**

Adicione a `tests/whatsappTranscricao.test.mjs`:

```javascript
test('descreverImagem devolve erro quando GEMINI_API_KEY não está configurada', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const { descreverImagem } = await import('../dist/services/whatsappTranscricao.js');
    const r = await descreverImagem({ id: 3, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('x') });
    assert.equal(r.ok, false);
    assert.match(r.erro, /GEMINI_API_KEY/);
  } finally {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  }
});

test('garantirMidiaTranscrita: sem mensagens pendentes de mídia, não faz nada e não lança', async () => {
  const { garantirMidiaTranscrita } = await import('../dist/services/whatsappTranscricao.js');
  // telefone inexistente na base de teste — não deve lançar mesmo sem linhas
  await assert.doesNotReject(() => garantirMidiaTranscrita('00000000000'));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsc && node --test tests/whatsappTranscricao.test.mjs`
Expected: FAIL — `descreverImagem`/`garantirMidiaTranscrita` não exportadas ainda.

- [ ] **Step 3: Implementar `descreverImagem()` e `garantirMidiaTranscrita()`**

Adicione ao final de `src/services/whatsappTranscricao.ts`:

```typescript
const INSTRUCAO_IMAGEM = 'Descreva em português, de forma objetiva e factual, o conteúdo '
  + 'desta imagem enviada por um cliente de escritório de advocacia. Se for documento, '
  + 'extraia os dados visíveis (nome, datas, valores, número de processo). Se for foto/print, '
  + 'descreva o que se vê. Não invente informação que não está na imagem. Máximo 500 caracteres.';

/** Descreve uma imagem via Gemini Vision. NÃO grava no banco. */
export async function descreverImagem(media: MediaRow): Promise<TranscricaoResultado> {
  if (!process.env.GEMINI_API_KEY) return { ok: false, erro: 'A leitura de imagens exige GEMINI_API_KEY' };
  const r = await aiExtractFromFile(media.data.toString('base64'), media.mime, INSTRUCAO_IMAGEM);
  if (!r.ok) return { ok: false, erro: r.message || 'Falha ao descrever a imagem' };
  const texto = String(r.text || '').trim();
  if (!texto) return { ok: false, erro: 'Não foi possível descrever a imagem' };
  return { ok: true, texto: texto.slice(0, 500) };
}

const LIMITE_MIDIA_POR_CHAMADA = 15;

/**
 * Antes de gerar o resumo da conversa, garante que todo áudio e toda foto
 * pendentes (ainda sem transcrição/descrição gravada no body) sejam
 * processados — para o resumo por IA "enxergar" esse conteúdo sem precisar de
 * cliques manuais item a item. Falha individual não interrompe os demais.
 */
export async function garantirMidiaTranscrita(phone: string): Promise<void> {
  const [pendentes] = await db.query(
    `SELECT w.id AS msg_id, w.media_id, wm.mime, wm.file_name, wm.data
       FROM whatsapp_messages w
       JOIN whatsapp_media wm ON wm.id = w.media_id
      WHERE w.phone = ?
        AND w.body NOT LIKE '%📝 Transcrição:%'
        AND w.body NOT LIKE '%🖼️ Descrição:%'
      ORDER BY w.msg_time DESC
      LIMIT ?`, [phone, LIMITE_MIDIA_POR_CHAMADA]) as any;

  for (const row of pendentes) {
    const media: MediaRow = { id: row.media_id, file_name: row.file_name, mime: row.mime, data: row.data };
    try {
      if (String(row.mime).startsWith('audio/') || String(row.mime).startsWith('video/')) {
        const r = await transcreverAudio(media);
        if (r.ok) {
          await db.query(
            "UPDATE whatsapp_messages SET body = CONCAT(body, '\n📝 Transcrição: ', ?) WHERE id = ? AND body NOT LIKE '%📝 Transcrição:%'",
            [r.texto.slice(0, 3000), row.msg_id]);
        }
      } else if (String(row.mime).startsWith('image/')) {
        const r = await descreverImagem(media);
        if (r.ok) {
          await db.query(
            "UPDATE whatsapp_messages SET body = CONCAT(body, '\n🖼️ Descrição: ', ?) WHERE id = ? AND body NOT LIKE '%🖼️ Descrição:%'",
            [r.texto, row.msg_id]);
        }
      }
      // outros mimes (pdf, vcard etc.) são ignorados — fora de escopo
    } catch {
      // falha individual não interrompe o loop — o resumo final só não terá esse item
    }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/whatsappTranscricao.test.mjs`
Expected: PASS (4 testes no total do arquivo)

- [ ] **Step 5: Commit**

```bash
git add src/services/whatsappTranscricao.ts tests/whatsappTranscricao.test.mjs
git commit -m "feat: descreverImagem() e garantirMidiaTranscrita() para resumo automático"
```

---

### Task 3: `POST /chats/:phone/resumo` chama o orquestrador

**Files:**
- Modify: `src/routes/whatsapp-instance.ts:476-495`
- Test: `tests/whatsappResumo.test.mjs` (NOVO)

**Interfaces:**
- Consumes: `garantirMidiaTranscrita(phone: string): Promise<void>` (Task 2).

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/whatsappResumo.test.mjs` — teste de auditoria de schema/estrutura (o projeto não
tem infraestrutura de teste de integração HTTP com banco real para esta rota; seguimos o
padrão de auditoria estático já usado em `tests/dashboards.test.mjs`/
`tests/briefingDataBlocks.test.mjs`):

```javascript
// tests/whatsappResumo.test.mjs
// Confirma que a rota de resumo chama garantirMidiaTranscrita() ANTES de montar
// o texto da conversa — sem isso, mídia pendente nunca entraria no resumo.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('src/routes/whatsapp-instance.ts'), 'utf8');

test('POST /chats/:phone/resumo chama garantirMidiaTranscrita antes de conversaTexto', () => {
  const m = src.match(/router\.post\('\/chats\/:phone\/resumo'[\s\S]*?\}\);/);
  assert.ok(m, 'rota /chats/:phone/resumo não encontrada');
  const corpo = m[0];
  const idxGarantir = corpo.indexOf('garantirMidiaTranscrita');
  const idxConversaTexto = corpo.indexOf('conversaTexto(');
  assert.ok(idxGarantir > -1, 'rota não chama garantirMidiaTranscrita');
  assert.ok(idxConversaTexto > -1, 'rota não chama conversaTexto');
  assert.ok(idxGarantir < idxConversaTexto, 'garantirMidiaTranscrita deve ser chamada ANTES de conversaTexto');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/whatsappResumo.test.mjs`
Expected: FAIL — `garantirMidiaTranscrita` ainda não aparece na rota.

- [ ] **Step 3: Atualizar a rota**

Em `src/routes/whatsapp-instance.ts`, troque:

```typescript
router.post('/chats/:phone/resumo', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const texto = await conversaTexto(phone);
```

por:

```typescript
router.post('/chats/:phone/resumo', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const { garantirMidiaTranscrita } = await import('../services/whatsappTranscricao');
  await garantirMidiaTranscrita(phone);
  const texto = await conversaTexto(phone);
```

(o restante da rota, linhas 480-495, fica igual)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/whatsappResumo.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/whatsapp-instance.ts tests/whatsappResumo.test.mjs
git commit -m "feat: resumo da conversa transcreve áudio e descreve fotos automaticamente"
```

---

### Task 4: Feedback de loading mais claro no botão de resumo (frontend)

**Files:**
- Modify: `public/whatsapp.js:586-597`

O botão já mostra "Lendo a conversa…" enquanto espera. Como a chamada agora pode demorar mais
(processa mídia pendente antes de responder), ajuste o texto para deixar isso explícito —
sem mudar a estrutura do handler.

**Interfaces:**
- Consumes: nenhuma interface nova — só texto de UI.

- [ ] **Step 1: Editar o texto do botão durante o loading**

Em `public/whatsapp.js`, troque a linha 588:

```javascript
rs.disabled = true; rs.textContent = 'Lendo a conversa…';
```

por:

```javascript
rs.disabled = true; rs.textContent = 'Lendo a conversa (áudios e fotos incluídos)…';
```

- [ ] **Step 2: Testar manualmente**

Não há teste automatizado de UI neste projeto para este trecho. Abra a tela de Conversas no
navegador, clique em "Resumir conversa com IA" numa conversa com pelo menos um áudio ou foto
ainda não transcritos, e confirme visualmente que o texto do botão muda durante o
carregamento.

- [ ] **Step 3: Commit**

```bash
git add public/whatsapp.js
git commit -m "chore: texto do botão de resumo indica que processa áudio/foto"
```

---

### Task 5: `severidadeConversa()` — função pura de classificação

**Files:**
- Create: `src/services/whatsappSeveridade.ts`
- Test: `tests/whatsappSeveridade.test.mjs`

O spec pede a função no frontend (`public/whatsapp.js`), mas como o projeto já usa TypeScript
compilado para lógica pura testável (`briefingSeverity.ts`), e `public/*.js` não passa por
build/teste automatizado, a função é escrita em TypeScript aqui, testada com `node --test`
(mesmo padrão de `briefingSeverity.test.mjs`), e a Task 8 copia o código já validado para
`public/whatsapp.js` (arquivo servido direto ao browser, sem módulos ES).

**Interfaces:**
- Produces: `export type SeveridadeConversa = 'critica' | 'atencao' | 'neutra';`
  `export interface ChatPendencia { proxima_audiencia_dias: number | null;
  parcela_vencendo_dias: number | null; }`
  `export function severidadeConversa(chat: ChatPendencia): SeveridadeConversa;`
  `export function etiquetaPendencia(chat: ChatPendencia): { icone: 'scale' | 'banknote';
  texto: string } | null;`

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/whatsappSeveridade.test.mjs`:

```javascript
// tests/whatsappSeveridade.test.mjs
// Mesmos limiares do Briefing Jurídico Matinal (briefingSeverity.ts) — ver spec
// docs/superpowers/specs/2026-08-21-whatsapp-conversas-redesign.md.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/whatsappSeveridade.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { severidadeConversa, etiquetaPendencia } = await import('../dist/services/whatsappSeveridade.js');

test('audiência hoje é crítica', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 0, parcela_vencendo_dias: null }), 'critica');
});
test('audiência em 2 dias é crítica', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 2, parcela_vencendo_dias: null }), 'critica');
});
test('audiência em 5 dias é atenção', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 5, parcela_vencendo_dias: null }), 'atencao');
});
test('audiência em 7 dias é atenção, em 8 dias é neutra', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 7, parcela_vencendo_dias: null }), 'atencao');
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 8, parcela_vencendo_dias: null }), 'neutra');
});
test('sem audiência nem parcela é neutra', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: null }), 'neutra');
});
test('parcela atrasada (negativa) é crítica mesmo sem audiência', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: -2 }), 'critica');
});
test('parcela vencendo hoje é crítica', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: 0 }), 'critica');
});
test('parcela em 3 dias é atenção, em 4 dias é neutra', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: 3 }), 'atencao');
  assert.equal(severidadeConversa({ proxima_audiencia_dias: null, parcela_vencendo_dias: 4 }), 'neutra');
});
test('o pior dos dois indicadores prevalece', () => {
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 8, parcela_vencendo_dias: 0 }), 'critica');
  assert.equal(severidadeConversa({ proxima_audiencia_dias: 5, parcela_vencendo_dias: 4 }), 'atencao');
});

test('etiquetaPendencia mostra audiência quando ela é a mais urgente', () => {
  const e = etiquetaPendencia({ proxima_audiencia_dias: 2, parcela_vencendo_dias: 5 });
  assert.equal(e.icone, 'scale');
  assert.match(e.texto, /Audiência em 2 dias/);
});
test('etiquetaPendencia mostra parcela quando ela é a mais urgente', () => {
  const e = etiquetaPendencia({ proxima_audiencia_dias: 6, parcela_vencendo_dias: 1 });
  assert.equal(e.icone, 'banknote');
  assert.match(e.texto, /Parcela vence em 1 dia\b/);
});
test('etiquetaPendencia é null quando neutra', () => {
  assert.equal(etiquetaPendencia({ proxima_audiencia_dias: null, parcela_vencendo_dias: null }), null);
});
test('etiquetaPendencia usa "hoje"/"atrasada" nos extremos', () => {
  assert.match(etiquetaPendencia({ proxima_audiencia_dias: 0, parcela_vencendo_dias: null }).texto, /Audiência hoje/);
  assert.match(etiquetaPendencia({ proxima_audiencia_dias: null, parcela_vencendo_dias: -1 }).texto, /Parcela atrasada/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx tsc && node --test tests/whatsappSeveridade.test.mjs`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/services/whatsappSeveridade.ts`**

```typescript
// src/services/whatsappSeveridade.ts
// Classificação de urgência de uma conversa de WhatsApp para a lista de
// Conversas — mesmos limiares do Briefing Jurídico Matinal (briefingSeverity.ts),
// para manter o mesmo vocabulário visual em todo o CRM. Ver spec
// docs/superpowers/specs/2026-08-21-whatsapp-conversas-redesign.md.
export type SeveridadeConversa = 'critica' | 'atencao' | 'neutra';

export interface ChatPendencia {
  proxima_audiencia_dias: number | null;
  parcela_vencendo_dias: number | null;
}

function severidadeAudiencia(dias: number | null): SeveridadeConversa {
  if (dias === null) return 'neutra';
  if (dias <= 2) return 'critica';
  if (dias <= 7) return 'atencao';
  return 'neutra';
}

function severidadeParcela(dias: number | null): SeveridadeConversa {
  if (dias === null) return 'neutra';
  if (dias <= 0) return 'critica';
  if (dias <= 3) return 'atencao';
  return 'neutra';
}

const PESO: Record<SeveridadeConversa, number> = { critica: 2, atencao: 1, neutra: 0 };

export function severidadeConversa(chat: ChatPendencia): SeveridadeConversa {
  const a = severidadeAudiencia(chat.proxima_audiencia_dias);
  const p = severidadeParcela(chat.parcela_vencendo_dias);
  return PESO[a] >= PESO[p] ? a : p;
}

/** Etiqueta (pill) de UMA pendência crítica/de atenção real — a mais urgente entre as duas. */
export function etiquetaPendencia(chat: ChatPendencia): { icone: 'scale' | 'banknote'; texto: string } | null {
  const a = severidadeAudiencia(chat.proxima_audiencia_dias);
  const p = severidadeParcela(chat.parcela_vencendo_dias);
  if (a === 'neutra' && p === 'neutra') return null;
  const audienciaGanha = PESO[a] >= PESO[p];
  if (audienciaGanha) {
    const d = chat.proxima_audiencia_dias as number;
    const texto = d === 0 ? 'Audiência hoje' : d === 1 ? 'Audiência amanhã' : `Audiência em ${d} dias`;
    return { icone: 'scale', texto };
  }
  const d = chat.parcela_vencendo_dias as number;
  const texto = d < 0 ? 'Parcela atrasada' : d === 0 ? 'Parcela vence hoje' : d === 1 ? 'Parcela vence amanhã' : `Parcela vence em ${d} dias`;
  return { icone: 'banknote', texto };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx tsc && node --test tests/whatsappSeveridade.test.mjs`
Expected: PASS (13 testes)

- [ ] **Step 5: Commit**

```bash
git add src/services/whatsappSeveridade.ts tests/whatsappSeveridade.test.mjs
git commit -m "feat: severidadeConversa() e etiquetaPendencia() para a lista de conversas"
```

---

### Task 6: `GET /chats` ganha os 2 campos agregados

**Files:**
- Modify: `src/routes/whatsapp-instance.ts:147-176`
- Test: `tests/whatsappChatsQuery.test.mjs` (NOVO)

**Interfaces:**
- Consumes: tabelas `calendar_events` (colunas usadas em
  `src/routes/whatsapp-instance.ts:288`: `event_type`, `start_datetime`, `client_id`,
  `case_id`), `installments` (colunas confirmadas em `migrations/001_base_schema.sql:206-221`:
  `client_id`, `due_date`, `status`), `cases` (`client_id`).
- Produces: cada linha de `GET /chats` passa a incluir `proxima_audiencia_dias: number |
  null` e `parcela_vencendo_dias: number | null` (mesmos nomes/tipos consumidos pela Task 7
  no frontend).

**Cuidado de performance:** as 2 subqueries abaixo são agregadas por `client_id` uma vez,
não uma consulta por linha de chat — evita N+1. `calendar_events` e `installments` não têm
telefone — o vínculo é sempre via `w.client_id`, que já está na query atual.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/whatsappChatsQuery.test.mjs` — auditoria de schema reaproveitando o helper já
usado no Briefing (mesmo padrão de `tests/briefingDataBlocks.test.mjs`):

```javascript
// tests/whatsappChatsQuery.test.mjs
// Audita a query de GET /chats contra o schema real — mesmo mecanismo já usado
// no Briefing Jurídico Matinal (tests/briefingDataBlocks.test.mjs), para não
// reintroduzir coluna/tabela inexistente nas subqueries novas de
// proxima_audiencia_dias/parcela_vencendo_dias.
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

test('GET /chats: subqueries novas não referenciam tabela/coluna inexistente', () => {
  const arquivo = path.resolve('src/routes/whatsapp-instance.ts');
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([arquivo]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('GET /chats: SELECT inclui proxima_audiencia_dias e parcela_vencendo_dias', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.resolve('src/routes/whatsapp-instance.ts'), 'utf8');
  const m = src.match(/router\.get\('\/chats'[\s\S]*?\}\);/);
  assert.ok(m, 'rota GET /chats não encontrada');
  assert.match(m[0], /proxima_audiencia_dias/);
  assert.match(m[0], /parcela_vencendo_dias/);
});
```

Note: o segundo teste usa `require('node:fs')` dentro do corpo — troque por um `import fs
from 'node:fs'` no topo do arquivo (junto com os outros imports) em vez de `require` inline,
já que o projeto usa ESM nos testes (ver `tests/whatsappResumo.test.mjs` da Task 3 como
referência de import no topo).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/whatsappChatsQuery.test.mjs`
Expected: FAIL no segundo teste — os campos novos ainda não existem na query.

- [ ] **Step 3: Adicionar as subqueries agregadas**

Em `src/routes/whatsapp-instance.ts`, troque o `SELECT` de `GET /chats` (linhas 157-174) por:

```typescript
  const [rows] = await db.query(`
    SELECT w.phone,
           MAX(w.msg_time) AS last_time,
           SUBSTRING_INDEX(GROUP_CONCAT(w.body ORDER BY w.msg_time DESC, w.id DESC SEPARATOR '\\n§§'), '\\n§§', 1) AS last_body,
           SUBSTRING_INDEX(GROUP_CONCAT(w.from_me ORDER BY w.msg_time DESC, w.id DESC), ',', 1) AS last_from_me,
           MAX(w.client_id) AS client_id,
           MAX(cl.name) AS client_name,
           MAX(m.unread) AS unread,
           MAX(m.labels) AS labels,
           MAX(m.push_name) AS push_name,
           MAX(m.pinned) AS pinned,
           MAX(m.archived) AS archived,
           MIN(aud.dias) AS proxima_audiencia_dias,
           MIN(parc.dias) AS parcela_vencendo_dias
      FROM whatsapp_messages w
      LEFT JOIN clients cl ON cl.id = w.client_id
      LEFT JOIN whatsapp_chat_meta m ON m.phone = w.phone
      LEFT JOIN (
        SELECT c.client_id, DATEDIFF(ce.start_datetime, CURDATE()) AS dias
          FROM calendar_events ce
          JOIN cases c ON c.id = ce.case_id
         WHERE ce.event_type = 'audiencia' AND ce.start_datetime >= CURDATE() AND ce.start_datetime < DATE_ADD(CURDATE(), INTERVAL 8 DAY)
      ) aud ON aud.client_id = w.client_id
      LEFT JOIN (
        SELECT client_id, DATEDIFF(due_date, CURDATE()) AS dias
          FROM installments
         WHERE status = 'pendente' AND due_date < DATE_ADD(CURDATE(), INTERVAL 4 DAY)
      ) parc ON parc.client_id = w.client_id
     ${whereQ}
     GROUP BY w.phone
     ORDER BY last_time DESC LIMIT 100`, q ? [like, like, like] : []) as any;
```

Nota: `calendar_events` também pode ter `client_id` direto (ver
`src/routes/whatsapp-instance.ts:290` que consulta `client_id = ? OR case_id IN (...)`) — a
subquery acima cobre apenas via `cases.client_id` para simplificar a agregação; se a
auditoria de schema (Step 2) apontar que `calendar_events.client_id` também é usado e
relevante, isso é aceitável ficar de fora nesta primeira versão (áudiencias vinculadas
direto ao cliente sem processo são raras) — não é um requisito da spec, não expandir escopo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/whatsappChatsQuery.test.mjs`
Expected: PASS (2 testes)

- [ ] **Step 5: Medir o impacto de performance**

Run (com o servidor local rodando e ao menos alguns chats/clientes cadastrados):
```bash
curl -s -o /dev/null -w "%{time_total}\n" -H "Cookie: <cookie de sessão válido>" http://localhost:3000/api/whatsapp-instance/chats
```
Expected: tempo total não deve saltar de forma perceptível em relação ao medido antes desta
task (orçamento da spec: <50ms de acréscimo com a base atual de ~108 clientes). Se o teste
manual não for viável neste ambiente, ao menos confirme via `EXPLAIN` que as subqueries usam
os índices existentes (`idx_installments_client`/`idx_installments_due`, e o índice de
`case_id`/`client_id` já presentes em `calendar_events`/`cases`) em vez de full scan.

- [ ] **Step 6: Commit**

```bash
git add src/routes/whatsapp-instance.ts tests/whatsappChatsQuery.test.mjs
git commit -m "feat: GET /chats inclui proxima_audiencia_dias e parcela_vencendo_dias"
```

---

### Task 7: Ícone `banknote` disponível para a pill de parcela

**Files:**
- Modify: nenhum — o ícone `banknote` já existe em `public/app.js:428` (`ICONS.banknote`) e
  `scale` já existe em `public/app.js:425` (`ICONS.scale`). Esta task só confirma que ambos
  renderizam corretamente antes de usá-los na Task 8, sem exigir nenhuma mudança de arquivo.

**Interfaces:**
- Consumes: `svgIcon(nome: string, classe?: string): string` (global já existente, definido
  em `public/app.js` e usado por `public/whatsapp.js` sem import — mesmo padrão de todo o
  resto do arquivo, ex. `svgIcon('pin', 'ic-xs')` em `public/whatsapp.js:349`).

- [ ] **Step 1: Confirmar visualmente**

Abra o CRM no navegador, vá em qualquer tela que já usa `svgIcon('banknote')` ou
`svgIcon('scale')` (ex. módulo Financeiro para `banknote`) e confirme que os ícones aparecem
corretamente — nenhuma mudança de código nesta task, é só a verificação que libera a Task 8
para usá-los com confiança.

- [ ] **Step 2: Nenhum commit** — task de verificação, sem mudança de arquivo.

---

### Task 8: Redesign do cabeçalho e da lista de conversas (frontend)

**Files:**
- Modify: `public/whatsapp.js:291-374` (markup do shell + `renderLista()`)
- Modify: `public/styles.css:1439-1465` (`.wa-side`, `.wa-search`, `.wa-filters`,
  `.wa-filter`, `.wa-list`, `.wa-item`, `.wa-ava`, `.wa-item-mid`, `.wa-item-name`,
  `.wa-item-prev`, `.wa-item-right`, `.wa-item-time`, `.wa-unread`)

**Interfaces:**
- Consumes: `severidadeConversa(chat)` e `etiquetaPendencia(chat)` — mesma lógica validada em
  TypeScript na Task 5, reescrita aqui em JavaScript puro (arquivo servido direto ao browser,
  sem build step, não pode importar de `dist/`). Os nomes de função e os limiares DEVEM ser
  idênticos aos de `src/services/whatsappSeveridade.ts` para as duas versões não divergirem
  com o tempo.
- Consumes: campos novos de `GET /chats` da Task 6 — `c.proxima_audiencia_dias`,
  `c.parcela_vencendo_dias` (já presentes em cada objeto `chats[]`, nenhuma mudança na
  chamada de `api()` que carrega `chats`).

- [ ] **Step 1: Adicionar `severidadeConversa()`/`etiquetaPendencia()` em `public/whatsapp.js`**

Logo antes da declaração de `renderLista` (linha 334), adicione:

```javascript
      // Mesma lógica/limiares de src/services/whatsappSeveridade.ts — ver spec
      // docs/superpowers/specs/2026-08-21-whatsapp-conversas-redesign.md. Reescrita aqui
      // porque este arquivo é servido direto ao navegador, sem build step.
      const severidadeAudiencia = (dias) => {
        if (dias === null || dias === undefined) return 'neutra';
        if (dias <= 2) return 'critica';
        if (dias <= 7) return 'atencao';
        return 'neutra';
      };
      const severidadeParcela = (dias) => {
        if (dias === null || dias === undefined) return 'neutra';
        if (dias <= 0) return 'critica';
        if (dias <= 3) return 'atencao';
        return 'neutra';
      };
      const PESO_SEV = { critica: 2, atencao: 1, neutra: 0 };
      const severidadeConversa = (c) => {
        const a = severidadeAudiencia(c.proxima_audiencia_dias);
        const p = severidadeParcela(c.parcela_vencendo_dias);
        return PESO_SEV[a] >= PESO_SEV[p] ? a : p;
      };
      const etiquetaPendencia = (c) => {
        const a = severidadeAudiencia(c.proxima_audiencia_dias);
        const p = severidadeParcela(c.parcela_vencendo_dias);
        if (a === 'neutra' && p === 'neutra') return null;
        if (PESO_SEV[a] >= PESO_SEV[p]) {
          const d = c.proxima_audiencia_dias;
          const texto = d === 0 ? 'Audiência hoje' : d === 1 ? 'Audiência amanhã' : `Audiência em ${d} dias`;
          return { icone: 'scale', texto };
        }
        const d = c.parcela_vencendo_dias;
        const texto = d < 0 ? 'Parcela atrasada' : d === 0 ? 'Parcela vence hoje' : d === 1 ? 'Parcela vence amanhã' : `Parcela vence em ${d} dias`;
        return { icone: 'banknote', texto };
      };
```

- [ ] **Step 2: Reescrever o markup do cabeçalho da coluna 1**

Em `public/whatsapp.js`, troque o bloco `<div class="wa-side">...</div>` (linhas 292-296)
por:

```javascript
        <div class="wa-side">
          <div class="wa-head-col">
            <span class="wa-head-col-title">Conversas</span>
            <span class="wa-head-col-unread" id="wa-unread-total"></span>
          </div>
          <div class="wa-search" style="display:flex;gap:6px;align-items:center">${svgIcon('search', 'ic-inline')}<input id="waq" placeholder="Buscar conversa…" autocomplete="off"><button type="button" class="btn-icon btn-icon-sm" id="wa-agenda-btn" title="Agenda telefônica">${svgIcon('users', 'ic-xs')}</button><button type="button" class="btn-icon btn-icon-sm" id="wa-auditoria-btn" title="Auditoria de mensagens apagadas">${svgIcon('info', 'ic-xs')}</button></div>
          <div class="wa-filters" id="waf"></div>
          <div class="wa-list" id="wal"></div>
        </div>
```

- [ ] **Step 3: Atualizar `renderLista()` para severidade + pill**

Em `public/whatsapp.js`, troque o corpo de `renderLista` (linhas 343-357) por:

```javascript
        const html = vis.length ? vis.map((c) => {
          const nome = c.client_name || c.push_name || '+' + c.phone;
          const tags = parseLabels(c.labels);
          const sev = severidadeConversa(c);
          const et = etiquetaPendencia(c);
          return `<div class="wa-item sev-${sev} ${ativo && ativo.phone === c.phone ? 'on' : ''}" data-chat="${esc(c.phone)}">
            <div class="wa-ava" style="background:${cor(nome)}">${iniciais(nome)}</div>
            <div class="wa-item-mid">
              <div class="wa-item-name">${Number(c.pinned) ? svgIcon('pin', 'ic-xs') + ' ' : ''}${esc(nome)}</div>
              <div class="wa-item-prev">${Number(c.last_from_me) ? '✓ ' : ''}${esc(String(c.last_body || '').slice(0, 52))}</div>
              ${tags.length ? `<div class="wa-tags">${tags.map((t) => `<span class="wa-tag" style="background:${cor(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
              ${et ? `<span class="wa-pill wa-pill-${sev}">${svgIcon(et.icone, 'ic-xs')}${esc(et.texto)}</span>` : ''}
            </div>
            <div class="wa-item-right">
              <div class="wa-item-time">${fmtDia(c.last_time) === 'Hoje' ? fmtHora(c.last_time) : fmtDia(c.last_time)}</div>
              ${Number(c.unread) ? `<span class="wa-unread">${c.unread}</span>` : ''}
            </div>
          </div>`;
        }).join('') : `<div class="wa-empty">${mostrarArquivadas ? 'Nenhuma conversa arquivada' : 'Nenhuma conversa encontrada'}</div>`;
```

- [ ] **Step 4: Atualizar o contador de não lidas no cabeçalho novo**

Ainda em `renderLista`, logo após a linha que faz `$('#wal').scrollTop = scrollAtual;` (dentro
do bloco que só roda quando a lista mudou), adicione a atualização do contador:

```javascript
        const totalNaoLidas = chats.reduce((s, c) => s + Number(c.unread || 0), 0);
        const elUnread = $('#wa-unread-total');
        if (elUnread) elUnread.textContent = totalNaoLidas ? `${totalNaoLidas} não lida${totalNaoLidas > 1 ? 's' : ''}` : '';
```

Insira essa atualização SEMPRE que `renderLista` roda — inclusive quando `html ===
listaHtmlAtual` faz a função retornar cedo — porque o contador de não lidas pode mudar mesmo
quando a lista renderizada é idêntica (ex.: uma conversa lida em outra aba). Mova o cálculo
de `totalNaoLidas` para ANTES do `if (html === listaHtmlAtual) return;` (linha 362), assim:

```javascript
        const totalNaoLidas = chats.reduce((s, c) => s + Number(c.unread || 0), 0);
        const elUnread = $('#wa-unread-total');
        if (elUnread) elUnread.textContent = totalNaoLidas ? `${totalNaoLidas} não lida${totalNaoLidas > 1 ? 's' : ''}` : '';
        if (html === listaHtmlAtual) return;
```

- [ ] **Step 5: CSS do cabeçalho novo e da pill**

Em `public/styles.css`, logo antes da linha `.wa-side { ... }` (linha 1439), adicione:

```css
.wa-head-col { background: var(--navy, #0d1b2e); border-bottom: 3px solid var(--gold); padding: 14px 16px 12px; display: flex; justify-content: space-between; align-items: center; }
.wa-head-col-title { font-family: Georgia, serif; font-size: 17px; font-weight: 700; color: #fff; letter-spacing: .2px; }
.wa-head-col-unread { font-size: 11px; color: var(--gold); letter-spacing: .3px; font-weight: 600; }
.wa-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; padding: 3px 9px 3px 7px; border-radius: 9px; margin-top: 6px; }
.wa-pill svg { width: 11px; height: 11px; }
.wa-pill-critica { background: #b3432f; color: #fff; }
.wa-pill-atencao { background: #faf1e0; color: #a67626; }
```

- [ ] **Step 6: CSS da borda de urgência e espaçamento da lista**

Na mesma seção de `public/styles.css`, troque as regras existentes de `.wa-item` (linha
1453-1455) e `.wa-list` (linha 1452) por:

```css
.wa-list { flex: 1; overflow-y: auto; padding: 8px 10px; }
.wa-item { display: flex; gap: 12px; padding: 13px 12px; margin-bottom: 5px; border-radius: 9px; border-left: 4px solid #e2ddd1; cursor: pointer; align-items: flex-start; transition: background 120ms ease, box-shadow 150ms ease; }
.wa-item:hover { background: var(--surface-2, rgba(0,0,0,.03)); }
.wa-item.on { background: var(--gold-soft, #efe3c8); }
.wa-item.sev-critica { border-left-color: #b3432f; }
.wa-item.sev-atencao { border-left-color: #a67626; }
.wa-item.sev-neutra { border-left-color: #e2ddd1; }
```

Não remova nenhuma outra regra existente na seção (`.wa-ava`, `.wa-item-mid`,
`.wa-item-name`, `.wa-item-prev`, `.wa-item-right`, `.wa-item-time`, `.wa-unread`, `.wa-tag`)
— ficam como estão, compatíveis com o novo `.wa-item`.

- [ ] **Step 7: Testar manualmente**

Não há teste automatizado de renderização de DOM neste projeto. Rode o servidor local
(`npm run dev` ou equivalente já usado no projeto), abra a tela de Conversas, e confirme:
- Cabeçalho navy com friso dourado e contador de não lidas aparece.
- Pelo menos uma conversa com cliente que tem audiência em ≤7 dias ou parcela pendente
  mostra a borda colorida e a pill correta (crie um compromisso/parcela de teste se não
  houver nenhum na base local).
- Conversas sem pendência continuam com borda neutra e sem pill.
- Filtros, busca, fixar/arquivar continuam funcionando (nenhuma regressão).

- [ ] **Step 8: Commit**

```bash
git add public/whatsapp.js public/styles.css
git commit -m "feat: redesign visual da lista de conversas (urgência + pendência crítica)"
```

---

## Self-Review (already applied while writing this plan)

**Spec coverage:**
- Cabeçalho navy/dourado → Task 8, Step 2 e 5.
- Borda de urgência 4px por severidade → Task 8, Step 6.
- Pill de pendência crítica → Task 5 (lógica) + Task 8, Step 3/5.
- `GET /chats` com 2 campos agregados, sem N+1 → Task 6.
- `severidadeConversa()` pura e testável → Task 5.
- Transcrição automática de áudio no resumo → Tasks 1-3.
- Descrição automática de foto no resumo → Task 2-3.
- Limite de 15 itens, falha individual não trava → Task 2, Step 3.
- Marcador `🖼️ Descrição:` distinto de `📝 Transcrição:` → Task 2, Step 3.
- Fora de escopo (painel de mensagens/ficha, botão "transcrever tudo" separado) →
  respeitado, nenhuma task mexe nisso.

**Placeholder scan:** nenhum "TBD"/"similar to Task N" — todo código está completo em cada
step.

**Type consistency:** `MediaRow`/`TranscricaoResultado` (Task 1) reaproveitados
identicamente na Task 2. `ChatPendencia`/`SeveridadeConversa` (Task 5) usam os mesmos nomes
de campo (`proxima_audiencia_dias`, `parcela_vencendo_dias`) produzidos pela Task 6 e
consumidos pela Task 8.
