# Redesign Visual — Tela de Conversas (WhatsApp) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign 100% visual/CSS da tela de Conversas do WhatsApp — corrigir o bug de sobreposição no modo tela-cheia, compactar o cabeçalho, dar mais respiro à lista e ao chat, e dar hierarquia visual clara aos botões de IA na ficha de contexto. Zero mudança de funcionalidade.

**Architecture:** Cada task edita só `public/styles.css` (valores de CSS existentes) e, quando necessário, os `class=`/estrutura HTML dos template literals em `public/whatsapp.js` — nunca a lógica de dados/API dentro deles. Nenhum arquivo novo, nenhuma função nova.

**Tech Stack:** CSS puro + vanilla JS (template literals), sem build step, sem framework.

## Global Constraints

- Zero funcionalidade nova ou removida — todas as abas, botões, endpoints, lógica de polling continuam exatamente como estão (spec, seção Escopo).
- Nenhuma lógica de dados é tocada — só `class=`, `style=` e valores CSS mudam (spec, Arquivos afetados).
- Correção do bug de sobreposição (Task 1) deve valer para qualquer tela que use o modo `foco-total`, não só WhatsApp — é CSS global compartilhado (spec, decisão 1).
- Sem testes automatizados de frontend neste projeto — validação de cada task é `node --check` nos arquivos JS tocados + checklist de verificação visual manual contra o mockup aprovado (spec, seção Testes). Não criar testes automatizados novos.
- Fora de escopo: responsividade 761-1099px, dark mode, qualquer mudança de lógica (spec, Fora de escopo).

**Correções feitas durante a escrita deste plano** (confirmadas lendo o CSS real antes de escrever os passos — os valores abaixo substituem estimativas anteriores da sessão que estavam desatualizadas):
- `.wa-ava` já é `46px` (não 36px) — já é relativamente grande; o ajuste de "avatar maior" da spec é mais sutil do que inicialmente estimado.
- `.wa-bub` já tem `border-radius: 9px` e uma animação de entrada (`wa-bub-in`) — não são "bordas retas" como a spec caracterizou a partir dos prints; o achado real é que a cor da bolha enviada (`#d9fdd3`, verde WhatsApp genérico) não usa a paleta do sistema, que é o ponto que a Task 4 realmente corrige.
- `.btn-icon` já tem `border-radius: 50%`, hover e active states — os ícones já têm tratamento visual; o ganho real de hierarquia está nos botões de texto da ficha de contexto (Task 5), não nos ícones do chat.
- Existe uma duplicata de `.btn-icon` em `styles.css:64-65` (versão antiga, mais simples) e `styles.css:1522-1530` (versão atual, completa, com hover/active/gravando). A segunda declaração (mais específica em ordem de cascata) já vence — não é uma tarefa deste plano corrigir a duplicata (fora de escopo: não é bug visual visível, é só código morto/redundante que não afeta o resultado).

---

### Task 1: Corrigir sobreposição no modo Tela Cheia

**Files:**
- Modify: `public/styles.css:154-160` (bloco `body.foco-total`)

**Interfaces:**
- Produces: nenhuma interface nova — só ajusta valores de padding/posicionamento CSS já existentes, sem criar classe nova.

- [ ] **Step 1: Editar o CSS do modo tela-cheia**

Ler o bloco atual (`public/styles.css:154-160`):
```css
/* ── Modo "tela cheia" (aba separada, sem menu/topo) ── */
body.foco-total .sidebar,
body.foco-total .topbar { display: none; }
body.foco-total .content { margin-left: 0; padding: 0; }
body.foco-total .content > .page { padding: 10px 16px; max-width: none; }
.foco-voltar { position: fixed; top: 8px; left: 8px; z-index: 500; background: var(--navy); color: #fff; padding: 4px 12px; border-radius: 6px; font-size: 12px; text-decoration: none; opacity: .78; transition: opacity .15s; }
.foco-voltar:hover { opacity: 1; }
```

