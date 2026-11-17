# 17/11/2026: Design system 3.0 (revisão visual de todo o CRM)

## Pedido

A Jessica pediu para tirar a "cara de sistema feito por IA". A sequência foi esta:

1. Prévia antes e depois, publicada como artefato privado (https://claude.ai/artifact/BEjU6MefkxjRgC1ebjF7Lu). Ela pediu para incluir as diretrizes de SaaS profissional que colou, mantendo as cores.
2. Auditoria do sistema real.
3. "APLIQUE TUDO". As respostas dela às três decisões:
   - contraste: "vamos manter, contanto que não atrapalhe; ajuste o que precisa";
   - corrigir os defeitos já: sim;
   - aprovar todos os blocos: sim.

## Feito

- **`DESIGN.md` na raiz.** É a fonte de verdade visual. A diretriz permanente foi para o `CLAUDE.md`, seção "Design e interface".
- **Camada "DESIGN SYSTEM 3.0" no fim de `public/styles.css`.**
  - Tokens com contraste: `--text-muted #6b6352`, `--gold-text`, `--on-gold`, verde, âmbar e vermelho de texto escurecidos, e versões para o tema escuro.
  - Botões: primário azul-marinho, `scale(.97)` no clique e transições nomeadas.
  - Indicadores em faixa única e cartões com raio de 12px.
  - Tela Hoje em grupos e topo com busca global.
  - Confirmação própria.
  - Tela de entrada sem animação nem degradê.
  - Celular: alvo de 44px, WhatsApp compacto e Mesa compacta.
  - Lista do WhatsApp sem cabeçalho azul, sem faixa lateral e com avatares num tom só.
- **Ajustes automáticos no CSS antigo.**
  - 68 letras pequenas passaram para 12px.
  - 16 `transition: all` foram trocados por propriedades nomeadas.
  - 10 hovers que levantavam o elemento foram retirados.
  - 21 `text-transform: uppercase` foram removidos.
  - 106 raios foram normalizados (8, 12 e 6px).
  - 18 botões dourados ganharam texto azul-marinho.
  - 41 usos de dourado como texto passaram a `--gold-text`.
  - Os degradês da barra lateral viraram cor sólida.
  - A regra que prendia os cartões a 85% ou 90% da largura foi removida.
- **JS.**
  - `confirmar()` substituiu os 4 `confirm()`.
  - `dataCurta()` monta a data do topo.
  - `rotularCampos()` dá nome acessível automático aos filtros.
  - Botões só de ícone ganharam `aria-label`.
  - Emojis de interface viraram `svgIcon` (16 no app.js, 6 no WhatsApp) ou foram retirados (cerca de 50).
  - A tela Hoje foi reescrita.
  - O painel escuro do Financeiro virou a faixa de indicadores.
  - O botão de WhatsApp da lista de clientes ficou legível; antes era branco no verde, 1,98:1.
  - 36 tamanhos de letra pequenos que estavam no código foram corrigidos.
- **Servidor.** Em `hojeRegras.ts`, o ícone passou a ser o nome do SVG, não um emoji.
- **`index.html`.** Carrega só Inter e Spectral. Ganhou o campo de busca no topo, e "Registrar" e "Descobrir processos" passaram a ser botões secundários.
- **Defeitos corrigidos.**
  - Modo escuro ilegível nos cartões da lista no celular (`#fff` fixo em `.page tbody tr`).
  - Sombra da gaveta vazando no celular.
  - Data com maiúsculas erradas.

## Verificado

- **Auditoria repetida** na cópia local, com banco descartável (Docker, porta 3313) e dados fictícios: 37 telas, 3 larguras e tema escuro, 133 medições.

  | Medição | Antes | Depois |
  |---|---|---|
  | Contraste ruim no notebook | 525 | 155 |
  | Contraste ruim no escuro | 1.024 | 364 |
  | Letra < 12px no celular | 832 | 221 |
  | Alvo < 44px no celular | 730 | 410 |
  | `transition: all` | 425 | 0 |
  | Degradês | 61 | 1 |
  | Fontes | 6 | 2 |
  | Raios diferentes | 13 | 8 |
  | Erros de JavaScript | 0 | 0 |

  O que sobrou se concentra no Escritório virtual (66 contrastes, 140 letras e 87 emojis).
- **Capturas** de Hoje (notebook, celular e escuro), Clientes, Financeiro, WhatsApp no celular, Mesa no celular, Dashboard e "Registrar".
- **`npm run lint`:** 0 erros.
- **`npm test`:** 1.501 de 1.503 na primeira rodada. As 2 falhas eram testes que conferiam os raios antigos (10px e 11px) e foram atualizados para 8px. Teste novo: `tests/designSystem.test.mjs` (8 casos) e um caso novo em `tests/hoje.test.mjs`.
- **Ponta a ponta (Playwright):** 8 de 9. A falha foi "cadastrar cliente aparece na lista": com os 37 clientes fictícios, o novo cai na página 2. O cadastro funcionou (o aviso "Cliente cadastrado" apareceu). No banco do CI, com 1 cliente, o teste passa.

## Decisões

- **Opção B de contraste.** Mesmas cores, com o texto mais escuro onde reprovava.
- **Inter como fonte única** da interface; Spectral só na marca.
- **Escritório virtual fora desta rodada.** Outra sessão estava editando `public/escritorio.js` e as rotas do escritório no mesmo momento; o arquivo ficou fora do commit e do teste de emoji.
- **Agenda e Financeiro com ajustes visuais só por CSS.** A visão semanal e o reagrupamento das abas são mudanças grandes de JS e ficaram para uma etapa própria.

## Pendente

- Escritório virtual: emojis decorativos, 12 cores de etiqueta e letras pequenas.
- Agenda: semana útil como visão padrão, só 3 tipos de evento e legenda.
- Financeiro: reagrupar as 10 abas.
- Alvos de toque restantes: links dentro do texto das tabelas e ícones pequenos do Monitoramento.

## Próxima sessão

- **Antes de mexer em tela,** leia `DESIGN.md`.
- **Para auditar de novo,** os scripts usados ficaram no scratchpad desta sessão; é melhor transformá-los num teste Playwright de design.
