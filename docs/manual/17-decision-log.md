# 17 · Decision Log

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte, commits e conversas) · **Última atualização:** 04/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** adicionar uma linha a cada decisão não óbvia de arquitetura/produto — nunca reescrever uma entrada antiga, só adicionar uma nova se a decisão mudar

## TL;DR

Registro cronológico de decisões que não são óbvias só lendo o código — o "por quê" por trás de escolhas de arquitetura e de produto, pra ninguém perder tempo revertendo algo que já foi decidido de propósito.

## Contexto

Consulte antes de "corrigir" algo que parece estranho à primeira vista — pode ser uma decisão deliberada, não um descuido. Também consulte pra entender por que o sistema é do jeito que é, não só o que ele faz.

## Regra desta página

Nunca editar uma entrada antiga pra "consertar" — se uma decisão mudou, adiciona uma entrada nova referenciando a antiga. O log é a história real, não uma versão final polida.

## Registro

### 04/09/2026 — Documentação passa a ser mantida automaticamente, sem precisar pedir
**Decisão:** toda mudança de comportamento, correção de bug real ou troca de integração atualiza `docs/manual/` na mesma tarefa — virou regra do `CLAUDE.md`, não depende de a usuária lembrar de pedir.
**Motivo:** o mesmo dia já tinha mostrado o risco de "documentação/aviso que só existe se alguém lembrar" (ver entrada do Railway abaixo) — a usuária decidiu que o mesmo problema não podia se repetir com a documentação em si.

### 03/09/2026 — Railway desligado; VPS Hostinger é a única produção
**Decisão:** parar (`railway down`) e depois autorizar a exclusão do projeto Railway, que hospedava o sistema até 21/08/2026.
**Motivo:** a migração pra VPS já tinha acontecido, mas o Railway continuou de pé — seu trial expirou silenciosamente, bloqueando deploy novo sem aviso, e mesmo assim seus robôs internos continuaram rodando contra um banco separado, chegando a duplicar um aviso real (fechamento do dia enviado duas vezes).
**Alternativa considerada:** manter o Railway como "backup" — descartada, porque um ambiente parado que ninguém desliga de propósito é exatamente o que causou o problema.

### 03/09/2026 — GitHub Actions substitui o webhook automático do Railway
**Decisão:** deploy passou a ser um workflow explícito (`.github/workflows/deploy.yml`), visível na aba Actions do GitHub, em vez de um webhook automático de plataforma.
**Motivo (comentário original no arquivo):** "o webhook automático do Railway... quebrava com frequência, sem aviso — várias vezes um push ficava dias sem ir pro ar sem ninguém perceber." Com o workflow, dá pra ver se o deploy rodou e se falhou.
**Reforçado em 04/09/2026:** adicionada uma 3ª tentativa de deploy depois de um cluster de 3 falhas por instabilidade de rede na mesma noite — mesma filosofia (visibilidade e resiliência > confiar cegamente numa plataforma).

### 03/09/2026 — Aviso de marco processual: 1 por processo, para sempre (não por dia/semana)
**Decisão:** cada processo manda no máximo um aviso de WhatsApp de "Sentença publicada"/"Acórdão publicado" na vida inteira dele, não um limite por período de tempo.
**Motivo:** o problema era duplicidade do mesmo evento (fontes diferentes captando a mesma decisão), não excesso de eventos genuinamente diferentes. Um limite por processo+tipo resolve isso sem esconder um evento novo de verdade.
**Trade-off aceito:** no caso raro de duas sentenças reais no mesmo processo (ex.: anulação e nova sentença), a segunda não gera aviso automático — fica visível só na tela de Processos. Aceito porque é um caso raro e o custo de errar pro outro lado (spam) é maior.

### 03/09/2026 — Financeiro do Dativo é separado do financeiro normal do escritório
**Decisão:** pagamentos de demanda dativa (nomeação da Defensoria) vivem numa projeção financeira própria, não misturados com parcelas de cliente.
**Motivo:** o pagamento dativo vem do Estado, não do cliente — misturar os dois faria a projeção de caixa do escritório e a expectativa de recebimento do Estado parecerem a mesma coisa, quando têm prazos, confiabilidade e origem completamente diferentes.

### Data original não registrada — Correspondente jurídico e Repasses são módulos próprios, não "financeiro genérico"
**Decisão:** dinheiro de correspondente (Letícia atuando pra outro escritório) e de repasse (dinheiro saindo pra quem indicou/atuou) ficam em tabelas e telas dedicadas, não dentro do financeiro de cliente.
**Motivo (inferido do desenho do sistema, ver [Repasses e parcerias](09-repasses.md)):** evita contar duas vezes — dinheiro que passa pelo caixa mas não é honorário do escritório, ou honorário que já nasce comprometido com repasse.

### Data original não registrada — Documentos ficam no MEGA, não em disco do servidor
**Decisão:** todo documento do GED é armazenado numa conta MEGA externa, referenciada pelo CRM, nunca salvo localmente na VPS.
**Motivo (inferido):** desacopla o crescimento de armazenamento de documentos da capacidade de disco do servidor de aplicação, e mantém os arquivos recuperáveis independente do servidor estar de pé.

### 03/09/2026 — Uazapi é o único provedor de WhatsApp; skill "whatsapp" (Green API) descartada
**Decisão:** ao encontrar uma skill instalada chamada `whatsapp` (automação via Green API/WAHA), decidiu-se **não usar** — não é a integração que o CRM usa.
**Motivo:** o CRM já tem uma integração real e funcional com Uazapi, profundamente integrada (WhatsApp-instance, webhooks, health panel). Trocar ou adicionar um segundo provedor sem necessidade criaria confusão e risco, sem ganho.

## FAQ

**Uma decisão registrada aqui pode ser revertida?** Sim — decisões de produto não são imutáveis. Só não edite a entrada antiga: adicione uma nova, datada, explicando a mudança.

**Por que algumas entradas dizem "data original não registrada"?** Porque a decisão já existia no desenho do sistema antes deste log existir (criado em 04/09/2026) — o log não reescreve o passado que não presenciou, só marca honestamente o que é inferido do código versus o que foi observado ao vivo.

## Links relacionados
- [Onde tudo roda](13-infraestrutura.md)
- [Runbook](14-runbook.md)
- [Repasses e parcerias](09-repasses.md)
- [Dativo](05-dativo.md)

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 04/09/2026 | Claude | Criação do documento — 8 decisões registradas |

---
◀ [Ferramentas e acessos](16-ferramentas-acessos.md) · [Visão geral](00-visao-geral.md)

**Fim da documentação — 17 de 17 blocos completos.**