Substituir por (aumenta o padding-top do `.page` para abrir espaço reservado ao botão fixo, que tem ~26px de altura real com seu padding):
```css
/* ── Modo "tela cheia" (aba separada, sem menu/topo) ── */
body.foco-total .sidebar,
body.foco-total .topbar { display: none; }
body.foco-total .content { margin-left: 0; padding: 0; }
/* padding-top maior que os outros lados: reserva espaço pro botão fixo
   .foco-voltar (que fica em top:8px, ~26px de altura) não sobrepor o
   título da página logo abaixo — bug real reportado pela usuária. */
body.foco-total .content > .page { padding: 46px 16px 10px; max-width: none; }
.foco-voltar { position: fixed; top: 8px; left: 8px; z-index: 500; background: var(--navy); color: #fff; padding: 4px 12px; border-radius: 6px; font-size: 12px; text-decoration: none; opacity: .78; transition: opacity .15s; }
.foco-voltar:hover { opacity: 1; }
```

- [ ] **Step 2: Verificar sintaxe do CSS**

Run: `node -e "require('fs').readFileSync('public/styles.css','utf8')" && echo "arquivo lido sem erro"`
Expected: sem erro (CSS não tem verificador de sintaxe formal no projeto; isso só confirma que o arquivo não tem problema de encoding/leitura).

- [ ] **Step 3: Checklist de verificação visual manual**

Se houver servidor local disponível: abrir `?foco=1#whatsapp` (ou qualquer rota com o botão "⛶ Tela cheia", visível em `public/whatsapp.js:166` quando `!document.body.classList.contains('foco-total')`) e confirmar visualmente que "← Voltar ao CRM" não encosta nem sobrepõe o título "WhatsApp" abaixo dele. Se não houver servidor local, documentar como pendência no relatório (best-effort, mesmo padrão já usado em tasks anteriores desta sessão).

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "fix: corrige sobreposição do botão Voltar com o título no modo tela-cheia"
```

---

### Task 2: Cabeçalho compacto em 2 faixas finas

**Files:**
- Modify: `public/styles.css:181-183` (`.page-header`), `public/styles.css:225-226` (`.tabs`/`.tab`)

**Interfaces:**
- Consumes: nenhuma (task independente da Task 1).
- Produces: nenhuma interface nova — só reduz `margin-bottom`/`padding` das classes já usadas pelo template HTML existente em `public/whatsapp.js:165-172` (esse template NÃO muda nesta task — só o CSS que o estiliza).

- [ ] **Step 1: Reduzir o espaçamento vertical do cabeçalho**

Ler o CSS atual (`public/styles.css:181-183`):
```css
/* ── Page header ── */
.page-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 26px; gap: 16px; flex-wrap: wrap; }
.page-header h2 { font-size: 30px; }
.page-header .sub { color: var(--text-muted); font-size: 14px; margin-top: 2px; }
```

Substituir por (reduz o espaço abaixo do cabeçalho e o tamanho do título — o `.page-header` é usado em outras telas do sistema além do WhatsApp, então a mudança precisa ser proporcional, não drástica, para não descompensar outras páginas):
```css
/* ── Page header ── */
.page-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; gap: 16px; flex-wrap: wrap; }
.page-header h2 { font-size: 26px; }
.page-header .sub { color: var(--text-muted); font-size: 13.5px; margin-top: 2px; }
```

Ler o CSS atual (`public/styles.css:225-226`):
```css
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 24px; flex-wrap: wrap; }
.tab { background: none; border: none; padding: 11px 18px; font-size: 14px; font-weight: 500; color: var(--text-soft); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: inherit; }
```

Substituir por (reduz o padding vertical do tab e o espaço abaixo do bloco de abas):
```css
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; flex-wrap: wrap; }
.tab { background: none; border: none; padding: 9px 18px; font-size: 14px; font-weight: 500; color: var(--text-soft); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: inherit; }
```

(nota: `public/whatsapp.js:167` já define `<div class="tabs" style="margin-bottom:14px">` com margin-bottom inline sobrescrevendo o CSS — isso continua funcionando normalmente após a mudança, pois `style=` inline sempre vence sobre a classe; não precisa editar esse `style=` inline nesta task, o resultado final já fica compacto o suficiente com a combinação dos dois ajustes.)

- [ ] **Step 2: Verificar sintaxe do CSS**

Run: `node -e "require('fs').readFileSync('public/styles.css','utf8')" && echo "arquivo lido sem erro"`
Expected: sem erro.

- [ ] **Step 3: Checklist de verificação visual manual**

Se houver servidor local: abrir a tela de WhatsApp normal (sem `?foco=1`) e comparar a altura do cabeçalho (título + status + botões + abas) com o mockup aprovado — deve ocupar visivelmente menos altura vertical que antes, sem cortar nenhum texto. Confirmar também que outras telas do sistema que usam `.page-header`/`.tabs` (ex.: Financeiro, Clientes) não ficaram com espaçamento quebrado/apertado demais — essas classes são compartilhadas. Se não houver servidor local, documentar como pendência.

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "feat: compacta o cabeçalho de página (título/abas) em todo o sistema"
```

