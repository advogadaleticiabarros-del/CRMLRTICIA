# Relatório — Esteira da petição inicial

**Data:** 22/10/2026

## Pedido
A Jessica: as peças saem sem contexto, mesmo com OpenAI, cofre de peças no Obsidian, acervo de leis e a equipe de agentes. Quer documentos lidos de fato, cálculos feitos de fato e peça com contexto, com cada agente atuando na produção. Regra nova: o que for do mesmo cliente contra a mesma parte contrária vai numa única petição inicial (ex.: empréstimo + juros abusivos; cartão RMC + RCC).

## Causa encontrada
- A busca de modelos olhava só as 40 primeiras peças (o cofre tem 176, sendo 128 trabalhistas).
- Os dois importadores do cofre (script e tela) perdiam as teses escritas em lista de várias linhas.
- A petição ignorava a conversa e os arquivos do WhatsApp, os arquivos guardados no CRM, a parte contrária, as anotações da produção e o guia "Como escolher" do cofre. Os documentos eram cortados em 4.000 caracteres.
- Não havia cálculo, e a redação usava esforço de raciocínio baixo.

## O que foi feito
- **Esteira** (`src/services/esteiraPeca.ts`, com o banco injetado):
  1. junta os casos correlatos (`pecaConsolidacao.ts`);
  2. a Dra. Helena lê todas as fontes e monta a ficha de fatos, com a fonte de cada dado (`pecaDossie.ts`). Cada arquivo é transcrito uma vez e fica guardado em `documento_leituras`;
  3. cálculos em código (`pecaCalculos.ts`): indébito com a modulação do EAREsp 600.663/RS, meses estimados pela parcela, juros pela Price, valor da causa;
  4. o Cérebro escolhe a estratégia e os modelos pelo guia do cofre e traz as teses;
  5. a Dra. Júlia traz os fundamentos;
  6. a redação usa esforço alto, e o sistema confere se os valores calculados aparecem na peça.
- **No caso ficam** o "Dossiê da peça" e a "Petição Inicial (conjunta) — Cliente (vN)", mais uma nota na produção. Os outros casos da peça conjunta recebem uma nota e não geram outra peça (`pecas_conjuntas`, migration 167).
- **Regeração manual** em segundo plano, com aviso no sino.
- **Revisão automática:** passa a escolher a petição, nunca o dossiê, e enxerga a peça conjunta.
- **Busca de modelos sem limite:** o texto só é carregado da peça escolhida.
- **Importadores do cofre:** passam a ler listas de várias linhas.

## Verificado
- 26 testes novos em `tests/esteiraPeca.test.mjs`. Cobrem cálculos, consolidação, leitura da ficha, prompts, dossiê e a esteira com agentes simulados, além da auditoria do SQL contra as migrations.
- `npm run build`, `npm run lint` (0 erros) e `npm test`: 1.055 testes ok, 0 falhas.
- Leitor de frontmatter corrigido, testado numa ficha real do cofre: as teses chegam.
- **Não verificado:** uma geração real em produção. O modo automático bloqueou a leitura do banco de produção; a primeira peça real precisa ser conferida pelo dossiê.

## Decisões
- A IA só extrai os números; a conta é feita em código.
- A peça conjunta é automática quando há mesmo cliente, mesma área, mesma parte contrária e o caso ainda não foi protocolado. Para a parte contrária vale a raiz do CNPJ ou o nome normalizado.
- Dano moral e taxa média do Bacen não são inventados: sem valor nas fontes, ficam em [colchete].

## Pendente
- Buscar sozinho a taxa média do Bacen (confirmar a série no SGS).
- Valor padrão de dano moral por tipo de caso (decisão da Dra.).
- Reimportar o cofre para gravar as teses em `peca_modelos`.
- Cadastrar a parte contrária nos casos em produção.

## Próxima sessão
Abrir o "Dossiê da peça" das primeiras petições geradas e ajustar a leitura e a escolha conforme o que aparecer.
