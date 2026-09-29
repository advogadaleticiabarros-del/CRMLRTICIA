# Documentação do CRM Jurídico — Visão geral

**Área:** Visão geral · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

> Documentação viva, escrita em blocos. Cada arquivo desta pasta cobre uma área do sistema. Versão web (mais fácil de ler, com navegação lateral): link compartilhado nas conversas — o conteúdo aqui é a fonte de verdade, sempre atualizado junto.

## TL;DR

O CRM Jurídico é o sistema único que roda toda a operação da Advocacia Letícia Barros — captação, atendimento, processos, dativo, financeiro e documentos, tudo integrado. Esta pasta documenta cada módulo em blocos separados, na ordem em que um caso realmente acontece.

## O que é este sistema

O CRM Jurídico é o sistema onde toda a operação do escritório da Dra. Letícia Barros acontece: da captação de um lead até o recebimento do honorário, passando pelo acompanhamento de processo, atendimento no WhatsApp e nomeações da Defensoria (Dativo). Foi construído sob medida para a prática solo dela — não é um CRM genérico adaptado.

Hoje roda para **1 advogada + 1 assistente** (Jessica), com uma camada de acesso separada para **correspondentes e parceiros** via portal próprio.

## Números atuais (levantado em 03/09/2026)

| Métrica | Valor |
|---|---|
| Clientes cadastrados | 177 |
| Processos (cases) | 41 |
| Demandas dativas | 24 |
| Leads no funil | 15 |
| Mensagens de WhatsApp | 2.739+ |
| Documentos guardados (MEGA) | 434 |

Estes números crescem todo dia — tratem como referência de escala, não contagem exata.

## Mapa dos módulos

Ordem de leitura recomendada (segue a jornada real de um caso: do primeiro contato ao fechamento, depois a operação interna, depois a base técnica):

0. [Fluxograma do sistema](00b-fluxograma.md)
0. [Dashboard (Cockpit e demais painéis)](00c-dashboard.md)
1. [Clientes e cadastro](01-clientes.md)
2. [Leads e comercial](02-leads.md)
3. [WhatsApp](03-whatsapp.md)
4. [Processos e prazos](04-processos.md)
5. [Dativo](05-dativo.md)
6. [Documentos e peças](06-documentos.md)
7. [Agenda e compromissos](07-agenda.md)
8. [Cobrança e parcelas](08-cobranca.md)
9. [Repasses e parcerias](09-repasses.md)
10. [Monitoramento automático](10-monitoramento.md)
11. [Briefing diário](11-briefing.md)
12. [Usuários e acesso](12-usuarios.md)
13. [Onde tudo roda (infraestrutura)](13-infraestrutura.md)
14. [Runbook — o que fazer quando algo quebra](14-runbook.md)
15. [Onboarding](15-onboarding.md)
16. [Ferramentas e acessos](16-ferramentas-acessos.md)
17. [Decision Log](17-decision-log.md)

## Busca global no celular ("assistente de bolso")

Desde 29/09/2026, a barra de abas do celular tem um botão **Buscar** — de qualquer tela, abre uma busca única que mostra **cliente OU processo** juntos, com a **última movimentação** de cada processo já na lista (sem precisar abrir a ficha). No computador, o mesmo atalho abre com **Cmd/Ctrl+K**. Toque no resultado abre a ficha direto (cliente) ou o detalhe do processo. A última movimentação usa a mais recente entre o que foi lançado manualmente e o que o monitoramento automático captou — o que for mais novo. Só aparece pra quem tem acesso a Clientes/Processos (não aparece no portal do cliente/parceiro).

**Corrigido em 29/09/2026 (relato real — busca lenta, resultado só com o nome):** a busca ficou mais rápida (o "contém, em qualquer posição" não usa índice do banco; agora tenta primeiro o começo do nome/processo, que é indexado) e mais confiável (uma resposta antiga não sobrescreve mais uma mais nova, se a rede oscilar). Cada resultado agora mostra telefone/CPF (cliente) ou última movimentação (processo) direto na lista, com uma seta indicando que dá pra tocar — tocar sempre abre a ficha completa.

## Barra de abas do celular reorganizada

Desde 29/09/2026, a barra de abas do celular (equipe do escritório) é: **Início, Prazos, Clientes, Buscar, Mais** — decisão da Dra. Letícia, que confirmou querer sempre à mão o resumo do dia, os prazos e a busca de cliente/processo. Processos, WhatsApp, Financeiro, Dativo e o resto continuam a 1 toque em "Mais" (o mesmo menu completo, não ficaram escondidos, só saíram da barra fixa — ela pediu explicitamente acesso a tudo, só não precisa disso sempre visível). Segue o padrão da Apple de no máximo 5 abas fixas.

## FAQ

**Essa documentação é gerada automaticamente ou alguém escreveu?** Foi escrita lendo o código-fonte real do sistema (rotas, regras de negócio, banco de dados) — não é um chute nem um template genérico preenchido. Cada afirmação aqui corresponde a um comportamento que existe de fato no CRM em 03/09/2026.

**E se o sistema mudar depois de hoje?** Desde 04/09/2026, atualizar a documentação faz parte de terminar qualquer tarefa neste repositório (regra em `CLAUDE.md`) — não precisa mais pedir separadamente. Mesmo assim, trate a data de "última atualização" de cada arquivo como referência de confiança, e avise se notar algo desatualizado.

**Onde vejo isso de um jeito mais bonito de ler?** No link do artefato publicado (peça pra Claude te passar de novo se perdeu) — mesmo conteúdo, com menu lateral e navegação por clique.

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento — visão geral e mapa dos 13 blocos |
| 04/09/2026 | Claude | Adicionados fluxograma, Runbook, Onboarding e Ferramentas/acessos; documentação auto-mantida virou regra do projeto (CLAUDE.md) |
| 04/09/2026 | Claude | Adicionado Decision Log (bloco 17) — documentação completa, 17 de 17 blocos |
| 29/09/2026 | Claude | Busca global mais rápida (prioriza prefixo indexado) e mais informativa (telefone/CPF e última movimentação já na lista, resultado antigo não sobrescreve mais o novo) — relato real da Dra. Letícia |
| 29/09/2026 | Claude | Busca global no celular ("assistente de bolso", `GET /api/busca`, Cmd/Ctrl+K no computador) e barra de abas do celular reorganizada (Início/Prazos/Clientes/Buscar/Mais) — 1ª etapa do redesenho mobile pedido pela Dra. Letícia |
| 22/09/2026 | Claude | Adicionado Dashboard (bloco 00c) — auditoria completa dos 8 painéis, 19 blocos no total |

---
Próximo: [Clientes e cadastro](01-clientes.md) ▶
