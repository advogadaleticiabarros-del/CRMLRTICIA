# 02 · Leads e comercial

**Área:** Atendimento e captação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado

## TL;DR

Funil de captação com 12 etapas, cronômetro automático de primeira resposta, qualificação por IA, e uma regra dura: não dá pra perder um lead sem registrar o motivo. Perder ou recusar dispara mensagem automática de despedida por WhatsApp, uma única vez.

## Contexto

Consulte quando precisar entender uma etapa do funil, por que uma mensagem de recusa foi enviada, como funciona o cronômetro de resposta, ou o que acontece tecnicamente ao converter um lead em cliente.

## Etapas do funil (Kanban)

Novo Lead → Primeiro Contato → Atendimento Realizado → Documentação Pendente → Proposta Enviada → Negociação → **Contrato Assinado** (vira Convertido) ou **Proposta Recusada** / **Perdido**. Newsletter é uma etapa à parte, para quem só quer receber conteúdo.

## O que acontece quando um lead entra

1. Cadastro (nome, e-mail, telefone, origem, área jurídica, resumo do caso).
2. O escritório é **avisado automaticamente** (alerta interno) assim que o lead entra.
3. Se houver texto suficiente no resumo do caso (ou nas observações), a **IA qualifica sozinha**: sugere área jurídica, urgência e faixa de valor estimado — acontece em segundo plano, não trava o cadastro.

## Cronômetro de primeira resposta

O sistema mede quanto tempo o escritório demora pra responder um lead novo, por dois sinais (o que vier primeiro conta):

- o lead sai da etapa "Novo Lead" pela primeira vez; ou
- alguém clica em "Chamar no WhatsApp" no card do lead.

Só a **primeira** resposta é registrada — mudanças de etapa depois disso não reiniciam o cronômetro.

## Regra dos 7 dias em análise

Quando um lead entra em "Negociação" (proposta em análise), o sistema marca o início dessa fase — usado pra sinalizar quando uma negociação está parada há mais de 7 dias sem decisão.

## Perder um lead exige motivo

Mover um lead pra "Perdido" **exige** escolher um motivo de uma lista fixa (preço, sumiu, foi com outro escritório, desistiu, fora da área de atuação, sem perfil, outro) — não dá pra perder um lead sem registrar por quê.

## Mensagem automática ao recusar/perder

Mover um lead pra **"Proposta Recusada"** ou **"Perdido"** dispara, uma única vez, uma mensagem de despedida calorosa por WhatsApp (com pergunta sobre newsletter) — a mesma mensagem nos dois casos. Se havia uma proposta em aberto vinculada, ela também é marcada como recusada automaticamente, pra não ficar desalinhada com o funil. **Confirmado:** a mensagem só sai uma vez por movimentação — mover o lead de novo pra "Perdido" depois não reenvia (mas não há trava se alguém mover pra fora e pra dentro de novo manualmente, é best-effort).

## Virar cliente

Converter um lead em cliente cria um cadastro em Clientes (PF ou PJ) já com nome/e-mail/telefone/observações, marca o lead como "Convertido" e vincula os dois registros — o histórico de qualificação (RG, estado civil, profissão, resumo do caso) migra junto pra ficha do cliente. Um lead só pode ser convertido uma vez.

## Relação com Propostas

Cada lead pode ter propostas comerciais vinculadas (enviada, em negociação, aceita, recusada) — ver módulo de Documentos e peças para como uma proposta é gerada.

## FAQ

**Se eu mover um lead pra "Perdido" duas vezes, manda a mensagem duas vezes?** Não deveria — a mensagem dispara na transição pra "Perdido"/"Proposta Recusada". Mover pra fora e de volta manualmente pode disparar de novo (é best-effort, não há trava contra isso).

**A qualificação por IA é obrigatória?** Não — só roda automaticamente quando há texto suficiente (15+ caracteres) no resumo do caso ou nas observações. Sem isso, os campos de área/urgência/valor ficam vazios até preenchimento manual.

**Um lead pode voltar de "Perdido" pra ativo?** Sim, movendo manualmente pra qualquer outra etapa — o motivo de perda registrado fica como histórico, não é apagado.

## Links relacionados
- [Clientes e cadastro](01-clientes.md) — o que acontece ao converter
- [WhatsApp](03-whatsapp.md) — onde as mensagens automáticas de lead chegam
- [Documentos e peças](06-documentos.md) — como uma proposta comercial é gerada

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Clientes](01-clientes.md) · [Visão geral](00-visao-geral.md) · Próximo: [WhatsApp](03-whatsapp.md) ▶
