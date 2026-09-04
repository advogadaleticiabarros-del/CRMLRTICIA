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
17. Decision Log — ainda não escrito

## FAQ

**Essa documentação é gerada automaticamente ou alguém escreveu?** Foi escrita lendo o código-fonte real do sistema (rotas, regras de negócio, banco de dados) — não é um chute nem um template genérico preenchido. Cada afirmação aqui corresponde a um comportamento que existe de fato no CRM em 03/09/2026.

**E se o sistema mudar depois de hoje?** Desde 04/09/2026, atualizar a documentação faz parte de terminar qualquer tarefa neste repositório (regra em `CLAUDE.md`) — não precisa mais pedir separadamente. Mesmo assim, trate a data de "última atualização" de cada arquivo como referência de confiança, e avise se notar algo desatualizado.

**Onde vejo isso de um jeito mais bonito de ler?** No link do artefato publicado (peça pra Claude te passar de novo se perdeu) — mesmo conteúdo, com menu lateral e navegação por clique.

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento — visão geral e mapa dos 13 blocos |
| 04/09/2026 | Claude | Adicionados fluxograma, Runbook, Onboarding e Ferramentas/acessos; documentação auto-mantida virou regra do projeto (CLAUDE.md) |

---
Próximo: [Clientes e cadastro](01-clientes.md) ▶
