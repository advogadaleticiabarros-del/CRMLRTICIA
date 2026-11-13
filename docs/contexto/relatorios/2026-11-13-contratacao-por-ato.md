# Contratação por ato: contrato do ato + procuração (13/11/2026)

## Pedido
Jessica: "às vezes pego demanda de clientes por Ato, que só sai contrato para o Ato + Procuração".

## Feito
- Minuta nova `buildTemplatePorAto` (`src/services/contractTemplates.ts`), com 8 cláusulas:
  - objeto: só o ato; outros atos, fases e o acompanhamento ficam de fora (nova contratação);
  - honorários: valor fixo por extenso e forma de pagamento. São devidos mesmo se o ato não acontecer por fato alheio à advogada, e a nova data do mesmo ato não gera cobrança a mais;
  - atraso, sucumbência, despesas, LGPD + aviso de IA, canais oficiais/conta, título executivo e foro;
  - sem êxito e sem declaração.
- `ehContratacaoPorAto`: a proposta só com "Diligência / atos isolados" (sem êxito, fixo ou parcelamento) é por ato. `buildTemplate` usa a minuta por ato quando `porAto` é verdadeiro ou, sem escolha, quando a proposta é por ato.
- Declaração de hipossuficiência deixa de ser gerada no aceite da proposta (`propostas-public.ts`), no "fechar lead" (`routes/contracts.ts`) e no regenerar (`contractReprocess.ts`) quando é por ato.
- Tela do contrato: caixinha "Contratação por ato" e campo "Qual é o ato" (salvos em `party_overrides.por_ato` / `ato_descricao`). Vem marcada quando a proposta é por ato e esconde as abas da declaração. `/api/contracts/:id/party` devolve `por_ato_proposta` e `ato_descricao`.

## Verificado
- `tests/contratoPorAto.test.mjs`: 7 testes novos.
- `npm run build` ok; `npm run lint`: 0 erros; `npm test`: 1385 testes, 0 falhas.
- **Não testado no navegador nem em produção.**

## Decisões
- Minuta própria, em vez de adaptar a de cada área: o objeto, o preço e o risco são outros.
- A escolha feita no contrato vale por cima da proposta. Desmarcar volta à minuta completa.
- A procuração continua a ad judicia et extra de sempre. A equipe edita se quiser limitar ao ato.
- Sem migration: as opções ficam no JSON `party_overrides`, que já existe.

## Pendente
- A Dra. ler a minuta por ato e ajustar o texto, se quiser (principalmente o parágrafo sobre o ato que não acontece e a frase "deslocamentos fora da Grande Vitória").
- Contratos já criados não mudam sozinhos. Para usar a minuta num deles: marque "Contratação por ato".

## Próxima sessão
- Conferir na tela um contrato com "Contratação por ato" marcado: Cláusula Primeira com o ato, valor certo, sem a aba da declaração e "Baixar tudo" só com contrato + procuração.
