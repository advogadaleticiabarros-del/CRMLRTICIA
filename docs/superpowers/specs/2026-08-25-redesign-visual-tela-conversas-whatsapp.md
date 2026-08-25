# Redesign Visual — Tela de Conversas (WhatsApp) — Spec

**Status:** Aprovada
**Escopo:** 100% visual/CSS/estrutura de layout. Zero funcionalidade nova, zero funcionalidade removida — todas as abas (Fila/Conversas/Contatos/Conexão), botões, lógica de polling e endpoints continuam exatamente como estão hoje.

## Problema

A usuária está "extremamente insatisfeita" com a usabilidade da tela de Conversas do WhatsApp — reportou lentidão/tremor percebido, excesso de botões sem hierarquia clara, e visual que não parece profissional mesmo tendo uma tela dedicada. Confirmado com 2 prints reais da tela em produção e leitura direta do código (`public/whatsapp.js`, `public/styles.css`).

## Achados confirmados (não hipóteses)

1. **Bug real de sobreposição**: no modo "Tela cheia" (`?foco=1`), o botão fixo "← Voltar ao CRM" (`public/app.js:8186-8189`, `position:fixed;top:8px;left:8px`) sobrepõe visualmente o `<h2>WhatsApp</h2>` porque `body.foco-total .content > .page` reduz o padding para `10px 16px` (`public/styles.css:158`), sem espaço reservado para o botão fixo.
2. **Cabeçalho alto e repetitivo**: bloco de página (`public/whatsapp.js:165-172`) com título+status em uma linha, botões de ação, e um bloco `.tabs` separado logo abaixo — soma bastante altura vertical antes de qualquer conteúdo útil aparecer.
3. **Os ícones do chat JÁ têm tooltip** (`title="..."`, confirmado em `public/whatsapp.js:677-703` — busca, fixar, arquivar, etiquetas, PDF, ficha do contato, mensagens prontas, anexar, gravar, enviar todos têm `title`) — o problema não é ausência de tooltip, é que o tooltip nativo do navegador é lento pra aparecer e pouco visível; a percepção de "não sei o que cada ícone faz" vem da falta de destaque visual, não de dado faltando.
4. **A piscada de lista já foi corrigida no código** (`public/whatsapp.js:404-407`, comentário confirma: comparação de HTML antes de re-renderizar, corrigindo um bug documentado anteriormente) — a sensação de "lento/treme" reportada agora é mais provavelmente sobre densidade visual e falta de transições suaves do que sobre re-render desnecessário.
5. **Ficha de contexto sem hierarquia**: dois botões de ação por IA existem hoje em pontos diferentes do bloco — `Gerar com IA a partir desta conversa` (`whatsapp.js:488`, só aparece com cliente vinculado) e `Resumir conversa com IA` (`whatsapp.js:505`, sempre aparece) — ambos usando a mesma classe `btn-sm` que os botões secundários (`+Tarefa`, `+Prazo`, `+Compromisso`, `+Anotação`, grid 2x2 em `whatsapp.js:498-504`), sem diferenciação visual de importância.

## Decisões (aprovadas via mockup visual — Artifact "Opção B — Espaçosa")

1. **Correção do bug de sobreposição**: aumentar o espaço reservado no topo do modo tela-cheia para o botão "Voltar ao CRM" nunca colidir com o título da página — em qualquer tela do sistema que use esse modo, não só WhatsApp (a correção é no CSS global `body.foco-total`, compartilhado).
2. **Cabeçalho compacto em 2 faixas finas**: mesma informação de hoje (voltar, título, status da instância, botões de ação, abas), reorganizada em duas barras horizontais mais baixas em vez do bloco alto atual. Nenhum dado novo, nenhum dado removido.
3. **Lista de conversas com mais respiro**: avatar maior (36px → 44px), padding do item maior, nome em fonte um pouco maior — mesma informação exibida (nome, prévia, tags, hora, contador de não lidas), só com mais espaço.
4. **Chat com bolhas maiores e cores alinhadas à paleta do sistema**: bolhas de mensagem com mais padding/fonte maior; cor de bolha enviada passa a usar a paleta dourada do sistema (`--gold-soft`) em vez do verde genérico de WhatsApp hardcoded hoje. Ícones de ação mantidos exatamente como estão funcionalmente (mesmos `title`, mesmo `onclick`), só com tratamento visual que os torna mais reconhecíveis (tamanho/contraste), sem adicionar nem remover nenhum ícone.
5. **Ficha de contexto com hierarquia clara**: os dois botões de ação por IA (`Gerar com IA a partir desta conversa`, `Resumir conversa com IA`) passam a usar destaque visual de ação primária (botão dourado cheio, maior) — sem mudar a lógica de quando cada um aparece. Os 4 botões secundários (`+Tarefa`, `+Prazo`, `+Compromisso`, `+Anotação`) continuam exatamente com a mesma lógica de habilitado/desabilitado (`disabled` quando não há processo/cliente), só com tratamento visual mais discreto/agrupado.

## Fora de escopo

- Qualquer mudança de funcionalidade: nenhuma aba, botão, endpoint ou lógica de polling é adicionado, removido ou alterado em comportamento.
- Reescrita da lógica de dados (`renderContexto`, `renderMsgs`, polling `atualizar`) — só o HTML/CSS gerado muda, a lógica de busca/condição permanece idêntica.
- Correção da faixa de largura 761-1099px onde a ficha de contexto fica inacessível (achado técnico anterior, registrado à parte — pode virar item futuro, mas não foi pedido nesta reforma e adicionaria escopo de responsividade não solicitado).
- Modo escuro (dark mode) — fora do pedido original, tratado como melhoria futura se necessário.

## Arquivos afetados

- `public/styles.css` — CSS global `body.foco-total` (correção do bug 1), e todas as classes `.wa-*` (topbar, lista, chat, ficha de contexto).
- `public/whatsapp.js` — templates HTML (template literals) das funções `shell`, dentro de `tabConversas` (lista, header do chat, `renderContexto`) — só a estrutura/classes HTML muda, nenhuma lógica de dados/API é tocada.
- `public/app.js:8180-8190` — bloco do modo "Tela cheia" (correção do bug 1, compartilhada com outras telas).

## Testes

Como é mudança 100% visual/CSS sem lógica nova, não há testes automatizados de backend a escrever. Validação é:
- Sintaxe válida (`node --check public/whatsapp.js`, `node --check public/app.js`).
- Suíte completa (`npx tsc && node --test`) sem regressão — confirma que nenhuma lógica de backend foi tocada.
- Checagem manual/visual (print ou navegador) comparando contra o mockup aprovado, cobrindo: modo normal e modo tela-cheia; conversa com cliente vinculado, com lead, e com número não cadastrado (os 3 estados de `renderContexto`); ao menos uma conversa com processo vinculado e uma sem (para conferir que `+Prazo` continua desabilitado corretamente).
