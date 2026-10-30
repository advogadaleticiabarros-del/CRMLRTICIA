# 06 · Documentos e peças

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Documentos podem ser gerados por template (preenchimento automático) ou redigidos por IA (com sistema anti-invenção: dado não confirmado nos autos vira `[colchete]` visível e contado antes de abrir). Arquivo digital organizado em pastas por cliente, guardado no MEGA, com assinatura eletrônica integrada.

## Contexto

Consulte pra entender a diferença entre os dois jeitos de gerar documento, como funciona a camada anti-invenção da IA, ou onde um documento fica guardado.

## Duas formas de gerar um documento

- **Modelo com preenchimento automático** — um template com marcadores (`{{cliente_nome}}`, `{{advogada_oab}}`, etc.) que o sistema preenche sozinho com os dados do cliente, do caso e da advogada responsável ao gerar. Bom pra documentos padronizados: procuração, contrato, declaração.
- **Peça redigida por IA** — petições e minutas montadas pela IA a partir do caso (Estagiário IA e gerador de petição). Nesses casos, tudo que a IA **não conseguiu confirmar nos autos** aparece marcado entre colchetes no texto — o sistema conta essas pendências e mostra quantas e quais são antes de você abrir o documento, pra nunca protocolar algo com um dado inventado sem perceber.

## Arquivo digital (GED)

Pastas automáticas por cliente: contratos, procurações, documentos pessoais, processos, financeiro, audiências, e (específico do Dativo) nomeação, certidão de audiência, comprovante de atuação, outros. Documentos têm status (pendente, recebido, assinado, arquivado) e ficam guardados no MEGA (armazenamento externo, não ocupa disco do servidor).

## Esteira de produção (tela Produção)

Acompanha o trabalho de **redigir e protocolar** uma peça, por etapa: Em análise → Separação de docs → Criação inicial → Revisão inicial → Aguardando protocolo → Protocolado → **Concluído** (ou Recusado, que trava o card até reverter). SLA de 10 dias corridos, pausado automaticamente enquanto houver pendência aberta no card.

**Mover o card (desde 21/10/2026):**
- o quadro ocupa a altura da tela e cada coluna rola por dentro, então a barra lateral e as setas ficam sempre à vista;
- a roda do mouse sobre uma coluna desce os cards; sobre o título das colunas, anda para o lado;
- ao arrastar um card até a borda, o quadro anda sozinho para a coluna seguinte;
- também dá para trocar a etapa pelo seletor do próprio card.

**Mesa do caso (desde 22/10/2026).** Clicar num card abre a mesa do caso em tela cheia (antes era um modal com 17 blocos empilhados e a peça só para ler). Pedido da Jessica: "preciso estar imersa caso a caso, ter uma visão clara do início, meio e fim, e poder usar o CRM plenamente, sem precisar sair de lá de dentro, a não ser para copiar a versão final e conferir dentro do Jusbrasil".
- **Topo:** cliente, caso, prazo (10 dias), "Recusar caso" e "Avançar para…" (protocolo pede o número do processo, como antes).
- **Régua:** Preparação (Em análise, Separação de documentos), Produção (Criação inicial, Revisão inicial) e Protocolo (Aguardando protocolo, Protocolado, Concluído). Clicar numa etapa mostra "o que fazer" e "pronto para avançar quando", com o que já está cumprido. A régua orienta, não trava.
- **Esquerda, o caso:** partes (editar), valor da causa, prescrição, resumo dos documentos (checklist, quantos há no caso, mensagens ao cliente esperando aprovação), responsável e etiquetas. "Prazos e movimentações" abre a ficha do processo.
- **A mesa abre no trabalho de cada etapa** (desde 22/10/2026, à tarde):
  - Em análise: aba **Caso**;
  - Separação de documentos: aba **Documentos**;
  - Criação inicial e Aguardando protocolo: **Peça**;
  - Revisão inicial: **Peça com o parecer da revisão ao lado** (botão "Esconder o parecer");
  - Protocolado e Concluído: aba **Caso**, com o resumo do protocolo.

  Ao avançar a etapa, a mesa muda junto.
- **Aba Caso:**
  - resumo do protocolo, quando já protocolado: nº do processo, data, versão protocolada, valor da causa e se o acompanhamento nos tribunais está ativo;
  - relato do atendimento e relato escrito pela Dra. Camila a partir do WhatsApp;
  - análise da Dra. Helena, com os pontos graves primeiro e a fonte de cada um. "Analisar de novo" roda em segundo plano, sem avisar no WhatsApp da Dra.; pedido de reenvio ao cliente vira rascunho para aprovar.
- **Aba Documentos:**
  - aviso de mensagens ao cliente esperando aprovação, com atalho;
  - checklist grande, em que clicar marca o que chegou;
  - coleta da Dra. Camila: o que pediu, o que chegou e as cobranças preparadas;
  - enviar arquivos (escolher ou arrastar; PDF, foto ou Word, até 15 MB);
  - pasta do Drive e a lista dos documentos do caso. **A pasta é lida sozinha** a cada 30 minutos (7h–21h) enquanto o caso está em produção, antes do protocolo: arquivos novos, inclusive de subpastas, entram no caso já lidos pela IA. **"Atualizar da pasta"** puxa na hora (em segundo plano, com aviso no sino) e, se o Google recusar, o sino diz o motivo e o que fazer (por exemplo, compartilhar a pasta com a conta Google do CRM). No caso que vem do e-mail da parceria, o link da pasta já fica gravado no card e é a mesma pasta onde os anexos do e-mail foram salvos (desde 30/10/2026). Código: `src/services/pastaDrive.ts`.
- **Centro, abas Caso, Documentos, Peça, Revisão, Cálculos e Dossiê da peça.** A aba **Cálculos** mostra a planilha do Calculista (ver Esteira da petição inicial) com o botão "Baixar planilha (.xlsx)". Na Peça:
  - o texto abre como folha de papel e é editável: negrito, itálico, sublinhado, alinhamento, listas, recuo, títulos e citação;
  - os campos a preencher ficam em amarelo, e "Próximo" pula entre eles;
  - salva sozinho (ou Ctrl+S);
  - colar do Word ou de um PDF mantém só a formatação de peça.
