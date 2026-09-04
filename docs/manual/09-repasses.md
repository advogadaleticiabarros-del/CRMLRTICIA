# 09 · Repasses e parcerias

**Área:** Financeiro · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Três relações comerciais diferentes com terceiros: correspondente jurídico (Letícia atuando pra outro escritório), parceiros (indicação/co-atuação, com login e split próprio) e repasses (dinheiro saindo pra quem indicou/atuou). Separado do financeiro normal pra não contar duas vezes.

## Contexto

Consulte pra entender a diferença entre correspondente, parceiro e repasse, ou o que um parceiro enxerga no portal dele.

## Correspondente jurídico

Quando a Dra. Letícia atua **como correspondente** — indo a uma audiência a pedido de outro advogado/escritório, como advogada ou preposta —, isso é acompanhado à parte do restante do caixa: quem pediu (o "pagador"), o valor combinado, e um status próprio (agendada → realizada → faturada → paga → cancelada). A audiência sincroniza com a agenda/Google Calendar automaticamente, igual às audiências normais e do Dativo.

## Parceiros (indicação/co-atuação)

Um **parceiro** é alguém (outro advogado ou escritório) que indica clientes ou atua junto em um caso, com um percentual de divisão combinado: honorário de êxito, percentual do parceiro e percentual de sucumbência, cada um pode ter seu próprio valor combinado. Parceiros têm **login próprio** (portal do parceiro) e enxergam só o que é deles: casos em andamento, pendências da produção da peça, valores a receber — nunca os dados de outros clientes/parceiros.

## Repasses

Quando o dinheiro precisa ser **repassado pra fora** (pra quem indicou, por uma audiência feita por correspondente, por diligência) — quatro tipos: indicação, audiência, correspondente, diligência. Status: pendente → processando → repassado (ou cancelado). Cada repasse pode estar ligado a um caso específico, com data de vencimento e histórico de auditoria financeira igual às parcelas.

## Por que separado do financeiro normal

Manter isso em módulos próprios (em vez de misturar com as parcelas dos seus próprios clientes) evita contar duas vezes: dinheiro que passa pelo caixa mas não é honorário do escritório, ou honorário do escritório que já nasce comprometido com um repasse.

## FAQ

**Um parceiro vê os dados de outros clientes do escritório?** Não — o portal do parceiro é restrito ao que é dele: casos, pendências e valores próprios, nada de outros clientes/parceiros.

**Correspondente e repasse são a mesma coisa?** Não — correspondente é quando a Letícia é quem presta o serviço pra outro escritório (dinheiro entra). Repasse tipo "correspondente" é o caso inverso: quando outro profissional presta serviço pra ela e o dinheiro sai.

## Links relacionados
- [Cobrança e parcelas](08-cobranca.md) — projeção de caixa inclui essas frentes
- [Agenda e compromissos](07-agenda.md) — audiências de correspondente sincronizadas
- [Usuários e acesso](12-usuarios.md) — perfil `parceiro`/`parceiro_portal`

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Cobrança e parcelas](08-cobranca.md) · [Visão geral](00-visao-geral.md) · Próximo: [Monitoramento automático](10-monitoramento.md) ▶