---

### Task 3: Mais respiro na lista de conversas

**Files:**
- Modify: `public/styles.css:1460` (`.wa-item`), `public/styles.css:1467` (`.wa-ava`), `public/styles.css:1469-1470` (`.wa-item-name`/`.wa-item-prev`)

**Interfaces:**
- Consumes: nenhuma (independente das Tasks 1-2).
- Produces: nenhuma interface nova — o HTML de `public/whatsapp.js:387-399` (item de lista) não muda nesta task, só os valores CSS que o estilizam.

- [ ] **Step 1: Aumentar padding do item e tamanho de fonte**

Ler o CSS atual (`public/styles.css:1460`):
```css
.wa-item { display: flex; gap: 12px; padding: 13px 12px; margin-bottom: 5px; border-radius: 9px; border-left: 4px solid #e2ddd1; cursor: pointer; align-items: flex-start; transition: background 120ms ease, box-shadow 150ms ease; }
```

Substituir por (mais padding horizontal e vertical, mais espaço entre itens):
```css
.wa-item { display: flex; gap: 14px; padding: 15px 14px; margin-bottom: 7px; border-radius: 10px; border-left: 4px solid #e2ddd1; cursor: pointer; align-items: flex-start; transition: background 120ms ease, box-shadow 150ms ease; }
```

Ler o CSS atual (`public/styles.css:1467`):
```css
.wa-ava { width: 46px; height: 46px; border-radius: 50%; flex: 0 0 46px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 15px; }
```

Substituir por (avatar um pouco maior, mesma lógica de cor/iniciais já existente em `whatsapp.js`):
```css
.wa-ava { width: 50px; height: 50px; border-radius: 50%; flex: 0 0 50px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 16px; }
```

Ler o CSS atual (`public/styles.css:1469-1470`):
```css
.wa-item-name { font-weight: 600; font-size: 14.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wa-item-prev { font-size: 12.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
```

Substituir por (nome um pouco maior, prévia com mais respiro):
```css
.wa-item-name { font-weight: 600; font-size: 15px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wa-item-prev { font-size: 13px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
```

- [ ] **Step 2: Verificar sintaxe do CSS**

Run: `node -e "require('fs').readFileSync('public/styles.css','utf8')" && echo "arquivo lido sem erro"`
Expected: sem erro.

- [ ] **Step 3: Checklist de verificação visual manual**

