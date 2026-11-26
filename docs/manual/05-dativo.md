# 05 · Dativo

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 13/11/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Controle das nomeações da Defensoria (dativo), com detecção automática de nomeação e de valor arbitrado via DJEN, upload de documento por câmera com sugestão de pasta por IA, e projeção financeira separada porque o pagamento vem do Estado, não do cliente.

## Contexto

Consulte pra entender o ciclo de uma demanda dativa, como a detecção automática funciona (e o que fazer se duplicar), ou como o upload por câmera/financeiro do dativo se comporta.

## Status de uma demanda (caminho do pagamento)

Desde 13/11/2026 o status segue o caminho real do pagamento do Estado do ES:

| # | Status | Na tela | O que registra | Site |
|---|---|---|---|---|
| 1 | `nomeada` | Nomeação | nº do processo, data do aceite | — |
| 2 | `em_andamento` | Atuação | audiências, relatos | — |
| 3 | `concluida` | Atuação concluída — aguardando certidão | — | — |
| 4 | `aguardando_liberacao_requerimento` | Certidão emitida — cadastrar no e-Flow | data da certidão | [e-Flow](https://e-flow.es.gov.br/flow-definition/38c32372-13cd-8e0c-630e-b1eca22972a9) |
| 5 | `protocolada` | Protocolada — em análise no e-Docs | **código do protocolo** + data | [e-Docs](https://edocs.es.gov.br/) |
| 6 | `deferida` / `indeferida` | Deferida — aguardando lista da Sefaz / Indeferida | decisão, data e motivo (se indeferida) | e-Docs |
| 7 | `a_receber` | Na lista da Sefaz — disponível para saque | data e nº da lista | [Sefaz (OPV dativos)](https://sefaz.es.gov.br/obrigacoes-de-pequeno-valor-opv-dativos) |
| 8 | `paga` | Recebida | baixa com o valor (cria o recebimento) | — |

**Avanço automático:** preencher um passo na ficha e salvar leva a demanda para a etapa dele (data da certidão → 4; protocolo → 5; decisão → 6; lista da Sefaz → 7). Nunca volta etapa sozinho e nunca mexe em `paga` ou `recusada`; a etapa escolhida à mão vale como ponto de partida. A regra fica em `src/services/fluxoPagamentoDativo.ts` (fonte única das etapas, rótulos e links).

**Na tela:** os três sites ficam no topo da Advocacia Dativa. A ficha mostra a faixa com as 8 etapas, o próximo passo, há quantos dias está parada e o botão do site certo; na etapa 5 tem "Copiar protocolo" (para colar na busca do e-Docs) e na 7, "Recebi no banco — dar baixa" (valor arbitrado, senão o estimado). A aba Projeção tem o quadro **Caminho do pagamento**, com as demandas de cada etapa da certidão em diante (`GET /api/dative/fluxo-pagamento`).

**Aba Recebimentos (desde 23/11/2026):** no topo, o bloco "Na lista da Sefaz — disponível para saque" mostra as mesmas demandas da coluna 7 do quadro (assistido, comarca, protocolo e valor arbitrado, ou o estimado), com total e os botões **Dar baixa** (mesmo "Recebi no banco" da ficha: cria o recebimento com a data de hoje e a demanda vira Recebida) e **Abrir**. Abaixo continua o histórico de recebimentos lançados.

**Dinheiro:** `protocolada` e `deferida` contam no "Realizado (a faturar)" desta tela; `indeferida` sai do estimado e das demandas ativas até ser revertida. **No Financeiro (A Receber), desde 16/11/2026, só entra a demanda em `a_receber` (na lista da Sefaz)**: "disponível para recebimento", sem data, acumulada até a baixa (ver [Cobrança](08-cobranca.md)).

**Demandas antigas:** `a_receber` antes significava "procedimento aberto, dinheiro não caiu"; agora é "saiu na lista". As demandas que já estavam em `a_receber` ou em `aguardando_liberacao_requerimento` continuam onde estavam e precisam ser conferidas à mão (registrar o protocolo leva para a etapa certa).

Histórico do status anterior:

**`aguardando_liberacao_requerimento` (desde 25/09/2026):** a nomeação/ato terminou (o honorário pode ou não já ter sido arbitrado), mas o requerimento de pagamento ainda não foi registrado — por isso ainda não dá pra nem solicitar o pagamento. Só depois do requerimento registrado é que a demanda avança pra `a_receber` (procedimento de recebimento já aberto, dinheiro ainda não caiu). Antes desse status existir, não tinha como marcar esse meio-do-caminho: ou ficava em `concluida` (perdendo a informação de que já podia avançar) ou pulava direto pra `a_receber` (informação incorreta de que o requerimento já tinha sido protocolado).

Existe também `recusada`, fora dessa linha principal — usado quando a nomeação (detectada automaticamente ou cadastrada à mão) é recusada. Diferente dos demais, não dá pra setar `recusada` editando o campo Status direto: é preciso usar o botão **Recusar nomeação** na tela de detalhe, que exige o motivo (obrigatório) e trava o status — só sai revertendo pelo botão **Reverter recusa**, que devolve o status anterior à recusa. Isso preserva o histórico de nomeações recusadas e o motivo de cada uma, em vez de excluir a demanda. Uma demanda recusada não entra em nenhum total financeiro do dativo (estimado, a receber, por comarca/mês) nem conta como demanda ativa.

## Detecção automática

Quando a varredura por OAB (DJEN) encontra uma decisão de nomeação dativa (reconhece o padrão "nomeio... dativa" no texto), o sistema:

1. Confere se esse processo **já não está cadastrado** — comparação só pelos dígitos do número (ignora pontuação), pra não duplicar quando o mesmo processo foi cadastrado manualmente com formatação e o DJEN manda sem formatação.
2. Se for novo, extrai por IA juízo, vara, qualificação da parte, assunto e comarca a partir do texto da decisão, e já cadastra a demanda.
3. Avisa o escritório por WhatsApp: "você foi nomeada novamente" + processo + comarca + assistido(a), quando identificáveis.

Da mesma forma, quando uma decisão **arbitra o valor dos honorários** (evento separado, publicado depois da nomeação), o sistema detecta o valor em R$ e atualiza a demanda automaticamente — avisando por WhatsApp também.

## Completar dados com um clique

Uma demanda com processo vinculado ao monitoramento pode puxar as últimas movimentações e extrair (por IA) juízo, vara, número da decisão, qualificação da parte, assunto e comarca — só preenche o que ainda está vazio, nunca sobrescreve o que já foi digitado à mão.

## Upload de documentos por câmera

Documentos físicos (1 a 10 páginas) podem ser fotografados direto pelo celular, em lote, e combinados automaticamente num único PDF — sem precisar tirar foto página por página e depois montar o arquivo manualmente. A IA sugere a pasta certa (nomeação, certidão de audiência, comprovante de atuação, outros) a partir da foto, você só confirma.

## Audiências

Na ficha da demanda, as seções **Relatos** e **Audiências** têm o botão **+ Incluir**: o relato é registrado ali mesmo e a audiência já nasce ligada àquela demanda (com a comarca preenchida), sem escolher numa lista. Os documentos são anexados na seção **Documentos** logo abaixo.

Audiências da demanda dativa sincronizam automaticamente com o Google Calendar (mesmo mecanismo usado nas audiências de correspondente) — mudar o status (agendada/realizada/adiada/cancelada) atualiza a cor do evento na agenda.

## Financeiro do dativo

Pagamentos previstos e recebidos ficam vinculados à demanda. A tela de resumo mostra a **projeção financeira do Estado** — quanto está previsto/a receber nos próximos 90 dias — separada do financeiro normal do escritório, porque o pagamento dativo vem do Estado, não do cliente.

## Levar pra produção de peças

Uma demanda dativa pode ser movida pra esteira de produção (gera um caso normal, usando o mesmo cliente já vinculado) quando chega a hora de redigir uma peça — não duplica o cliente.

## Lista ou kanban por fase

Desde 16/11/2026 a aba **Demandas** tem, no fim da barra de filtros, o seletor **Lista | Kanban por fase**. A lista continua igual. O kanban mostra uma coluna por fase (as 8 do caminho do pagamento e a Indeferida, sempre; Recusada só quando tem demanda), com a quantidade e a soma do estimado no topo. Cada card traz assistido, comarca, assunto, número do processo, protocolo e valor, e abre a ficha no clique. Os filtros (etapa, busca, comarca, protocolo, período) valem nas duas vistas. A escolha fica lembrada no navegador. No kanban, "Exportar CSV/PDF" não acha tabela: volte para a lista para exportar.

### Mover o card de etapa (arrastar)

Desde 16/11/2026, no **Kanban por fase** (aba Demandas) e no quadro **Caminho do pagamento** (aba Projeção), dá para **arrastar o card para outra coluna** e a demanda muda de etapa na hora. Vale para frente e para trás (serve para corrigir), e os dados da ficha (protocolo, datas, decisão) continuam guardados.

- **Não dá para arrastar para "Recebida"**: use "Recebi no banco — dar baixa" na ficha, que registra o pagamento.
- **Não dá para arrastar para "Recusada"**: use "Recusar" na ficha, que pede o motivo. Cards já recebidos ou recusados não se arrastam.
- **Cuidado ao voltar uma etapa:** se a ficha tiver, por exemplo, o protocolo preenchido e você arrastar o card para antes de "Protocolada", na próxima vez que **salvar a ficha** ela volta sozinha para "Protocolada" (regra do "só avança" ao preencher). Para voltar de vez, apague o campo na ficha.
- Rota: `PATCH /api/dative/cases/:id/etapa` (`{ status }`); regra em `validarMovimentoNoQuadro` (`src/services/fluxoPagamentoDativo.ts`). Arrastar funciona com mouse; no celular, mude a etapa pela ficha (Editar).

### Link de consulta do protocolo (desde 26/11/2026)
- Logo abaixo de "Protocolo do e-Flow (código)" fica o campo **Link de consulta (sai junto com o protocolo)**: cole ali o endereço de consulta direta que o e-Flow devolve com o código (ex.: `https://e-docs.es.gov.br/e/2026-XXXXXX`).
- Com o link salvo, a faixa do caminho do pagamento mostra o botão **Consultar protocolo ↗**, que abre a consulta numa aba nova.
- Colou o link com o código vazio: o código é tirado do final do link sozinho (e, como o protocolo foi preenchido, a data do protocolo vira hoje se estiver vazia).
- Só aceita endereço completo começando com `http://` ou `https://`, até 500 caracteres; vazio apaga. Coluna `dative_cases.eflow_link` (migration 191); regra em `validarCamposFluxo` (`src/services/fluxoPagamentoDativo.ts`). O link sozinho não muda a etapa: quem avança para "Protocolada" é o código.

## Buscar e filtrar demandas

Desde 16/11/2026 a lista tem também o campo **Buscar por protocolo**: acha pelo protocolo do e-Flow, inteiro ou só um pedaço, em maiúscula ou minúscula, com ou sem hífen ("2026-c35xph", "C35XPH"). A regra fica em `filtroProtocoloDativo` (`src/services/buscaDativo.ts`), parâmetro `protocolo` em `GET /api/dative/cases`.

Desde 25/09/2026, a listagem de demandas dativas tem busca por **nome do assistido (representado)** e filtro por **comarca**, além do filtro por status já existente — antes só dava pra filtrar por status, e achar uma demanda específica exigia rolar a lista inteira ou usar Ctrl+F no navegador.

Desde 16/11/2026 o mesmo campo ("Buscar por assistido ou número do processo…") também acha pelo **número do processo**, digitado com ou sem pontuação (`5001234-56.2025.8.08.0024` ou `50012345620258080024`), inteiro ou só um trecho a partir de 4 dígitos. A comparação usa só os dígitos, dos dois lados (regra em `src/services/buscaDativo.ts`).

## FAQ

**Uma demanda dativa duplicada pode acontecer?** Já aconteceu (bug corrigido em 03/09/2026) — a comparação de número de processo antes era exata, e um cadastro manual formatado (`0000000-00.0000.8.08.0000`) não batia com o número sem formatação que o DJEN manda. Hoje a comparação ignora pontuação.

**Preciso excluir manualmente uma demanda duplicada se acontecer de novo?** Sim, não há limpeza automática retroativa — exclua a duplicata manualmente (dá pra saber qual é a automática pelo campo "origem": manual × auto_djen).

**A demanda dativa sempre tem cliente vinculado?** Não necessariamente — quando descoberta automaticamente sem nome de parte identificável com segurança, fica sem vínculo até revisão manual.

## Links relacionados
- [Processos e prazos](04-processos.md) — mecanismo de detecção por trás
- [Documentos e peças](06-documentos.md) — upload e organização de documentos
- [Agenda e compromissos](07-agenda.md) — sincronização de audiência

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 26/11/2026 | Claude | Campo "Link de consulta" do protocolo na ficha (migration 191) e botão "Consultar protocolo ↗" no caminho do pagamento |
| 23/11/2026 | Claude | Aba Recebimentos mostra no topo as demandas "Na lista da Sefaz — disponível para saque", com Dar baixa e Abrir na linha |
| 16/11/2026 | Claude | Arrastar o card para mudar a etapa, no Kanban por fase e no Caminho do pagamento (`PATCH /api/dative/cases/:id/etapa`); coluna Indeferida sempre visível nos dois quadros |
| 16/11/2026 | Claude | Aba Demandas: seletor Lista ou Kanban por fase (uma coluna por fase, mesmos filtros; a lista não mudou) |
| 16/11/2026 | Claude | Campo "Buscar por protocolo" na lista de demandas (protocolo do e-Flow, sem diferenciar maiúscula nem hífen) |
| 16/11/2026 | Claude | Busca das demandas acha também pelo número do processo, com ou sem pontuação (parâmetro `busca` em `GET /api/dative/cases`) |
| 16/11/2026 | Claude | No Financeiro, o dativo só aparece depois de sair na lista da Sefaz, como "disponível para recebimento", sem data e acumulado até a baixa |
| 13/11/2026 | Claude | Caminho do pagamento: etapas `protocolada`, `deferida`, `indeferida` e campos de aceite, certidão, protocolo do e-Flow, decisão do e-Docs e lista da Sefaz (migration 179); avanço automático da etapa; links do e-Flow, e-Docs e Sefaz no topo; faixa de etapas e baixa na ficha; quadro na Projeção. A ficha não mostra mais o seletor de etapa em demanda recusada (salvar podia trocá-la para "Nomeada") |
| 13/11/2026 | Claude | Ficha da demanda: botões "+ Incluir relato" e "+ Incluir audiência" nas próprias seções; a audiência já vem ligada à demanda aberta |
| 26/10/2026 | Claude | Menor em segredo de justiça vem como "REPRESENTANTE e B. F. S. C." (iniciais de um ou mais assistidos): a ficha é do representante, as iniciais ficam só no assistido da demanda e entra na linha do tempo a nota "Segredo de justiça". Só iniciais, sem representante: aviso pedindo o nome dele. Antes dava erro 500 (ver runbook) |
| 16/10/2026 | Claude | Corrigido: editar audiência pela ficha da demanda não salvava (duas funções com o mesmo nome e parâmetros trocados; ver runbook). Agora edita demanda, data, tipo, comarca, valor, status e observações |
| 25/09/2026 | Claude | Busca por nome do assistido + filtro por comarca na listagem de demandas; novo status `aguardando_liberacao_requerimento` entre `concluida` e `a_receber` (migration 135) |
| 20/09/2026 | Claude | Adicionado status `recusada` (motivo obrigatório, reversível) — `POST /api/dative/cases/:id/reject` e `/reject/revert`; recusada some dos totais financeiros e de "demandas ativas"; filtro por status na listagem agora inclui Recusada |
| 03/09/2026 | Claude | Criação do documento; registrada a correção de duplicidade por comparação de número de processo |

---
◀ [Processos e prazos](04-processos.md) · [Visão geral](00-visao-geral.md) · Próximo: [Documentos e peças](06-documentos.md) ▶

> **Regra (02/10/2026):** a **data da nomeação é obrigatória** ao criar ou editar uma demanda dativa. Sem ela o sistema avisa "Informe a data da nomeação"; antes aparecia "Erro interno do servidor".