- **Versões:** a 1ª edição de uma versão da equipe cria a versão da Dra. ("v3 · edição da Dra."); a da equipe fica intacta. "Comparar com a versão da equipe" mostra só os trechos que mudaram (laranja saiu, azul entrou).
- **O que a equipe aprende:** comparando as versões, o redator e a Laya anotam lições ("o que mudou" e "regra proposta"). "Aprovar como regra" vale para as próximas peças da área; "Só neste caso" vale só para o caso. As regras entram na redação das próximas petições. A comparação roda sozinha ao marcar a versão final, ou pelo botão.
- **Versão final:** "Marcar como versão final" trava a edição (há "Destravar"). "Copiar para o Jusbrasil" copia com a formatação (Times 12) e avisa se ainda há campos em amarelo; "Copiar sem formatação" copia o texto puro. A cópia fica registrada na linha do tempo.
- **Direita:** pendências (pausam o prazo), recado no portal do cliente, observação do card e uma linha do tempo única (equipe, agentes e jornada).
- **Segurança:** o texto formatado é limpo no servidor por lista fechada (parágrafo, negrito, itálico, sublinhado, títulos, listas, citação, tabela e alinhamento). Script, link, imagem e estilo extra nunca são gravados. A versão em texto puro continua sendo a que a revisão e a Dra. Vera leem.
- Código: `public/mesa.js`, `src/routes/mesa.ts`, `src/services/mesaCaso.ts`. Migration 168 (`documents.content_html`, `versao_de`, `final_em` e a tabela `peca_licoes`). Testes: `tests/mesaCaso.test.mjs` e o teste de ponta a ponta "Mesa do caso" em `e2e/essencial.spec.mjs`.

**Importante — "Concluído" aqui não é o caso encerrado.** Significa só que a peça foi protocolada e o trabalho de produção daquela demanda terminou — o **caso em si continua ativo**, seguindo dali em diante pela esteira processual normal (acompanhamento de movimentação, prazos, audiências — ver [Processos e prazos](04-processos.md)), não pela esteira de produção. "Concluído"/"Protocolado" só tiram o card da contagem de "Em produção" e param o relógio do SLA de redação — não mudam o status do processo.

## Card único do cliente: várias ações, um card (desde 30/10/2026)

Pedido da Jessica (caso real com 6 bancos): "preciso de tudo centralizado em um único card, pois está bem bagunçado criar vários cards diferentes, mesmo que vamos fazer vários processos distintos para protocolar... 80% o CRM deve me entregar pronto, organizado, com os documentos renomeados e as peças prontas para que eu revise e protocole um a um".

**Regra de divisão (Jessica, 30/10):** cada banco (parte contrária) tem a **sua peça**. RMC e RCC **do mesmo banco** podem ir juntos (faixa "processo único"). Empréstimo consignado e cartão consignado (RMC/RCC) do mesmo banco são **peças diferentes** (regra de 22/10, confirmada pela Jessica em 30/10).

**No quadro:** cliente com **2 ou mais ações antes do protocolo** aparece como **um card** ("6 ações", com os bancos embaixo), na etapa da ação mais atrasada, com o maior prazo e a soma das pendências. O card do cliente não se arrasta: cada ação anda pela própria tela. Ação protocolada volta a ter card próprio (já é um processo, com nº).

**Ao clicar, abre a tela do cliente:**
- **O que falta:** os documentos comuns que faltam. O **extrato de empréstimos consignados do INSS** (HISCON) **trava** as ações de consignado e cartão consignado: é o único documento que liga cada desconto ao banco e ao contrato; sem ele o cálculo sai zerado (foi o que aconteceu com a peça do Itaú em 28/10). Também avisa procuração, declaração, identidade, comprovante de residência e histórico de créditos.
- **Ações para protocolar, uma a uma:** uma linha por banco com a tese, a etapa, a situação (Faltam documentos / Peça ainda não gerada / Peça para revisar / **Pronta para protocolar** / Protocolada), a versão da peça e o kit. Botões:
  - **Abrir a mesa:** a Mesa do caso daquela ação (por cima; ao fechar, volta para o cliente);
  - **Baixar o kit (.zip):** `00 - Petição inicial - <banco>.docx` (Times 12, espaçamento 1,5, recuo de 2,5 cm; a versão marcada como final, senão a mais nova), os anexos **na ordem do protocolo, numerados e renomeados** (`01 - Procuração - Cliente.pdf`, `02 - Declaração de hipossuficiência...`, `04 - Histórico de créditos do INSS (1 de 6)...`), **fotos convertidas em PDF**, a planilha de cálculos e o `LEIA-ME.txt` (ordem, nome de chegada de cada arquivo, o que ficou fora por estar só no Drive e o que falta). Documento que está só no Google Drive (importado da pasta do caso, só com o link) é **baixado do Drive na hora** e entra no kit; se o Drive falhar, o LEIA-ME avisa. Baixar fica na linha do tempo da ação;
  - **Marcar a vN como final:** a peça da equipe (ou a editada na mesa) vira a versão final, sem abrir a mesa;
  - **Colar a peça revisada (versão final)** (desde 30/10/2026, pedido da Jessica: "eu só quero colar lá, para que deixe no papel timbrado e deixe na formatação correta para peças"): abre uma folha; a Dra. cola a peça (do Word, do Jusbrasil ou de onde estiver). O CRM lê negrito, itálico, sublinhado, alinhamento, títulos e citações (no Word, o recuo de 4 cm) e monta o .docx no **papel timbrado** (`assets/timbrado/papel-timbrado.docx`, o timbrado da Dra. com o corpo vazio): Times New Roman 12, espaçamento 1,5, justificado, recuo de 2,5 cm; endereçamento e títulos (linhas em maiúsculas) centralizados em negrito; citação com recuo de 4 cm e letra 10; do "Nestes termos" (ou da data) até a assinatura, tudo centralizado e preso, sem quebrar de página, com espaço para assinar antes do nome. A tela só manda ao servidor a lista de parágrafos (nunca HTML). Código: `src/services/papelTimbrado.ts`, testes em `tests/papelTimbrado.test.mjs`. **"Baixar a peça (timbrado)"** baixa a versão final (ou a mais nova) no timbrado; a peça da equipe no kit também sai no timbrado. A API ainda aceita o arquivo Word/PDF (`file_base64`): a Dra. revisou no Word e envia o .docx (ou o PDF). Vira a versão seguinte ("Petição Inicial — Cliente (v3 · versão final da Dra.)"), já marcada como final (as outras deixam de ser), e **vai no kit exatamente como ela mandou**. Do Word, o texto é lido para a revisão e a conferência. Com a versão final, a ação fica "Pronta para protocolar" mesmo que ainda falte documento (o que falta continua listado). Fica na linha do tempo da ação;
  - **Protocolar:** pede o nº do processo (avisa se a peça não está marcada como versão final). A ação vira "Protocolada" e a próxima fica à vista.
