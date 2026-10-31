# 31/10/2026: pesquisa sobre produção de peças processuais

## Pedido
Jessica: "Você consegue fazer uma pesquisa minuciosa sobre montagem de peças iniciais, contestações, entre outros? Sobre a produção mesmo." Antes, ela perguntou se o Claude tinha alguma skill jurídica para o Brasil. Resposta: não tem. Os agentes jurídicos instalados são genéricos e seguem o modelo americano.

## Feito
- Pesquisa em fontes primárias: Planalto, Câmara (texto atualizado das leis), CNJ, STF, STJ, TST e OAB.
- Arquivo: `docs/pesquisas/2026-10-31-producao-pecas-processuais.md`, com 925 linhas. Pasta nova, porque o repositório não tinha lugar para pesquisas.
- Conteúdo:
  - parte geral: requisitos, prazos, peticionamento eletrônico, redação e uso de IA;
  - 14 peças com checklist;
  - 4 áreas com checklist: trabalhista, previdenciário, família e bancário;
  - tabela de prazos e erros que levam a indeferimento;
  - recomendações para a esteira automática do CRM;
  - lista do que não foi confirmado e fontes com URL.
- Cada afirmação tem marca de confiança: ✔ lido no texto oficial, ◐ trecho oficial, ⚠ não confirmado.
- Nenhum código foi alterado.

## Verificado
- Estrutura e seções do arquivo conferidas. Não há CPF nem dados pessoais.
- Suspensão nacional do **Tema 1.414/STJ** (cartão consignado RMC) conferida numa busca independente: decisão publicada pelo TRF-3 e suspensão registrada pelo TJMG em 17/03/2026.
- O restante não foi conferido item a item. Vale a marca de confiança de cada afirmação.

## Decisões e porquês
- A pesquisa ficou em `docs/pesquisas/`, separada de `docs/manual/`. Ela é material de apoio, não descreve o comportamento do sistema; por isso o manual e o espelho do Obsidian não mudaram.
- O cálculo não foi alterado mesmo com a divergência abaixo, porque a escolha da tese é da Dra.

## Pendente
- **Divergência a decidir com a Dra. Letícia:**
  - O Calculista (`contabilista.ts`, entrega de 31/10) devolve **tudo em dobro pelo Tema 929, sem a modulação de 03/2021**.
  - A pesquisa diz que a tese do Tema 929 ainda **não foi publicada** e que vale a modulação do EAREsp 600.663: em contrato privado, o dobro só alcança o que foi cobrado depois de 30/03/2021.
  - Confirmar no acórdão antes de manter o critério.
- **Tema 1.414/STJ:** as ações de RMC ficam suspensas no país todo (exceto cumprimento de sentença). A Dra. decide se protocola mesmo assim ou espera. O CRM ainda não avisa sobre isso.
- 20 itens marcados como "não confirmado" na seção 8 da pesquisa.

## Próxima sessão
- Se a Jessica aprovar, transformar a seção 7 da pesquisa em regras da esteira:
  - checklist bloqueante por peça;
  - calculadora de valor da causa com teto do JEC e do JEF;
  - aviso de temas suspensos (Tema 1.414) antes de gerar a peça.
- Skills: `domain-modeling`, `tdd`, `codebase-design`, `verification-before-completion`.