Se houver servidor local: abrir a lista de conversas e confirmar que os itens têm mais respiro (mais espaço entre um contato e outro), o avatar está visivelmente maior, e o nome/prévia continuam legíveis sem quebrar em duas linhas nem cortar de forma estranha. Confirmar que o contador de não lidas (`.wa-unread`) e as etiquetas (`.wa-tag`) continuam alinhados corretamente ao lado do texto maior. Se não houver servidor local, documentar como pendência.

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "feat: mais respiro visual na lista de conversas (avatar, padding, fonte)"
```

---

### Task 4: Chat com bolhas maiores e cor alinhada à paleta do sistema

**Files:**
- Modify: `public/styles.css:1490` (`.wa-msgs`), `public/styles.css:1492` (`.wa-bub`), `public/styles.css:1496` (`.wa-bub.out`)

**Interfaces:**
- Consumes: nenhuma (independente das Tasks 1-3).
- Produces: nenhuma interface nova — o HTML das mensagens (`renderMsgs`, função já existente em `public/whatsapp.js`) não muda nesta task, só o CSS que estiliza `.wa-bub`.

- [ ] **Step 1: Aumentar padding/fonte das mensagens e trocar a cor da bolha enviada**

Ler o CSS atual (`public/styles.css:1490`):
```css
.wa-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 8%; display: flex; flex-direction: column; gap: 4px; background: var(--surface); background-image: radial-gradient(var(--border-soft) .8px, transparent .8px); background-size: 22px 22px; }
```

Substituir por (mais espaço entre mensagens):
```css
.wa-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 22px 8%; display: flex; flex-direction: column; gap: 7px; background: var(--surface); background-image: radial-gradient(var(--border-soft) .8px, transparent .8px); background-size: 22px 22px; }
```

Ler o CSS atual (`public/styles.css:1492`):
```css
.wa-bub { position: relative; max-width: 68%; padding: 7px 11px 5px; border-radius: 9px; font-size: 13.5px; line-height: 1.45; box-shadow: 0 1px 1px rgba(0,0,0,.08); word-wrap: break-word; animation: wa-bub-in 180ms cubic-bezier(0.23, 1, 0.32, 1); }
```

Substituir por (mais padding interno, fonte um pouco maior):
```css
.wa-bub { position: relative; max-width: 66%; padding: 10px 14px 7px; border-radius: 11px; font-size: 14px; line-height: 1.5; box-shadow: 0 1px 1px rgba(0,0,0,.08); word-wrap: break-word; animation: wa-bub-in 180ms cubic-bezier(0.23, 1, 0.32, 1); }
```

Ler o CSS atual (`public/styles.css:1496`):
```css
.wa-bub.out { align-self: flex-end; background: #d9fdd3; color: #111b21; border-top-right-radius: 2px; }
```

Substituir por (troca o verde genérico do WhatsApp pela paleta dourada do sistema, mantendo contraste de texto legível):
```css
.wa-bub.out { align-self: flex-end; background: var(--gold-soft, #efe3c8); color: var(--navy-deep, #16233a); border-top-right-radius: 2px; }
```

- [ ] **Step 2: Verificar sintaxe do CSS**

Run: `node -e "require('fs').readFileSync('public/styles.css','utf8')" && echo "arquivo lido sem erro"`
Expected: sem erro.

- [ ] **Step 3: Checklist de verificação visual manual**

Se houver servidor local: abrir uma conversa com mensagens enviadas e recebidas, confirmar que as bolhas de mensagem enviada agora usam a cor dourada clara do sistema (não mais verde), o texto continua legível (contraste bom), e o espaçamento entre mensagens está mais folgado sem parecer "solto demais". Confirmar que a marcação de mensagem citada/resposta (`.wa-quote`, que usa `border-left: 3px solid var(--gold...)`) continua com bom contraste visual contra a nova cor de fundo da bolha. Se não houver servidor local, documentar como pendência.

- [ ] **Step 4: Commit**

```bash
git add public/styles.css
git commit -m "feat: bolhas de mensagem maiores, cor dourada do sistema em vez de verde WhatsApp"
```

---

### Task 5: Hierarquia visual na ficha de contexto

**Files:**
- Modify: `public/whatsapp.js:488` (botão "Gerar com IA"), `public/whatsapp.js:498-505` (bloco "Converter conversa em…" + botão "Resumir conversa com IA")
- Modify: `public/styles.css` (adicionar classe nova `.wa-ctx-primary` — única classe nova deste plano inteiro, necessária porque hoje não existe nenhuma classe de "botão de ação primária dourado grande" reaproveitável para este contexto específico da ficha lateral)

**Interfaces:**
- Consumes: nenhuma (independente das Tasks 1-4).
- Produces: classe CSS `.wa-ctx-primary`, usada pelos dois botões de IA da ficha de contexto — não é consumida por nenhuma outra task deste plano, é uso interno desta task.

- [ ] **Step 1: Adicionar a classe `.wa-ctx-primary` ao CSS**

Adicionar ao final do bloco `.wa-ctx` existente em `public/styles.css` (logo após a linha 1542, `.wa-shell.ctx-open .wa-ctx { display: block; }`, antes da media query de 1543):

```css
/* Ação primária da ficha de contato (ex.: "Resumir com IA", "Gerar com IA")
   — visualmente maior e mais chamativa que os botões secundários
   (Tarefa/Prazo/Compromisso/Anotação), que continuam usando .btn-sm. */
.wa-ctx-primary { width: 100%; background: var(--gold); color: #fff; border: none; border-radius: 9px; padding: 11px 14px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; transition: background .15s, transform .1s; }
.wa-ctx-primary:hover { background: var(--gold-deep, #a67a34); }
.wa-ctx-primary:active { transform: scale(.98); }
```

- [ ] **Step 2: Confirmar que `--gold-deep` existe ou usar fallback seguro**

Run: `grep -n "\-\-gold-deep" public/styles.css`
Expected: se não houver nenhuma ocorrência, o fallback `#a67a34` já declarado no Step 1 (`var(--gold-deep, #a67a34)`) garante que a cor funciona mesmo sem a variável existir — não é necessário criar a variável `--gold-deep` para este plano funcionar; só confirme que o fallback está presente exatamente como no Step 1.

- [ ] **Step 3: Trocar a classe dos dois botões de IA em `renderContexto`**

Ler o trecho atual (`public/whatsapp.js:488`, dentro do bloco `if (cx.client) { ... }`):
```javascript
          html += `<div style="padding:12px 14px"><button class="btn-sm" id="wa-gerar-ia" style="width:100%">${svgIcon('ia')}Gerar com IA a partir desta conversa</button></div>`;
```

Substituir por (troca `btn-sm` por `wa-ctx-primary`, remove o `style="width:100%"` inline já que a nova classe já define `width:100%`):
```javascript
          html += `<div style="padding:12px 14px"><button class="wa-ctx-primary" id="wa-gerar-ia">${svgIcon('ia')}Gerar com IA a partir desta conversa</button></div>`;
```

Ler o trecho atual (`public/whatsapp.js:498-505`):
```javascript
        html += bloco('Converter conversa em…', `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <button class="btn-sm" data-conv="tarefa">+ Tarefa</button>
            <button class="btn-sm" data-conv="prazo" ${(cx.cases || []).length ? '' : 'disabled title="Precisa de um processo"'}>+ Prazo</button>
            <button class="btn-sm" data-conv="compromisso">+ Compromisso</button>
            <button class="btn-sm" data-conv="anotacao" ${cx.client ? '' : 'disabled title="Precisa ser cliente"'}>+ Anotação</button>
          </div>`);
        html += `<div style="padding:12px 14px"><button class="btn-sm" id="wa-resumo" style="width:100%">${svgIcon('ia')}Resumir conversa com IA</button></div>`;
```

Substituir por (mantém `btn-sm` nos 4 botões secundários — sem mudar nenhuma condição de `disabled`/`title` — e só troca a classe do botão "Resumir conversa com IA", igual ao de "Gerar com IA" acima):
```javascript
        html += bloco('Converter conversa em…', `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <button class="btn-sm" data-conv="tarefa">+ Tarefa</button>
            <button class="btn-sm" data-conv="prazo" ${(cx.cases || []).length ? '' : 'disabled title="Precisa de um processo"'}>+ Prazo</button>
            <button class="btn-sm" data-conv="compromisso">+ Compromisso</button>
            <button class="btn-sm" data-conv="anotacao" ${cx.client ? '' : 'disabled title="Precisa ser cliente"'}>+ Anotação</button>
          </div>`);
        html += `<div style="padding:12px 14px"><button class="wa-ctx-primary" id="wa-resumo">${svgIcon('ia')}Resumir conversa com IA</button></div>`;
```

(nota: os seletores de evento que ligam esses botões, ex. `box.querySelector('#wa-resumo').onclick = ...`, usam `id`, não `class` — trocar a classe não quebra nenhum listener existente. Confirme isso lendo o restante de `renderContexto` antes de editar, mas não é esperado nenhum ponto do código que dependa de `class="btn-sm"` especificamente nesses dois botões.)

- [ ] **Step 4: Verificar sintaxe do JS e do CSS**

Run: `node --check public/whatsapp.js`
Expected: sem erro.

Run: `node -e "require('fs').readFileSync('public/styles.css','utf8')" && echo "arquivo lido sem erro"`
Expected: sem erro.

- [ ] **Step 5: Rodar a suíte completa e confirmar zero regressão**

Run: `npx tsc && node --test`
Expected: mesma contagem de pass/fail/skip de antes deste plano — esta task só toca `whatsapp.js`/`styles.css`, não deveria adicionar/remover nenhum teste nem afetar nenhum teste de backend existente.

- [ ] **Step 6: Checklist de verificação visual manual**

Se houver servidor local: abrir a ficha de contato de uma conversa com cliente vinculado, confirmar que "Gerar com IA a partir desta conversa" e "Resumir conversa com IA" aparecem como botões dourados cheios, visivelmente maiores/mais chamativos que os 4 botões secundários (Tarefa/Prazo/Compromisso/Anotação), que continuam pequenos e agrupados em grade 2x2. Confirmar que clicar em cada um continua funcionando exatamente como antes (abre o modal de geração de IA / o modal de resumo). Testar também com uma conversa sem processo vinculado (confirmar que "+ Prazo" continua desabilitado com o tooltip "Precisa de um processo") e uma conversa que não é cliente (confirmar que "Gerar com IA a partir desta conversa" não aparece, e "+ Anotação" fica desabilitado). Se não houver servidor local, documentar como pendência.

- [ ] **Step 7: Commit**

```bash
git add public/whatsapp.js public/styles.css
git commit -m "feat: hierarquia visual nos botões de IA da ficha de contato (ação primária dourada)"
```

---

## Self-Review

**1. Cobertura da spec:**
- Achado/decisão 1 (bug de sobreposição no modo tela-cheia) → Task 1, aplicado ao CSS global `body.foco-total`, válido para qualquer tela que use o modo, não só WhatsApp. ✅
- Achado/decisão 2 (cabeçalho alto, reorganizar em 2 faixas finas) → Task 2, reduz `.page-header`/`.tabs`, compartilhado com o resto do sistema (nota explícita no plano sobre não descompensar outras telas). ✅
- Achado 3 (ícones já têm tooltip, não é bug a corrigir) → nenhuma task "adiciona tooltip", corretamente não implementado como se fosse um requisito — o plano reconhece que isso já existe. ✅
- Achado 4 (piscada já corrigida antes) → nenhuma task mexe em `atualizar`/polling/lógica de re-render — só CSS. ✅
- Decisão 3 (lista com mais respiro) → Task 3, avatar/padding/fonte maiores, sem tocar o HTML do item. ✅
- Decisão 4 (chat com bolhas maiores, cor alinhada à paleta) → Task 4, `.wa-bub`/`.wa-msgs` maiores, `.wa-bub.out` trocado de verde pra dourado do sistema. ✅
- Decisão 5 (hierarquia na ficha de contexto) → Task 5, classe nova `.wa-ctx-primary` só para os 2 botões de IA, 4 botões secundários mantidos como estão. ✅
- Fora de escopo (responsividade 761-1099px, dark mode, lógica de dados) → nenhuma task toca nisso; a Task 4 nota explicitamente que `.wa-quote` (que já tem cor ligada a `var(--gold...)`) precisa ser conferida visualmente contra o novo fundo da bolha, mas isso é verificação, não uma mudança de escopo nova.

**2. Placeholder scan:** nenhum "TBD"/"adicionar depois"/código incompleto — todo trecho de CSS/JS mostrado é o valor final exato a ser escrito, não uma descrição do que fazer.

**3. Consistência de tipos:** não aplicável (mudança pura de CSS/HTML, sem funções/interfaces TypeScript novas) — a única "interface" do plano é a classe CSS `.wa-ctx-primary`, criada na Task 5 e usada só dentro da própria Task 5 (nos 2 mesmos botões), sem dependência cruzada entre tasks.