- **Documentos do cliente:** cada documento com o tipo reconhecido e o **nome padrão** ("Procuração - Cliente.pdf"), com o nome de chegada embaixo. **Comuns** servem a todas as ações; **de um banco** (contrato, consulta de cartões, reclamação) vão só para as ações do banco que o documento cita, mesmo que tenham sido anexados no card de outro banco (o print "PAN e FACTA" anexado no card do Itaú vai para os kits do PAN e da Facta, e não para o do Itaú). Documento de banco que não cita banco nenhum fica na ação onde foi anexado; sem ação, aparece "anexe no card do banco certo". "Dar o nome padrão" renomeia no CRM e guarda o nome de chegada (`documents.nome_original`). Também dá para enviar documentos do cliente por ali (valem para todas as ações).

**Como o tipo é reconhecido:** primeiro pelo "Tipo do documento" que a leitura por IA escreve no texto (um "EXTRATO_DE_EMPRESTIMO" que na verdade é histórico de créditos é tratado como histórico de créditos), depois pelo nome do arquivo. Peça, dossiê, revisão e análise são internos e nunca vão para o kit.

**Senha do Meu INSS:** colada na observação do card (ex.: o e-mail do parceiro), vai para o cofre do cliente (`client_credentials`) e sai do texto, que é lido pela IA. Vale ao salvar a observação e, para o que já existia, a cada início do CRM. Ver o runbook.

Código: `src/services/loteProducao.ts` (regras: classificação, nome, kit, situação, agrupamento do quadro), `kitProtocolo.ts` (.zip, .docx, foto em PDF), `loteProducaoMysql.ts` (banco), `src/routes/lote.ts` (`GET /api/lote/:clientId`, `GET /api/lote/:clientId/acao/:caseId/kit`, `POST /api/lote/:clientId/acao/:caseId/versao-final`, `POST /api/lote/:clientId/padronizar`), `public/loteCliente.js`. Migration 173 (`documents.nome_original`). Testes: `tests/loteProducao.test.mjs`, `tests/kitProtocolo.test.mjs` e o de ponta a ponta "Card do cliente".

## Esteira da petição inicial: os agentes montam a peça (desde 22/10/2026)

Pedido da Jessica: "preciso que os documentos sejam lidos de fato, os cálculos sejam realizados de fato, a peça seja produzida com contexto". Antes, a petição recebia só o resumo do lead, os documentos cortados em 4.000 caracteres e **um** modelo buscado entre as 40 primeiras peças do cofre. Agora, ao mover o card para **Criação inicial** (ou no botão "Gerar nova versão da petição"), a equipe trabalha em ordem:

1. **Processo único (desde 22/10/2026, regra da Jessica):** a peça junta só os pedidos que a Dra. **confirmou** como um processo.
   - **Quando juntar:** mesmo cliente, mesma área, **mesmo banco** (CNPJ, nome ou o banco escrito no título, como "RCC — Banco PAN") e **mesma família de tese**:
     - **cartão consignado:** RMC e RCC;
     - **empréstimo consignado:** um ou vários contratos, refinanciamento e portabilidade;
     - **empréstimo pessoal:** crédito pessoal e CDC;
     - **cartão de crédito comum:** anuidade, cartão não solicitado.
   - **Nunca juntam:** famílias diferentes, mesmo contra o mesmo banco (teses muito diferentes). Cartão consignado com empréstimo consignado também fica separado.
   - **Juros abusivos:** sempre um pedido dentro da peça da família, nunca processo à parte.
   - **Como confirmar:** o quadro mostra a faixa "processos únicos possíveis". Em "Ver e juntar", a Dra. desmarca o que deve ficar separado e clica em "Juntar em um processo".
   - **Depois de juntar:** os pedidos unidos somem do quadro e aparecem no card do processo como "+N pedidos". Seguem a etapa e o nº do processo dele, com uma peça e um protocolo.
   - **Separar:** na aba Caso da mesa, "Separar" devolve o card próprio.
   - Código: `src/services/pecaConsolidacao.ts`, coluna `cases.unido_ao_caso` (migration 169).
   - **Contratos da peça (desde 28/10/2026):** o extrato do INSS traz **todos** os contratos do cliente, de todos os bancos. Na peça só entram os contratos do **banco do réu** e da **mesma família de tese**, ou os que a Dra. escolheu. Ver "Contratos nos documentos", abaixo.
