# WhatsApp: Categorização de Documento + Ação de IA na Conversa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classificar automaticamente o tipo de documento (RG, CTPS, comprovante, procuração) ao receber mídia pelo WhatsApp, e permitir gerar peças/textos com IA a partir do resumo de uma conversa, sem sair da tela de Conversas.

**Architecture:** Item 1 é uma função pura de classificação (`classificarTipoDocumento`) chamada dentro de `storeMedia` (best-effort, nunca bloqueia o salvamento). Item 2 generaliza `iaForm` (já existente em `app.js`) para aceitar valores iniciais, e adiciona um botão em `whatsapp.js` que busca o resumo da conversa e abre esse formulário pré-preenchido — reaproveitando 100% do modal de preview/salvar já existente, sem UI nova duplicada.

**Tech Stack:** Node.js + TypeScript + Express + MySQL (mysql2/promise, sem ORM). Testes com `node --test` contra `dist/` compilado (`npx tsc` primeiro). Frontend vanilla JS sem build step, `app.js` e `whatsapp.js` compartilham escopo global (sem módulos ES).

## Global Constraints

- Item 1 é best-effort: falha da IA nunca impede o salvamento do documento (mesmo padrão de resiliência de `descreverImagem`/`garantirMidiaTranscrita`, spec item 1).
- Sem fluxo de confirmação via WhatsApp (pergunta/resposta ao cliente) — a usuária corrige o tipo na tela de Documentos normal, que já existe (spec item 1, fora de escopo).
- Item 2 reaproveita `TEMPLATES`/`GET /api/ai/templates`/`POST /api/ai/generate`/`POST /:id/save-document` já existentes — nenhuma rota nova de IA, nenhum prompt novo (spec item 2).
- Item 2 reaproveita `iaForm`/`iaViewer` (`public/app.js`) — nenhum modal/formulário duplicado em `whatsapp.js` (spec item 2, "Reaproveitamento confirmado").
- Divisão de IA: classificação de tipo de documento usa Gemini via `aiExtractFromFile` (só Gemini lê arquivo/imagem, sem fallback Groq) — mesma função já usada por `descreverImagem`.

---

### Task 1: Classificação automática de tipo de documento

**Files:**
- Modify: `src/services/whatsappTranscricao.ts` (nova função exportada)
- Modify: `src/routes/whatsapp-webhook.ts:33-70` (`storeMedia`)
- Test: `tests/whatsappClassificacaoDocumento.test.mjs` (novo)

**Interfaces:**
- Produces: `classificarTipoDocumento(media: MediaRow): Promise<string | null>` exportada de `src/services/whatsappTranscricao.ts` — devolve um dos 5 valores fixos (`'rg'|'ctps'|'comprovante_residencia'|'procuracao'|'outro'`) ou `null` se a IA falhar/não tiver certeza/mime não suportado.

- [ ] **Step 1: Escrever o teste falho**

Criar `tests/whatsappClassificacaoDocumento.test.mjs`:

```javascript
// tests/whatsappClassificacaoDocumento.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/whatsappTranscricao.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { classificarTipoDocumento } = await import('../dist/services/whatsappTranscricao.js');

test('classifica corretamente quando a IA devolve um valor da lista fixa', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fake-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'rg' }] } }] }),
  });
  try {
    const media = { id: 1, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, 'rg');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('valor fora da lista fixa vira null, não é gravado como está', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fake-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'não tenho certeza, parece ser um boleto' }] } }] }),
  });
  try {
    const media = { id: 1, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('falha da IA (sem chave configurada) devolve null, não lança erro', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const media = { id: 1, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, null);
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
  }
});

test('mime não suportado (áudio) devolve null sem chamar a IA', async () => {
  const originalFetch = globalThis.fetch;
  let chamouFetch = false;
  globalThis.fetch = async () => { chamouFetch = true; return { ok: true, json: async () => ({}) }; };
  try {
    const media = { id: 1, file_name: 'audio.ogg', mime: 'audio/ogg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, null);
    assert.equal(chamouFetch, false, 'não deveria nem tentar chamar a IA para um mime não suportado');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx tsc && node --test tests/whatsappClassificacaoDocumento.test.mjs`
