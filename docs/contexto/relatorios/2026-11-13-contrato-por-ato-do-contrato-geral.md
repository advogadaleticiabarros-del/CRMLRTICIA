# Contrato por ato refeito sobre o contrato geral (13/11/2026)

## Pedido
Jessica perguntou se o contrato por ato era baseado no contrato dela. Só em parte: algumas cláusulas tinham sido escritas pela IA. Ela não tem modelo de contrato por ato e pediu: "faça baseado no meu contrato geral, as cláusulas que der para usar".

## Feito
- As cláusulas do contrato geral (`buildTemplate`, áreas cível, consumidor, previdenciário, família sem pensão e outro) viraram constantes `CL_*` e `FECHO` em `src/services/contractTemplates.ts`. O contrato geral e o por ato usam as mesmas.
- `buildTemplatePorAto` refeito:
  - **Muda o objeto:** "a prática do seguinte ato", com o parágrafo único adaptado do contrato de pensão (nova contratação).
  - **Muda o preço:** valor do ato por extenso, forma de pagamento e a frase de sucumbência do geral, se a proposta marcar.
  - **Saem:** a vedação a acordos desassistidos (o parágrafo dela cobra o êxito) e as cláusulas que a IA tinha escrito (ato não realizado, deslocamento fora da Grande Vitória).
  - O resto é igual ao geral.

## Verificado
- O contrato geral saiu **idêntico byte a byte** antes e depois. Comparado em 6 áreas × 3 tipos de honorários.
- Teste novo compara, cláusula por cláusula, o contrato por ato com o geral. `tests/contratoPorAto.test.mjs`: 8 testes.
- `npm run build` ok; `npm run lint`: 0 erros; `npm test`: 1413 testes, 0 falhas.
- Não verificado no navegador.

## Decisões
- Cláusula inteira do geral ou nada: nenhuma cláusula comum foi reescrita.
- A cláusula de comparecimento (multa de 20% sobre o valor da causa) ficou, porque cabe num ato dentro de um processo.

## Pendente
- Contratos por ato já gerados com a 1ª versão: abrir e clicar em "Regenerar com modelo atual".

## Próxima sessão
- Nada, se a Jessica não pedir ajuste no texto.