2. **Dra. Helena lê tudo:** relato, documentos do caso (Drive e arquivos guardados), PDFs e fotos que o cliente mandou no WhatsApp, a conversa inteira (áudios já transcritos) e as anotações da produção. Cada arquivo é transcrito por inteiro uma única vez (fica guardado). Ela monta a **ficha de fatos** com a fonte de cada dado: réus, contratos (nº, tipo, valor, parcela, taxa, início e fim do desconto), descontos mês a mês, fatos, respostas da triagem (sacou o dinheiro? recebeu o cartão?) e o que falta.
3. **Cálculos em código, não pela IA:**
   - devolução do indébito por contrato, com a modulação do STJ (EAREsp 600.663/RS): descontos até 03/2021 voltam de forma **simples**; de 04/2021 em diante, **em dobro**. Mês repetido em dois documentos conta uma vez;
   - contrato só com parcela e mês de início: o sistema monta os meses até o fim do contrato ou até hoje e avisa que é estimativa;
   - juros: parcela recalculada pela tabela Price com a taxa média do Bacen (quando a taxa média está em algum documento) e o que foi pago a mais;
   - valor da causa: soma do que foi calculado, com a restituição **atualizada** pela planilha do Calculista (abaixo). Sem valor de dano moral definido, a peça deixa **[valor do dano moral]**.
   - **Planilha de cálculos (Dr. Augusto, Calculista — desde 28/10/2026, pedido da Jessica: "algum agente analise os extratos e faça planilhas de cálculos para colocar nas peças"):** cada desconto lido nos extratos vira uma linha: competência, contrato, valor descontado, devolução (simples ou em dobro), fator de correção, valor corrigido, juros de mora e total. Critério padrão, escrito na própria planilha:
     - **correção monetária** desde cada desconto (Súmula 43/STJ), com os índices do mês seguinte ao desconto até a data-base: **INPC até 08/2024** e **IPCA a partir de 09/2024** (Lei 14.905/2024). Índice negativo não reduz o valor original;
     - **juros de mora** simples desde cada desconto (Súmula 54/STJ; critério confirmado pela Jessica em 30/10/2026: "sempre juros atualizados", nunca desde a citação), sobre o valor corrigido: **1% ao mês até 08/2024** e, depois, a **taxa legal** (Selic − IPCA do mês, nunca negativa);
     - **data-base:** o último mês fechado com índice publicado (o IPCA sai por volta do dia 10 do mês seguinte);
     - **índices:** API SGS do Banco Central (INPC 188, IPCA 433, Selic acumulada no mês 4390), guardados na tabela `indices_economicos` (migration 172). Só se busca o que falta; o mês corrente nunca entra. Bacen fora do ar: usa o que já está guardado; sem nada guardado, a planilha sai nominal, com aviso;
     - os juros pagos a mais da revisão da taxa (tabela Price) continuam nominais;
     - **para mudar o critério** (ex.: juros desde a citação ou outro índice), basta mudar `atualizarIndebito` e `CRITERIOS` em `planilhaCalculos.ts`; os testes mostram o efeito.
   - **Demonstrativo de descontos (desde 30/10/2026, pedido da Jessica):** documento à parte, em PDF, que separa do extrato do INSS só o que é desta peça. É a demonstração individual do que já foi descontado e a base do valor da causa. **O extrato original continua indo inteiro no protocolo**; o demonstrativo não o substitui nem o recorta.
     - **Contratos:** os que entraram na peça (mesmo banco do réu e mesma tese, ou escolhidos pela Dra.), com nº, tipo (Cartão RMC, Cartão RCC, empréstimo…), banco, data de inclusão, quantidade de meses, período e total descontado de cada um;
     - **mês a mês, por contrato:** competência, valor descontado e a **fonte** (o documento de onde saiu o desconto);
     - **base do valor da causa:** total descontado (nominal), a restituir (simples até 03/2021 e em dobro depois), a restituição atualizada até a data-base (quando há planilha), dano moral e o valor da causa. São os mesmos números da planilha e da petição, porque saem do mesmo cálculo;
     - desconto sem nº de contrato: vai para o único contrato da peça, ou para "Contrato não identificado", com aviso. Contrato sem desconto lido fica listado, também com aviso. Os contratos que "ficaram fora" aparecem só na versão de tela (aba Cálculos), não no PDF do protocolo;
     - **onde fica:** "Demonstrativo de descontos — Cliente (vN)", salvo a cada versão da peça. Mesa do caso → aba **Cálculos** → "Baixar demonstrativo de descontos (PDF)". Vai no **kit da ação** logo antes da planilha (só a versão mais nova). Código: `demonstrativoDescontos.ts`; testes: `tests/demonstrativoDescontos.test.mjs`.
4. **Cérebro escolhe a estratégia** pelo guia do próprio cofre ("🧭 Como escolher" e o roteiro de triagem da área), entre **todas** as peças da área, e traz as notas de tese (ex.: "Repetição do indébito em dobro").
5. **Dra. Júlia** separa os fundamentos que existem, com o texto oficial.
6. **Redação com raciocínio alto** (GPT-5.6 Luna, esforço alto), com os cálculos prontos ("use exatamente estes valores"), os modelos inteiros e as teses. Depois o sistema confere se os valores calculados aparecem na peça.

**O que fica no caso:** o **"Dossiê da peça"** (fontes lidas e as que não deu para ler, ficha de fatos com a fonte de cada dado, cálculos, modelo escolhido e o motivo, o que falta e a conferência dos valores), a **"Planilha de cálculos — Cliente (vN)"** (tabela para ler no CRM e arquivo .xlsx com fórmulas e a aba "Índices", para anexar; a petição diz que o detalhamento está na planilha anexa e a conferência checa o total atualizado) e a **"Petição Inicial — Cliente (vN)"** (ou "Petição Inicial conjunta"). A nota da produção resume: fontes lidas, modelo, valor a restituir, valor da causa e quantos valores conferem. Nos outros casos da peça conjunta entra a nota "Este caso entrou na petição inicial conjunta do caso #N"; mover esses cards para Criação inicial não gera outra peça.

A geração leva alguns minutos e roda em segundo plano: o aviso chega no sino. A revisão automática roda em seguida, sobre a petição (nunca sobre o dossiê).

Código: `src/services/esteiraPeca.ts` (ordem dos agentes), `pecaCalculos.ts`, `planilhaCalculos.ts` (Calculista), `indicesEconomicos.ts` e `indicesEconomicosMysql.ts` (Bacen), `xlsxSimples.ts` (arquivo .xlsx), `pecaConsolidacao.ts`, `pecaDossie.ts`, `esteiraPecaMysql.ts` (banco). Testes: `tests/esteiraPeca.test.mjs` e `tests/planilhaCalculos.test.mjs`. Tabela `pecas_conjuntas` (migration 167).

### Contratos nos documentos: o que entra em cada peça (desde 28/10/2026)

Caso real (pedido da Jessica): a peça do Valmirio contra o **Banco Itaú** (empréstimo consignado) saiu com um empréstimo do **BANCO PAN** e um cartão **RMC da FACTA**, lidos no extrato do INSS. Os dois também entravam no cálculo do indébito.

**Como funciona agora:**
- **Todos os contratos lidos ficam guardados no cliente**, uma vez cada (pelo nº do contrato; sem número, banco + tipo + data), com o tipo (RMC, RCC, empréstimo consignado, empréstimo pessoal, refinanciamento, portabilidade, cartão comum) e o banco.
- **Mesa do caso → aba Caso → "Contratos nos documentos":** os contratos agrupados por banco, com o banco do réu primeiro ("réu deste processo"). Cada linha mostra "Entra nesta peça" ou "Fora desta peça", com o motivo. No seletor, a Dra. escolhe o destino:
  - **Automático (banco e tese):** vale a regra abaixo;
  - **Este processo / Processo #N:** o contrato entra na peça daquele processo (pedido unido conta como o processo dele);
  - **Fora de qualquer peça.**