Expected: FAIL — `classificarTipoDocumento` não existe em `whatsappTranscricao.ts` ainda.

- [ ] **Step 3: Implementar a função**

Em `src/services/whatsappTranscricao.ts`, adicionar logo após `descreverImagem` (antes de `LIMITE_MIDIA_POR_CHAMADA`):

```typescript
const TIPOS_DOCUMENTO = ['rg', 'ctps', 'comprovante_residencia', 'procuracao', 'outro'] as const;

const INSTRUCAO_CLASSIFICACAO = 'Classifique este documento/foto enviado por um cliente de escritório de '
  + 'advocacia em UMA destas categorias exatas, respondendo APENAS a palavra da categoria, sem mais nada: '
  + 'rg, ctps, comprovante_residencia, procuracao, outro. Se não tiver certeza, responda outro.';

/**
 * Classifica o tipo de um documento (imagem ou PDF) via Gemini Vision, para
 * preencher documents.type automaticamente. Best-effort: qualquer falha ou
 * resposta fora da lista fixa devolve null — quem chama mantém o valor atual
 * ('recebido') nesse caso, nunca quebra o salvamento do documento.
 */
export async function classificarTipoDocumento(media: MediaRow): Promise<string | null> {
  const mime = String(media.mime);
  if (!mime.startsWith('image/') && mime !== 'application/pdf') return null;
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const r = await aiExtractFromFile(media.data.toString('base64'), mime, INSTRUCAO_CLASSIFICACAO);
    if (!r.ok) return null;
    const valor = String(r.text || '').trim().toLowerCase();
    return (TIPOS_DOCUMENTO as readonly string[]).includes(valor) ? valor : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx tsc && node --test tests/whatsappClassificacaoDocumento.test.mjs`
Expected: PASS — 4/4 testes.

- [ ] **Step 5: Integrar em `storeMedia`**

Em `src/routes/whatsapp-webhook.ts`, adicionar o import no topo do arquivo:

```typescript
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { uazapi } from '../services/uazapiClient';
import { classificarTipoDocumento } from '../services/whatsappTranscricao';
```

Dentro de `storeMedia`, substituir o bloco que insere em `documents` (linhas 56-64 atuais) para classificar antes de gravar:

Código atual (a localizar):
```typescript
    // Vira Documento do cliente automaticamente (Central de Documentos)
    if (clientId) {
      const [[adm]] = await db.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
      await db.query(
        `INSERT INTO documents (client_id, name, type, folder, file_url, status, created_by)
         VALUES (?, ?, 'recebido', 'outros', ?, 'ativo', ?)`,
        [clientId, `WhatsApp — ${fileName}`.slice(0, 255), `/api/whatsapp-instance/media/${mediaId}`, adm?.id ?? 1]).catch(() => {});
    }
```

Código novo (substitui o bloco acima):
```typescript
    // Vira Documento do cliente automaticamente (Central de Documentos).
    // Tenta classificar o tipo via IA (best-effort) — falha mantém 'recebido',
    // igual ao comportamento anterior a esta mudança.
    if (clientId) {
      const [[adm]] = await db.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
      const tipoClassificado = await classificarTipoDocumento({ id: mediaId, file_name: fileName, mime: info.mime, data: buffer }).catch(() => null);
      await db.query(
        `INSERT INTO documents (client_id, name, type, folder, file_url, status, created_by)
         VALUES (?, ?, ?, 'outros', ?, 'ativo', ?)`,
        [clientId, `WhatsApp — ${fileName}`.slice(0, 255), tipoClassificado || 'recebido', `/api/whatsapp-instance/media/${mediaId}`, adm?.id ?? 1]).catch(() => {});
    }
```

- [ ] **Step 6: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de pass/fail/skip de antes desta task, mais os 4 novos testes passando.

