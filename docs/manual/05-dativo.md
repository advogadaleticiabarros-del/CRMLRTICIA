# 05 · Dativo

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Controle das nomeações da Defensoria (dativo), com detecção automática de nomeação e de valor arbitrado via DJEN, upload de documento por câmera com sugestão de pasta por IA, e projeção financeira separada porque o pagamento vem do Estado, não do cliente.

## Contexto

Consulte pra entender o ciclo de uma demanda dativa, como a detecção automática funciona (e o que fazer se duplicar), ou como o upload por câmera/financeiro do dativo se comporta.

## Status de uma demanda

`nomeada` → `em_andamento` → `concluida` → `a_receber` → `paga`.

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

Audiências da demanda dativa sincronizam automaticamente com o Google Calendar (mesmo mecanismo usado nas audiências de correspondente) — mudar o status (agendada/realizada/adiada/cancelada) atualiza a cor do evento na agenda.

## Financeiro do dativo

Pagamentos previstos e recebidos ficam vinculados à demanda. A tela de resumo mostra a **projeção financeira do Estado** — quanto está previsto/a receber nos próximos 90 dias — separada do financeiro normal do escritório, porque o pagamento dativo vem do Estado, não do cliente.

## Levar pra produção de peças

Uma demanda dativa pode ser movida pra esteira de produção (gera um caso normal, usando o mesmo cliente já vinculado) quando chega a hora de redigir uma peça — não duplica o cliente.

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
| 03/09/2026 | Claude | Criação do documento; registrada a correção de duplicidade por comparação de número de processo |

---
◀ [Processos e prazos](04-processos.md) · [Visão geral](00-visao-geral.md) · Próximo: [Documentos e peças](06-documentos.md) ▶