- **"Ler os contratos agora" / "Ler de novo":** a Dra. Helena lê os documentos e só lista os contratos, sem redigir a peça. Roda em segundo plano e avisa no sino. A geração da peça também guarda os contratos que ler.
- **Regra automática (sem escolha da Dra.):** entra só o contrato do **mesmo banco do réu** (nome tolerante: "Itaú Consignado S.A." = "Banco Itaú S.A.") **e** da **mesma família de tese** do processo. Contrato **sem banco** no documento fica fora até a Dra. decidir. Caso **sem réu** (nem cadastrado nem no título) usa todos os contratos e avisa.
- **A escolha da Dra. vale acima da regra.** Contrato escolhido para a peça entra mesmo que a leitura seguinte não o encontre. Contrato de outro banco escolhido para a peça vira aviso: "conferir o polo passivo".
- **Descontos seguem os contratos:** desconto de contrato que ficou fora sai do cálculo. Desconto sem nº de contrato só fica se o banco dele for o do réu; sem contrato nem banco, sai do cálculo (com aviso) quando há contratos de outros bancos no extrato.
- **Na peça:** o redator recebe a lista "CONTRATOS QUE NÃO SÃO DESTA PEÇA", com a ordem de não mencioná-los. Os réus lidos de outros bancos também saem da ficha de fatos.
- **No dossiê:** a seção "Ficaram fora desta peça" mostra cada contrato com o motivo. Se nenhum contrato do réu aparece nos documentos, a lacuna "Nenhum contrato de <réu> aparece nos documentos lidos" vai para o dossiê e para a peça.
- **Mudou o destino de um contrato?** Vale na próxima versão: "Gerar nova versão" na aba Peça. Ao associar um contrato a um processo, entra uma nota na linha do tempo dele.

Código: `src/services/contratosDoCaso.ts` (regra), `levantarContratos` em `esteiraPeca.ts`, `contratosSalvos`/`guardarContratos` em `esteiraPecaMysql.ts`, rotas `GET /api/mesa/:caseId/contratos`, `POST /api/mesa/:caseId/contratos/levantar` e `PUT /api/mesa/contrato/:id`. Tabela `cliente_contratos` (migration 171). Testes: `tests/contratosDoCaso.test.mjs`, `tests/esteiraPeca.test.mjs` e o teste de ponta a ponta "contratos de outro banco ficam fora da peça".

## Revisão automática da peça (desde 30/09/2026)

A revisão (checagens estruturais + parecer de mérito por IA) agora roda sozinha logo depois que a IA gera:
- a **petição inicial** (ao mover para *Criação inicial*) — o aviso "Petição inicial gerada" já traz "X/Y itens OK, N pendência(s) crítica(s)";
- a **minuta automática da intimação** (Estagiário IA), quando o processo tem caso e cliente.

Mover para *Revisão inicial* continua revisando de novo (útil se você editou a peça). Nada é protocolado sem sua aprovação.

Correção junto: o revisor escolhia "o documento de IA mais recente do caso" — e o próprio parecer é um documento de IA, então uma segunda revisão revisava o parecer. Agora documentos "Revisão da Petição…" são ignorados na escolha.

## Leis conferidas na produção e na revisão (desde 21/10/2026)

As peças agora usam o acervo de leis (ver [Pesquisa de Leis](18-pesquisa-de-leis.md)):
- **Antes de redigir**, a **Dra. Júlia** entrega a quem redige só os artigos, súmulas e temas que existem, com o texto oficial e a fonte. Vale para a minuta do Enzo, a petição inicial, a análise do caso e o Assistente de IA (petição inicial, contestação e parecer). Citação fora da lista sai marcada **[conferir]**.
- **Na revisão**, a **Dra. Vera** confere cada citação da peça. O parecer "Revisão da Petição" ganha a seção "CONFERÊNCIA DAS CITAÇÕES", e a nota da produção mostra "citações: X/Y conferem". Para cada citação:
  - ✓ confere;
  - ✗ revogada, ou artigo que não existe naquela norma;
  - ? fora do acervo;
  - ⚠ o texto oficial não sustenta, ou sustenta só em parte, o que a peça afirma (análise da IA com o texto ao lado).
- A conferência também pode ser feita à mão: Pesquisa de Leis → Conferir citações.

## Contrato com mais de um contratante (desde 19/10/2026)

Exemplo: o casal no mesmo processo. O contrato sai **em nome dos dois** e cada um tem **a própria procuração e a própria declaração de hipossuficiência**.

**No contrato:** "CONTRATANTES: [titular]; e [outro], doravante denominados, em conjunto, CONTRATANTE." As cláusulas seguem dizendo "CONTRATANTE" (o conjunto), e cada contratante tem a sua linha de assinatura, antes da assinatura da advogada. Vale para os modelos padrão (trabalhista, cível, previdenciário, consumidor, família). O contrato de representação de menor não muda.

**De onde vêm os dados:** da **conversa do WhatsApp**. A IA lê o que o cliente mandou e lista todas as pessoas com os dados delas (nome, CPF, RG, estado civil, profissão, nacionalidade, endereço, e-mail). A advogada e a parte contrária nunca entram. CPF que não confere no dígito verificador aparece com aviso.

**Quando:**
- **No aceite da proposta:** o contrato já nasce com os contratantes da conversa.
- **No editor do contrato:** no botão **"🔎 Buscar contratantes na conversa"**.

Os dois **regeneram** o contrato, como o "Completar informações": o texto editado à mão é substituído. E os dois só mexem no rascunho interno; **nada é enviado ao cliente**.

**Ajustar:** em "Completar informações faltantes" → **"Outros contratantes"**:
- editar os dados de cada um (por exemplo, a profissão e o endereço, quando não vieram na conversa);
- marcar "mesmo endereço do titular";
- adicionar ou remover um contratante.

Fica salvo junto do complemento (`party_overrides.co_contratantes`).

**Opções do contrato** (no mesmo painel, desde 19/10/2026; valem para o titular e para os outros contratantes):
- **"Deixar sem profissão e e-mail quando não informados":** a qualificação sai sem esses trechos, em vez de "[profissão]" e "[e-mail]". Sem a opção, os colchetes continuam, para lembrar de preencher.
- **"Sem declaração de hipossuficiência":** o contrato sai só com o contrato e as procurações. As abas e o botão da declaração somem, e o "Baixar tudo" imprime só o contrato e as procurações.