- [ ] **Step 7: Commit**

```bash
git add src/services/whatsappTranscricao.ts src/routes/whatsapp-webhook.ts tests/whatsappClassificacaoDocumento.test.mjs
git commit -m "feat: classifica automaticamente o tipo de documento recebido no WhatsApp"
```

---

### Task 2: Generalizar `iaForm` para aceitar valores iniciais

**Files:**
- Modify: `public/app.js:2447-2476` (`iaForm`)

**Interfaces:**
- Produces: `iaForm(onSave, opts)` onde `opts` é opcional: `{ type?: string, client_id?: number|string, prefill?: Record<string,string> }`. Quando `opts.type` é passado, o `<select>` de tipo já abre nesse valor; quando `opts.client_id` é passado, o `<select>` de cliente já abre nesse valor; `opts.prefill` preenche os campos do template pelo `name` original (ex: `{ texto: '...' }` preenche o campo `texto` do template `resumo_intimacao`). Comportamento sem `opts` (chamada antiga, `iaForm(onSave)`) continua idêntico ao de hoje — usado pela Task 3.

- [ ] **Step 1: Editar `iaForm`**

Em `public/app.js`, localizar a função `iaForm` (busque por `async function iaForm(onSave) {`). Substituir pela versão que aceita o segundo parâmetro opcional:

Código atual (a localizar e substituir):
```javascript
async function iaForm(onSave) {
  const [templates, clients] = await Promise.all([api('/api/ai/templates'), api('/api/clients?limit=200')]);
  const typeOpts = templates.map((t) => ({ v: t.type, t: t.label }));
  const form = el(`<form class="form-grid">
    ${field('Tipo de documento', 'type', { options: typeOpts })}
    ${field('Cliente (opcional)', 'client_id', { options: [{ v: '', t: '—' }].concat(clients.data.map((c) => ({ v: c.id, t: c.name }))) })}
    <div id="ia-fields"></div>
    <button type="submit" class="btn-primary">Gerar</button>
  </form>`);
  const typeSel = form.querySelector('[name=type]');
  const renderFields = () => {
    const tpl = templates.find((t) => t.type === typeSel.value);
    form.querySelector('#ia-fields').innerHTML = tpl.fields.map((f) =>
      field(f.label, 'f_' + f.name, f.type === 'textarea' ? { type: 'textarea' } : {})).join('');
  };
  typeSel.onchange = renderFields; renderFields();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const inputs = {};
    for (const k in fd) if (k.startsWith('f_')) inputs[k.slice(2)] = fd[k];
    const body = { type: fd.type, inputs };
    if (fd.client_id) body.client_id = fd.client_id;
    try {
      const r = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); if (onSave) onSave(); iaViewer(r.id, onSave);
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova geração de IA', form);
}
```

Código novo (substitui o bloco acima):
```javascript
async function iaForm(onSave, opts) {
  const o = opts || {};
  const [templates, clients] = await Promise.all([api('/api/ai/templates'), api('/api/clients?limit=200')]);
  const typeOpts = templates.map((t) => ({ v: t.type, t: t.label }));
  const form = el(`<form class="form-grid">
    ${field('Tipo de documento', 'type', { options: typeOpts, value: o.type || '' })}
    ${field('Cliente (opcional)', 'client_id', { options: [{ v: '', t: '—' }].concat(clients.data.map((c) => ({ v: c.id, t: c.name }))), value: o.client_id || '' })}
    <div id="ia-fields"></div>
    <button type="submit" class="btn-primary">Gerar</button>
  </form>`);
  const typeSel = form.querySelector('[name=type]');
  const renderFields = () => {
    const tpl = templates.find((t) => t.type === typeSel.value);
    form.querySelector('#ia-fields').innerHTML = tpl.fields.map((f) =>
      field(f.label, 'f_' + f.name, f.type === 'textarea' ? { type: 'textarea', value: (o.prefill && o.prefill[f.name]) || '' } : { value: (o.prefill && o.prefill[f.name]) || '' })).join('');
  };
  typeSel.onchange = renderFields; renderFields();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const inputs = {};
    for (const k in fd) if (k.startsWith('f_')) inputs[k.slice(2)] = fd[k];
    const body = { type: fd.type, inputs };
    if (fd.client_id) body.client_id = fd.client_id;
    try {
      const r = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); if (onSave) onSave(); iaViewer(r.id, onSave);
    } catch (err) { toast(err.message, 'error'); }
  };
  openModal('Nova geração de IA', form);
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check public/app.js`
Expected: sem erro.

