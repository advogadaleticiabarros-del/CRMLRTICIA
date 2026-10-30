# Card do cliente não ia para "Separação de documentos" (30/10/2026)

## Pedido
Jessica: "O card do Valmiro não está indo para a coluna de separação de documentos."

## Feito
- **Causa:** o card único do cliente (entregue em 30/10) foi feito sem arrastar. Ele fica na coluna da ação mais atrasada (`etapaDoLote`), e nenhuma tela mudava a etapa do grupo, então o card ficava preso.
- `src/services/loteProducao.ts`: nova `acoesParaMover`. O quadro (`agruparQuadro`) devolve `lote.mover`, com a lista de ações a mover para cada coluna antes do protocolo.
- `public/app.js`: o card do cliente passou a arrastar. Ao soltar, chama `PATCH /api/cases/:id/production-stage` para cada ação, com as mesmas travas e o mesmo histórico, e avisa qual não moveu e por quê. Criação inicial pede confirmação, porque gera uma peça com IA por ação.
- Docs: `docs/manual/06-documentos.md` ("Card único do cliente" + Changelog) e `docs/manual/14-runbook.md` (incidente), copiados para o Obsidian.

## Verificado
- Teste novo em `tests/loteProducao.test.mjs` (2 casos): falhou antes da correção e passa depois.
- `npm test`: 1244 testes, 0 falhas. `npm run lint`: 0 erros; os avisos são antigos e não vêm destes trechos.
- **Não verificado em produção:** arrastar o card do Valmirio no navegador. Fica para a Jessica depois do deploy.

## Decisões e porquês
- Para a frente, avançam só as ações atrasadas; a que já está mais adiante não volta. Para trás, voltam todas, para o card ficar na coluna escolhida.
- Protocolar e recusar continuam uma ação por vez: cada protocolo tem o seu número de processo.
- A regra fica no servidor (testada), e o front só lê `lote.mover`, para não duplicar a regra em JS.
- Foi descartada uma rota nova de "mover lote": a rota de etapa já tem todos os efeitos (peça com IA, revisão, histórico).

## Pendente
- A Jessica arrastar o card do Valmirio para "Separação de documentos" e confirmar.

## Próxima sessão
Se ela disser que alguma ação não moveu, leia o aviso (nº do caso e motivo) e a rota `PATCH /:id/production-stage` em `src/routes/cases.ts`. Skill sugerida: `diagnosing-bugs`.