Ficam em `party_overrides.omitir_vazios` e `party_overrides.sem_declaracao`, e regeneram os documentos ao marcar.

**Documentos:** abas "Procuração — Nome" e "Declaração — Nome" para cada um (editáveis). O "Baixar tudo" imprime todos. Ficam em `contracts.documentos_partes` (migration 165).

**Assinatura:**
- **Na tela do CRM:** com mais de um contratante, "Gerar link de assinatura" cria **um link para cada um**, com nome e CPF travados. O contrato só fica "assinado" (e cria o processo e os honorários) **quando todos assinarem**. Antes de 19/10/2026, a primeira assinatura já fechava o contrato. Contrato de uma pessoa só segue como antes.
- **No ZapSign:** cadastre os dois como signatários.

Código: regras em `partesContrato.ts` (`tests/partesContrato.test.mjs`), leitura da conversa em `partesContratoServico.ts`, geração em `contractReprocess.ts` (teste com banco em `tests/contratoVariasPartes.test.mjs`).

## Assinatura

Documentos podem ser enviados pra assinatura eletrônica direto pelo sistema, com acompanhamento de quem já assinou.

**Selfie do signatário — opcional, você escolhe (desde 28/09/2026):** ao gerar o link de assinatura de um documento ou contrato há a opção **"Exigir selfie do signatário"**. Desmarcada (padrão), a tela de assinatura nem mostra o campo de foto e o sistema descarta qualquer imagem enviada. Marcada, a selfie vira obrigatória: o botão "Assinar" só libera depois da foto, e o Termo de assinatura registra o evento "Selfie de verificação registrada". É só **registro/evidência** — o sistema não compara o rosto com nada. Foto do rosto é dado pessoal sensível (LGPD, art. 11), por isso a regra é pedir só quando fizer sentido. Cada link decide sozinho; links criados antes dessa mudança não pedem selfie. Atenção: a selfie aparece no Termo público de verificação (`/verificar.html?codigo=…`), acessível a quem tiver o código de verificação de 10 caracteres — não compartilhe o código fora dos envolvidos.

## Modelos de peça (banco de modelos do escritório)

Além dos templates de preenchimento automático, existe um banco de modelos de peça por área jurídica (`peca_modelos`) — a IA busca o modelo mais adequado ao caso na hora de montar uma minuta (por significado, quando o modelo já tem "índice" calculado; por palavra-chave do assunto/título, senão), em vez de escrever do zero toda vez. 176 modelos hoje, a maioria trabalhista. Desde 22/10/2026 a busca olha **todas** as peças da área (antes, só as 40 primeiras), e a petição inicial escolhe o modelo pelo guia "Como escolher" do cofre (ver Esteira da petição inicial, acima).

### De onde vêm os modelos — e como atualizar (desde 23/09/2026)

Os modelos são escritos e organizados no **cofre Obsidian** da Dra. Letícia (pasta "Modelos de Peças" — uma ficha `.md` por modelo, com o texto de verdade num `.docx` vinculado). **A IA nunca lê o Obsidian ao vivo** — ela lê uma cópia guardada no banco de dados, que só é atualizada quando alguém reimporta.

Duas formas de reimportar depois de criar/editar um modelo no Obsidian:
- **Pelo CRM (recomendado, sem terminal):** Configurações → card "Biblioteca de modelos de peça (IA)" → **Importar do Obsidian…** — escolhe a pasta "Modelos de Peças" no seletor do navegador, e o próprio CRM lê cada ficha, extrai o texto do `.docx` e recalcula o índice de significado, uma peça de cada vez (com barra de progresso).
- **Por script (technical, se precisar de algo fora do normal):** `node scripts/import-pecas-obsidian.mjs "<caminho do cofre>" "<mysql-url>"`, rodando de onde o cofre e o banco estejam acessíveis.

As duas formas são idempotentes (identificam o modelo pelo nome do arquivo — reimportar não duplica, só atualiza).

### Contrato padrão fixo — Família, pensão alimentícia

Desde 18/09/2026, toda proposta/contrato de área **família** cujo "Tipo de causa" contenha a palavra "pensão" (com ou sem acento — mesma detecção usada pra sugerir as observações da proposta) usa uma minuta fixa de **19 cláusulas** (`buildTemplateFamiliaPensao` em `src/services/contractTemplates.ts`), em vez do modelo genérico de 14 cláusulas por área. Cobre fixação/majoração de pensão alimentícia + guarda, até sentença em 1º grau.

O que muda por cliente/caso: dados do CONTRATANTE (Cláusula de qualificação) e os valores da Cláusula Segunda (honorários fixos — entrada + parcelas, vindos do parcelamento aceito na proposta) e da Cláusula Terceira (percentual de êxito, padrão 30% se a proposta não definir outro). O restante das 19 cláusulas é texto fixo do escritório e não deve ser reescrito caso a caso — inclusive a Cláusula Terceira, que cobra honorários de êxito **somente sobre as diferenças retroativas obtidas a maior**, nunca sobre o valor de pensão já pago ou sobre as parcelas futuras ordinárias.

Outras causas de família (divórcio, guarda isolada, inventário) continuam no modelo genérico por área.

### Contrato padrão fixo — Trabalhista (desde 07/10/2026)

Pedido: "Esse será nosso novo contrato". Toda proposta/contrato de área **trabalhista** (e **gestante**, que também é Justiça do Trabalho) usa uma minuta fixa de **22 cláusulas** (`buildTemplateTrabalhista` em `src/services/contractTemplates.ts`), no lugar do modelo genérico de 14 cláusulas. As outras áreas continuam com o modelo genérico, e família/pensão com o seu modelo próprio.