- [ ] **Step 3: Confirmar que o chamador existente continua funcionando sem `opts`**

Run: `grep -n "iaForm(load)" public/app.js`
Expected: a linha `$('#new-ia').onclick = () => iaForm(load);` (chamada antiga, sem segundo argumento) continua presente e sintaticamente válida — `opts` é `undefined`, `o = {}`, todo `o.campo` cai em falsy, comportamento idêntico ao de antes desta task.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: iaForm aceita valores iniciais (type/client_id/prefill)"
```

---

### Task 3: Botão "Gerar com IA" na tela de Conversas

**Files:**
- Modify: `public/whatsapp.js` (dentro de `renderContexto`)

**Interfaces:**
- Consumes: `iaForm(onSave, opts)` — assinatura generalizada pela Task 2. `POST /api/whatsapp-instance/chats/:phone/resumo` — rota já existente, devolve `{ resumo: string }`.

- [ ] **Step 1: Adicionar o botão e a lógica no bloco `renderContexto`**

Em `public/whatsapp.js`, dentro de `renderContexto` (a função async que monta a ficha do contato, já editada por planos anteriores — busque por `const renderContexto = async () => {`), localizar o bloco `if (cx.client) { ... }` (onde `html += bloco('Honorários', ...)` é a última linha desse bloco, por volta da linha 487 na versão atual). Adicionar, logo após esse bloco `if (cx.client) { ... }` mas ainda antes do `else if (cx.lead)`, um botão "Gerar com IA" — só quando há cliente vinculado (mesma exigência de `save-document`, que já recusa sem `client_id`):

Localizar o trecho:
```javascript
        if (cx.client) {
          html += bloco('Cliente', `<strong style="color:var(--navy-deep)">${esc(cx.client.name)}</strong>${cx.client.cpf_cnpj ? `<br><small style="color:var(--text-muted)">CPF: ${esc(cx.client.cpf_cnpj)}</small>` : ''}`);
          html += bloco('Processos', (cx.cases || []).length ? cx.cases.map((c) => `<div style="font-size:12.5px;margin-bottom:6px"><strong>${esc(c.title || '—')}</strong><br><small style="color:var(--text-muted)">${c.case_number ? 'nº ' + esc(c.case_number) + ' · ' : ''}${STG[c.production_stage] || c.production_stage || c.status || ''}</small></div>`).join('') : '<small style="color:var(--text-muted)">Nenhum processo</small>');
          html += bloco('Próxima audiência', cx.audiencia ? `<strong style="font-size:13px">${fmtDateTime(cx.audiencia.start_datetime)}</strong><br><small style="color:var(--text-muted)">${cx.audiencia.video_link ? 'ONLINE' : esc(cx.audiencia.location || 'presencial')}</small>` : '<small style="color:var(--text-muted)">Nenhuma marcada</small>');
          const f = cx.financeiro || {};
          html += bloco('Honorários', Number(f.pendentes)
            ? `<strong style="color:${Number(f.vencidas) ? 'var(--red)' : 'var(--navy-deep)'}">${money(f.valor_aberto)}</strong> <small style="color:var(--text-muted)">em aberto (${f.pendentes} parcela${f.pendentes > 1 ? 's' : ''}${Number(f.vencidas) ? ` · ${f.vencidas} vencida${f.vencidas > 1 ? 's' : ''}` : ''})</small>`
            : '<small style="color:var(--green)">✓ Nada em aberto</small>');
        } else if (cx.lead) {
```

Substituir por (adiciona o botão dentro do mesmo bloco `if`, logo após a linha de Honorários):
```javascript
        if (cx.client) {
          html += bloco('Cliente', `<strong style="color:var(--navy-deep)">${esc(cx.client.name)}</strong>${cx.client.cpf_cnpj ? `<br><small style="color:var(--text-muted)">CPF: ${esc(cx.client.cpf_cnpj)}</small>` : ''}`);
          html += bloco('Processos', (cx.cases || []).length ? cx.cases.map((c) => `<div style="font-size:12.5px;margin-bottom:6px"><strong>${esc(c.title || '—')}</strong><br><small style="color:var(--text-muted)">${c.case_number ? 'nº ' + esc(c.case_number) + ' · ' : ''}${STG[c.production_stage] || c.production_stage || c.status || ''}</small></div>`).join('') : '<small style="color:var(--text-muted)">Nenhum processo</small>');
          html += bloco('Próxima audiência', cx.audiencia ? `<strong style="font-size:13px">${fmtDateTime(cx.audiencia.start_datetime)}</strong><br><small style="color:var(--text-muted)">${cx.audiencia.video_link ? 'ONLINE' : esc(cx.audiencia.location || 'presencial')}</small>` : '<small style="color:var(--text-muted)">Nenhuma marcada</small>');
          const f = cx.financeiro || {};
          html += bloco('Honorários', Number(f.pendentes)
            ? `<strong style="color:${Number(f.vencidas) ? 'var(--red)' : 'var(--navy-deep)'}">${money(f.valor_aberto)}</strong> <small style="color:var(--text-muted)">em aberto (${f.pendentes} parcela${f.pendentes > 1 ? 's' : ''}${Number(f.vencidas) ? ` · ${f.vencidas} vencida${f.vencidas > 1 ? 's' : ''}` : ''})</small>`
            : '<small style="color:var(--green)">✓ Nada em aberto</small>');
          html += `<div style="padding:12px 14px"><button class="btn-sm" id="wa-gerar-ia" style="width:100%">${svgIcon('ia')}Gerar com IA a partir desta conversa</button></div>`;
        } else if (cx.lead) {
```

- [ ] **Step 2: Ligar o botão**

Ainda em `renderContexto`, localizar o bloco que liga o botão `#wa-resumo` (por volta da linha 631-642 na versão atual, `const rs = box.querySelector('#wa-resumo'); if (rs) rs.onclick = async () => { ... };`). Adicionar, logo após esse bloco (ainda dentro de `renderContexto`, antes do fechamento `};` da função), a ligação do novo botão:

```javascript
        const gerarIaBtn = box.querySelector('#wa-gerar-ia');
        if (gerarIaBtn) gerarIaBtn.onclick = async () => {
          gerarIaBtn.disabled = true; gerarIaBtn.textContent = 'Lendo a conversa…';
          try {
            const r = await api(`/api/whatsapp-instance/chats/${ativo.phone}/resumo`, { method: 'POST', body: '{}' });
            // Templates com campo de texto livre único (resumo_intimacao/texto,
            // parecer/consulta, resumo_cliente/movimentacao) recebem o resumo já
            // pronto da conversa — a usuária revisa/edita antes de gerar.
            iaForm(null, { client_id: cx.client.id, prefill: { texto: r.resumo, consulta: r.resumo, movimentacao: r.resumo } });
          } catch (e) { toast(e.message, 'error'); }
          gerarIaBtn.disabled = false; gerarIaBtn.innerHTML = `${svgIcon('ia')}Gerar com IA a partir desta conversa`;
        };
```

(nota para o implementador: `prefill` mapeia por nome de campo do template — como os 6 templates de `ai.ts` usam nomes de campo diferentes entre si para o texto livre principal, `{ texto: ..., consulta: ..., movimentacao: ... }` cobre os três templates cujo propósito faz sentido a partir de uma conversa de WhatsApp — `resumo_intimacao`, `parecer`, `resumo_cliente`. Os outros três templates do catálogo, `peticao_inicial`/`contestacao`/`email_cobranca`, têm campos mais específicos — `fatos`+`pedido`, `resumo_acao`+`teses`, `valor`+`vencimento` — sem um campo de texto livre único correspondente ao resumo bruto; ficam disponíveis no mesmo seletor de tipo, mas sem pré-preenchimento automático, o que é aceitável: a usuária ainda pode escolhê-los e preencher manualmente, igual ao fluxo atual de `iaForm`.)

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check public/whatsapp.js`
Expected: sem erro.

- [ ] **Step 4: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de antes desta task (Tasks 2 e 3 só tocam frontend, não deveriam adicionar/remover nenhum teste).

- [ ] **Step 5: Teste manual no navegador (best-effort)**

Se houver servidor local rodando neste ambiente: abrir uma conversa vinculada a um cliente, clicar em "Gerar com IA a partir desta conversa", confirmar que abre o formulário de `iaForm` com o cliente já selecionado e, ao trocar para um dos 3 tipos com prefill (Resumo de intimação/decisão, Parecer jurídico, Resumo da movimentação para o cliente), o campo de texto livre já vem preenchido com o resumo da conversa. Se não houver servidor local disponível, documentar como pendência no relatório.

- [ ] **Step 6: Commit**

```bash
git add public/whatsapp.js
git commit -m "feat: botão Gerar com IA na tela de Conversas, a partir do resumo"
```

---

## Self-Review

**1. Cobertura da spec:**
- Item 1 (classificação automática, best-effort, sem confirmação via WhatsApp, lista fixa de 5 valores) → Task 1 cobre integralmente: `classificarTipoDocumento` best-effort, integrada em `storeMedia` sem bloquear o INSERT, sem nenhum código de resposta/confirmação ao número do cliente. ✅
- Item 2 (botão na conversa, reaproveitando templates/endpoint/modal existentes, sem duplicar lógica) → Tasks 2+3 cobrem: `iaForm` generalizada (não duplicada), botão em `whatsapp.js` que só busca o resumo (rota já existente) e delega tudo mais pro formulário/modal já existentes. ✅
- Testes da spec (item 1: só 5 valores aceitos, falha não impede salvamento; item 2: usa endpoint existente, não quebra fluxo de Minutas) → Task 1 tem os 4 testes automatizados cobrindo isso no backend; item 2 é mudança de frontend puro (mesmo padrão dos planos de BI anteriores, sem testes automatizados de `app.js`/`whatsapp.js` no projeto) — coberto por verificação de sintaxe + teste manual best-effort, consistente com o padrão já estabelecido no repositório.
- Fora de escopo (fluxo de confirmação via WhatsApp, OCR estruturado, geração automática de valores financeiros de proposta) → nenhuma task implementa isso. ✅

**2. Placeholder scan:** nenhum "TBD"/"adicionar validação"/código incompleto — a nota ao implementador na Task 3 (sobre os 3 templates sem prefill correspondente) é uma explicação de design, não um placeholder de conteúdo pendente.

**3. Consistência de tipos:**
- `classificarTipoDocumento(media: MediaRow): Promise<string | null>` (Task 1, produtor) usa exatamente a mesma interface `MediaRow` já definida em `whatsappTranscricao.ts` (consumida por `descreverImagem`/`transcreverAudio`) — sem redefinir tipo novo.
- `iaForm(onSave, opts)` (Task 2, produtor) com `opts.prefill: Record<string,string>` é consumida pela Task 3 com `{ texto, consulta, movimentacao }` — três chaves que batem com os nomes de campo reais de `TEMPLATES` em `src/routes/ai.ts` (`resumo_intimacao.fields[0].name === 'texto'`, `parecer.fields[0].name === 'consulta'`, `resumo_cliente.fields[0].name === 'movimentacao'`), confirmados por leitura direta do arquivo antes de escrever este plano.
