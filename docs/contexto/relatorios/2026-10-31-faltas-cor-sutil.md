# 31/10/2026: documentos que faltam com cor sutil

## Pedido
Jessica, com print do card do cliente ("Documentos comuns" → "Falta: Comprovante de residência"): deixar os documentos que faltam em outra cor, que apareça mas sem ser forte.

## Feito
- `public/styles.css`, bloco `.lote-faltas`: cada item tem fundo âmbar claro (60% de `--lote-ambar-bg`), filete âmbar de 2px à esquerda e título em `--lote-ambar`. O motivo continua em cinza.
- O item que trava a geração (`.lote-falta-trava`) usa o mesmo estilo, só que em vermelho (`--lote-grave`).

## Verificado
- Captura no Edge (Playwright) dentro de `.lote-cli`, nos temas claro e escuro: o destaque aparece e continua discreto.
- `npm run lint`: 0 erros. `npm test`: 1305 passaram, 0 falharam.

## Decisões
- Usei as variáveis de cor que o card do cliente já tem (`--lote-*`), sem criar cor nova, e o escuro acompanha sozinho.

## Pendente / próxima sessão
- A Jessica conferir no card real depois do deploy.