O que mudou em relação ao modelo genérico:
- **Objeto limitado ao 1º grau até a sentença.** Recurso, TRT/TST, liquidação e execução ficam de fora e exigem nova contratação.
- **Honorários de êxito** sobre o **proveito econômico bruto**, inclusive em acordo, pagamento espontâneo ou solução extrajudicial.
- **Sucumbência** é da advogada e **não abate** os honorários contratuais nem o êxito.
- **Retenção** dos honorários sobre o valor recebido em nome da cliente, com autorização expressa e **prestação de contas**.
- **Entrada não paga é descontada ao final do processo** junto com os honorários contratuais e de êxito (item 4.2). Essa regra existe só neste contrato.
- **Falta à audiência:** sai a multa de 20% sobre o valor da causa. Fica só o ressarcimento de **R$ 100,00** pelo ato frustrado, que não é cobrado se houver motivo comprovado.
- **Acordo direto:** sai a proibição de a cliente negociar. Ela pode decidir, deve avisar a advogada, e o êxito continua devido.
- **Rescisão:** honorários proporcionais e êxito posterior, na forma da Lei 8.906/94.
- **Dados bancários:** sem o campo "[Nº DA CONTA]" em branco. Só beneficiária, instituição e chaves PIX, e qualquer alteração é comunicada pelos canais oficiais.

**O que vem da proposta (o resto é texto fixo):**

| Item | Origem | Padrão quando a proposta não traz |
|---|---|---|
| Honorários iniciais | parcelamento aceito, ou valor do contrato, ou entrada/fixo | R$ 250,00 |
| Forma de pagamento da entrada | a do parcelamento | "na assinatura, por PIX/transferência" |
| % de êxito | campo êxito da proposta | 30% |
| % de cálculos | campo "Cálculos (contabilidade)" | 2% |

Os valores saem por extenso (`reaisPorExtenso`). Testes: `tests/contratoTrabalhistaTemplate.test.mjs`.

## Aviso de uso de IA nos contratos (desde 14/10/2026)

Todo contrato padrão gerado a partir de 14/10/2026 informa o cliente de que o escritório usa inteligência artificial como apoio, sempre com revisão e responsabilidade da advogada. A recomendação de transparência é da Recomendação 001/2024 do CFOAB. O texto é único (`AVISO_USO_IA` em `contractTemplates.ts`) e entra:
- no contrato trabalhista: item 14.4;
- no de pensão: parágrafo quarto da cláusula 13ª;
- no genérico: parágrafo único da cláusula 8ª;
- no de menor: parágrafo único da cláusula 9ª.

Contratos já gerados não mudam. Teste em `tests/contratoAvisoIa.test.mjs`.

## Impressão: rodapé e assinaturas (desde 07/10/2026)

Vale para todo documento impresso pelo CRM em papel timbrado (contrato, procuração, declaração etc., função `printDocs` em `public/app.js`):
- **Rodapé:** fica em uma linha só, encostado no fim da área da página. Cada página reserva 1,4 cm antes dele, então o texto muda de página antes de chegar ao rodapé e nada fica coberto. O PDF de tabelas (`printTablePDF`, como o A Receber) usa o mesmo rodapé.
- **Títulos de cláusula** não ficam sozinhos no pé da página.
- **Assinaturas:** com até 2 assinaturas (ex.: contratante e contratada), o fecho ("E, por estarem justas e contratadas…"), o local/data e as assinaturas formam **um bloco que não se divide**. Se não couber, o bloco inteiro vai para a página seguinte. Com 3 ou mais assinaturas, cada uma é um bloco indivisível separado.

Testes: `tests/impressaoRodapeAssinatura.test.mjs`.

## Proposta: percentual de cálculos da contabilidade (desde 07/10/2026)

Na **Produção da Proposta**, seção Honorários, há o campo **Cálculos (contabilidade)**: escolha de **1% a 5% sobre o valor dos proventos**, ou "Não cobrar". Fica gravado em `propostas.honorarios.taxa_calculos_pct`.

Quando escolhido, aparece **discriminado**:
- na **proposta** que o cliente abre: quadro próprio "Cálculos (contabilidade)" com o percentual e, embaixo da tabela, "Cálculos (contabilidade), sobre o valor dos proventos: X%";
- no **contrato** gerado a partir da proposta aceita (modelo geral, de menor e de pensão): "A CONTRATANTE pagará, ainda, o percentual de X% (por extenso) sobre o valor dos proventos recebidos, destinado ao custeio dos cálculos elaborados pela contabilidade."

Regra em `src/services/contractTemplates.ts` (`taxaCalculosPct`, `clausulaTaxaCalculos`); testes em `tests/taxaCalculos.test.mjs`. Valor fora de 1 a 5 é ignorado (não cobra).

## Excluir proposta criada errada (desde 07/10/2026)

Em **Propostas**, cada proposta não aceita tem o botão de lixeira na lista e **Excluir proposta** dentro do detalhe. Pede confirmação, porque não dá para desfazer: a proposta some e o link enviado ao cliente deixa de funcionar.

- **Proposta aceita não pode ser excluída**: ela já gerou contrato e parcelas no Financeiro. O botão nem aparece. Se foi erro, ajuste o contrato e as parcelas.
- Proposta com parcelas geradas também é bloqueada.
- Saem junto as visitas ao link (`proposta_visitas`). A exclusão fica registrada na jornada do lead/cliente (`journey_log`, evento `proposal_deleted`), com quem excluiu.

API: `DELETE /api/propostas/:id`. Regra em `src/services/excluirProposta.ts` (testes em `tests/excluirProposta.test.mjs`).

## FAQ

**Os colchetes `[assim]` num documento gerado por IA são um erro?** Não — é proposital. Marca exatamente o que a IA não conseguiu confirmar nos autos, pra você revisar antes de protocolar. Quantidade e exemplos aparecem antes de abrir o documento.

**Um documento gerado por template pode ter campo em branco?** Sim — se o dado não existir no cadastro do cliente/caso (ex.: profissão vazia), o marcador simplesmente vira texto vazio no documento final.

**Onde ficam os arquivos de verdade?** No MEGA (armazenamento externo), não no disco do servidor — o CRM guarda a referência e os metadados (pasta, status, cliente vinculado).

**Um card "Concluído" na esteira de produção significa que o caso foi arquivado?** Não — significa que a peça foi protocolada e o trabalho de redação terminou. O caso continua ativo, só passa a ser acompanhado pela esteira processual normal (Processos e prazos), não mais pela esteira de produção.

