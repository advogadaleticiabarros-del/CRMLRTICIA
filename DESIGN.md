# DESIGN.md: design system 3.0 do CRM

> Fonte de verdade visual do CRM desde 17/11/2026. Toda tela nova ou alterada segue este arquivo.
> O CSS está no fim de `public/styles.css`, no bloco "DESIGN SYSTEM 3.0".
> O teste `tests/designSystem.test.mjs` trava as regras que dá para conferir automaticamente.
> A auditoria que originou este documento e a prévia aprovada pela Jessica estão em `docs/contexto/relatorios/2026-11-17-design-system-3.md`.

## Princípio

O CRM é ferramenta de trabalho de um escritório de advocacia. Ele deve parecer um produto feito por uma equipe de produto, com decisões visuais de propósito, e não um template.

- **Marca.** Azul-marinho, dourado e creme. O dourado é detalhe de marca, não cor de botão de ação.
- **Densidade.** Informação densa e legível, sem enfeite.
- **Movimento.** Só onde informa.

## Cores (as da marca, cada uma com função)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--navy` / `--btn-pri-bg` | `#2a3f5f` | `#e7dcc2` | botão principal, títulos |
| `--navy-deep` | `#1f3047` | `#f2ead7` | títulos e nomes |
| `--gold` | `#c19a4e` | `#c19a4e` | marca, item ativo do menu, foco, linha do topo dos indicadores |
| `--gold-text` | `#8a6a24` | `#d9b66a` | dourado usado como **texto** (5:1 e 9:1) |
| `--on-gold` | `#1f3047` | `#1f3047` | texto em cima de fundo dourado (5,09:1) |
| `--bg` | `#f6f4ef` | `#14110d` | fundo das telas |
| `--surface` | `#ffffff` | `#1d1914` | cartões, tabelas, menu |
| `--text` | `#221d16` | `#ece6da` | leitura |
| `--text-muted` | `#6b6352` | `#a39a88` | rótulos e datas (5,41:1 e 6,27:1) |
| `--green` / `--green-bg` | `#23704d` / `#e7f4ec` | `#7fc4a0` | pago, concluído |
| `--amber` / `--amber-bg` | `#8f6514` / `#fbf1dc` | `#e3b25e` | atenção |
| `--red` / `--red-bg` | `#a8372e` / `#fbe9e7` | `#e8857a` | urgente, excluir |

Regras:

- **Contraste.** Todo texto passa no mínimo de 4,5:1, nos temas claro e escuro. A Jessica escolheu manter as cores da marca e escurecer só o tom do texto quando precisa ("opção B").
- **Fundo fixo.** Nunca use `#fff` fixo como fundo de componente; use `var(--surface)`. O fundo fixo foi a causa dos nomes ilegíveis no modo escuro.
- **Cores novas.** Não crie cores novas; use os tokens.

## Tipografia

| Papel | Fonte | Tamanho · peso |
|---|---|---|
| Título da tela | Inter | 22–26px · 650 |
| Seção | Inter | 16px · 600 |
| Texto | Inter | 14px · 400 |
| Apoio | Inter | 12,5px · 400 |
| Número de destaque | Inter, algarismos tabulares | 22–26px · 650 |
| Nome do escritório (marca) | Spectral | só no menu e na entrada |

- **Tamanho mínimo.** Nenhum texto abaixo de **12px**.
- **Maiúsculas.** Sem `text-transform: uppercase` em rótulos.
- **Fontes da tela principal.** A tela principal carrega só Inter e Spectral. Documentos impressos (papel timbrado) podem usar outras fontes.

## Forma e espaço

- **Raios.** 8px em botões e campos, 12px em cartões e janelas, 6px em etiquetas.
- **Espaçamento.** Múltiplos de 4px (4, 8, 12, 16, 20, 24, 32).
- **Sombras.** Leve (`--shadow-sm`) em cartão. Forte (`--shadow-lg`) só em janela e aviso. No modo escuro não há sombra.
- **Proibido.**
  - degradê decorativo;
  - faixa lateral colorida em cartão ou item de lista;
  - texto em degradê;
  - cartão dentro de cartão;
  - brilho em botão.

## Componentes

- **Botões.** São quatro tipos:
  - `.btn-primary` (azul-marinho): **uma** ação principal por tela ou grupo;
  - `.btn-sm` / `.btn-ghost`: secundários;
  - `.btn-gold`: só onde a marca pede, com texto `--on-gold`;
  - `.btn-perigo`: excluir.
- **Indicadores.** `.kpi-grid` é **uma faixa só**, com linhas finas entre as células e uma linha dourada sólida no topo. Cada número deve dizer o que fazer quando der.
- **Etiquetas.** `.badge`, `.chip-area` e `.chip-mov` têm raio de 6px, fundo claro e texto escuro da mesma cor.
- **Tabelas.** Busca que diz o que dá para digitar, filtros visíveis, ordenação marcada, paginação com total e largura total. No celular viram cartões.
- **Ícones.** Use `svgIcon(nome)`: traço Lucide, 18px. **Nenhum emoji em interface.** As exceções são as reações do WhatsApp e as marcas internas de mensagem ("📝 Transcrição:", "🚫 Mensagem apagada"), que o sistema usa para reconhecer o conteúdo.
- **Confirmação.** Use `await confirmar({ titulo, texto, acao, perigo })`, nunca `confirm()` do navegador. O texto diz exatamente o que acontece.
- **Estados.** Toda lista tem carregando, vazio (com orientação e próximo passo) e erro (o que houve e como resolver).
- **Campos.** Todo campo tem nome acessível. `rotularCampos()` dá `aria-label` a filtros soltos a partir do placeholder, do title ou da 1ª opção. Todo botão só de ícone tem `aria-label`.

## Movimento

- **Clique.** Os botões ganham `scale(.97)` em `:active`, por 120ms.
- **Janelas.** Abrem do centro, de 96% a 100%, em 200ms, com curva `cubic-bezier(.23,1,.32,1)`.
- **Avisos.** Entram por baixo.
- **Proibido.**
  - animação de entrada em troca de tela;
  - hover que levanta o elemento;
  - `transition: all`;
  - movimento infinito.
- **Movimento reduzido.** Quem pede `prefers-reduced-motion` recebe só o esmaecer.

## Celular e tablet (até 880px)

- **Toque.** Tudo o que se toca tem **44px** no mínimo.
- **Largura.** Nada passa da largura da tela. Quadros largos (Produção, Dativo) rolam dentro do próprio trilho.
- **Menu.** A gaveta só tem sombra quando está aberta.

## Pendências conhecidas (fora do 3.0)

- **Escritório virtual (`public/escritorio.js`).** Ainda tem emojis decorativos e etiquetas em 12 cores, e está fora do teste de emoji. Outra sessão estava mexendo nesse arquivo em 17/11; a revisão fica para quando ela terminar.
- **Agenda.** A visão semanal como padrão, com só 3 tipos de evento, ficou como próxima etapa.
- **Financeiro.** As 10 abas ficaram numa linha que rola, mas não foram reagrupadas.
