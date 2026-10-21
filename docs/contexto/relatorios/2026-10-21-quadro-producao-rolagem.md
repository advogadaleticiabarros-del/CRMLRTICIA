# 21/10/2026 — Peças em produção: rolagem do quadro

## Pedido
A Jessica relatou: "a rolagem da tela de produção não está funcionando" e "preciso passar o card para a coluna ao lado sem precisar descer até o último card".

## Feito
- **Causa raiz:** `main.content` (item flex de `.app-view`) não tinha `min-width: 0` e esticava até a largura do quadro (cerca de 2.300 px), e o `body` cortava o excesso. O quadro achava que cabia tudo e nunca rolava para o lado. Ver o runbook, incidente de 21/10.
- **Correções:**
  - `public/styles.css`: `.content { min-width: 0; }` e a classe `.kanban-wrap.altura-tela`, em que o quadro ocupa a altura da tela e cada coluna rola por dentro;
  - `public/app.js`, `wireKanbanNav(id, { alturaTela })`:
    - a roda do mouse sobre uma coluna que rola desce os cards;
    - arrastar até a borda rola o quadro;
    - a altura é recalculada quando os indicadores ou o aviso de procuração mudam;
  - a produção usa `alturaTela`. Fases e Leads ganham só a correção da largura e a regra nova da roda.
- **Teste novo:** `e2e/essencial.spec.mjs`, "Peças em produção: quadro na tela…".
- **Manual:** `docs/manual/14-runbook.md` e `06-documentos.md` (com espelho no Obsidian); ESTADO.md.

## Verificado
- **Laço no navegador (Edge, servidor de teste com 52 cards fictícios)** com quatro medições:
  - a base do quadro dentro da tela;
  - a roda desce a coluna;
  - a roda não desliza o quadro;
  - o arraste na borda rola o quadro.

  Antes da correção: **vermelho**. Depois: **verde**.
- **Doze telas em 1366, 1920 e 390 px:** a página cabe na janela e não há erro de JavaScript. As telas foram Dashboard, Hoje, Produção, Fases, Leads, Clientes, Processos, Financeiro, Agenda, Escritório, Leis e Documentos.
- **Testes de tela:** os testes de `public` passaram, e o JavaScript do `app.js` é válido. Lint sem erros.
- **CI e deploy:** commits `304771d` a `e4e794d` testados num branch. O teste novo de ponta a ponta precisou de 3 ajustes (altura mínima e dois alvos do próprio teste), até ficar verde. Depois, na `main`, o deploy deu certo, e a produção já serve o `styles.css` e o `app.js` novos (conferido por download).
- **Não verificado:** a tela em produção logada com os cards reais da Dra.

## Decisões e porquês
- **`min-width: 0` vale para todo o CRM:** é a correção de origem (qualquer tela larga esticava a página). Conferido em 12 telas.
- **Altura da tela só na Produção:** Fases e Leads continuam como estavam, porque o relato foi sobre a Produção. No celular nada muda.
- **Roda do mouse:** sobre uma coluna que rola, desce os cards; fora dela (títulos, área vazia), anda para o lado, como antes.
- **O teste novo no CI pegou duas coisas que o teste local não pegou:**
  - o que fica acima do quadro muda de tamanho depois que a tela abre. Agora um `ResizeObserver` nos elementos acima e `document.fonts.ready` recalculam a altura;
  - a altura mínima de 420 px empurrava a barra lateral para fora da tela em notebook de 768 px com o aviso de procuração aberto. Caiu para 280 px.

## Pendente
- A Dra. confirmar no uso real, depois do deploy. Pode ser preciso atualizar a página (Ctrl+F5).
- Se ela quiser o mesmo comportamento em "Fases dos processos": é só usar `wireKanbanNav('fases-board', { alturaTela: true })`.

## Próxima sessão
Se ela relatar outro problema de rolagem, rode o teste de ponta a ponta "Peças em produção" e meça `main.content.clientWidth` (ver runbook). Skill: `diagnosing-bugs`.