## Links relacionados
- [Clientes e cadastro](01-clientes.md) — dados usados no preenchimento automático
- [Dativo](05-dativo.md) — pastas específicas e upload por câmera
- [Leads e comercial](02-leads.md) — propostas comerciais geradas aqui

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 30/10/2026 | Claude | Juros da planilha desde cada desconto: critério confirmado pela Jessica |
| 30/10/2026 | Claude | Pasta do Drive do caso: lida sozinha a cada 30 min (com subpastas, só o que é novo); "Atualizar da pasta" em segundo plano com aviso no sino e o motivo quando o Google recusa; o caso vindo do e-mail já grava a pasta dos anexos no card |
| 30/10/2026 | Claude | Demonstrativo de descontos (PDF) por peça: contratos do réu (nº, RMC/RCC, banco, inclusão), o que já foi descontado mês a mês com a fonte e a base do valor da causa; salvo a cada versão da peça, na aba Cálculos da mesa e no kit da ação antes da planilha. O extrato original continua inteiro no protocolo |
| 30/10/2026 | Claude | Colar a peça revisada: vira o .docx no papel timbrado da Dra., na formatação das peças (Times 12, 1,5, recuo 2,5 cm, títulos centralizados, citação recuada, fecho preso à assinatura); "Baixar a peça (timbrado)"; a peça da equipe no kit também sai no timbrado |
| 30/10/2026 | Claude | Card do cliente: "Enviar a peça revisada (versão final)" em Word ou PDF (vai no kit como veio e deixa a ação pronta) e "Marcar a vN como final"; o kit baixa do Google Drive os documentos que só têm link; a leitura da pasta do Drive não reimporta documento renomeado |
| 30/10/2026 | Claude | Card único do cliente: cliente com 2+ ações antes do protocolo vira um card no quadro; a tela do cliente mostra o que trava (extrato de empréstimos do INSS), as ações por banco com a situação, o kit de protocolo (.zip com a peça em Word e os anexos renomeados, na ordem, fotos em PDF) e "Protocolar" uma a uma; documentos com nome padrão (migration 173); senha do Meu INSS sai da observação do card para o cofre |
| 28/10/2026 | Claude | Dr. Augusto (Calculista): planilha de cálculos da peça com correção (INPC/IPCA) e juros de mora (1% a.m./taxa legal) desde cada desconto, índices do Bacen guardados no banco (migration 172), .xlsx para anexar, aba Cálculos na mesa; o valor da causa usa a restituição atualizada |
| 28/10/2026 | Claude | Contratos nos documentos: todos os contratos lidos ficam no cliente (tipo e banco); na peça só entram os do banco do réu e da mesma tese, ou os que a Dra. associa na aba Caso da mesa; descontos seguem os contratos; dossiê mostra o que ficou fora |
| 22/10/2026 | Claude | Processo único: o quadro sugere juntar pedidos do mesmo cliente, banco e família de tese (cartão consignado; empréstimo consignado; empréstimo pessoal; cartão comum) e a Dra. confirma; a peça junta só o confirmado |
| 22/10/2026 | Claude | Mesa do caso abre no trabalho de cada etapa: aba Caso (relato, análise da Dra. Helena, resumo do protocolo), aba Documentos (checklist, coleta da Dra. Camila, envio de arquivos), parecer da revisão ao lado da peça |
| 22/10/2026 | Claude | Mesa do caso: card abre a tela cheia com régua de etapas, peça editável e formatável, versões da Dra. (a da equipe fica intacta), comparação, lições que viram regras, versão final e cópia para o Jusbrasil; recado ao cliente volta a salvar |
| 22/10/2026 | Claude | Esteira da petição inicial: Dra. Helena lê todas as fontes (inclusive WhatsApp), cálculos em código (indébito simples/dobro, juros, valor da causa), Cérebro escolhe pelo guia do cofre, peça conjunta por parte contrária, "Dossiê da peça"; busca de modelos sem o limite de 40 |
| 21/10/2026 | Claude | Quadro de produção na altura da tela, com rolagem lateral, roda descendo a coluna e arraste até a borda (relato da Dra.) |
| 21/10/2026 | Claude | Dra. Júlia (fundamentos conferidos no acervo de leis) na minuta, petição inicial, análise do caso e Assistente de IA; Dra. Vera (conferência das citações) no parecer de revisão |
| 19/10/2026 | Claude | Opções do contrato: sem profissão/e-mail não informados (sem colchetes) e sem declaração de hipossuficiência |
| 19/10/2026 | Claude | Contrato com mais de um contratante (ex.: casal), dados buscados na conversa, procuração e declaração individuais |
| 14/10/2026 | Claude | Aviso de uso de IA (`AVISO_USO_IA`) nos 4 contratos padrão: trabalhista 14.4, pensão § 4º da cl. 13ª, genérico § único da cl. 8ª, menor § único da cl. 9ª |
| 07/10/2026 | Claude | Novo contrato padrão trabalhista (22 cláusulas, `buildTemplateTrabalhista`), com a entrada não paga descontada ao final do processo; impressão com rodapé que não cobre o texto e assinaturas sempre juntas |
| 07/10/2026 | Claude | Excluir proposta criada errada (só as não aceitas) |
| 07/10/2026 | Claude | Proposta: campo "Cálculos (contabilidade)" de 1% a 5% sobre os proventos, discriminado na proposta e no contrato |
| 30/09/2026 | Claude | Revisão automática logo após gerar petição inicial e minuta da intimação; revisor não revisa mais o próprio parecer |
| 28/09/2026 | Claude | Selfie do signatário opcional por link (`signature_requests.require_selfie`, migration 137) — exigida pela advogada, obrigatória quando exigida, descartada quando não |
| 03/09/2026 | Claude | Criação do documento |
| 04/09/2026 | Claude | Adicionada seção "Esteira de produção" — corrige entendimento: "Concluído" é a peça protocolada, não o caso encerrado |
| 18/09/2026 | Claude | Novo padrão fixo de 19 cláusulas pra contratos de família/pensão alimentícia (`buildTemplateFamiliaPensao`), roteado automaticamente quando área = família e tipo de causa contém "pensão" |
| 23/09/2026 | Claude | Botão "Importar do Obsidian…" em Configurações — reimporta a biblioteca de modelos de peça sem terminal/SSH (antes só dava pra atualizar rodando o script manualmente; editar um modelo no Obsidian não chegava na IA sozinho) |

---
◀ [Dativo](05-dativo.md) · [Visão geral](00-visao-geral.md) · Próximo: [Agenda e compromissos](07-agenda.md) ▶
