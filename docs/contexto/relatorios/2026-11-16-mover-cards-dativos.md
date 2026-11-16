# 16/11/2026 — Mover os cards dos dativos (arrastar para mudar a etapa)

## Pedido
Jessica: "QUERO MOVER OS CARDS DOS DATIVOS".

## Feito
- Regra `validarMovimentoNoQuadro(atual, destino)` e `ETAPAS_DO_QUADRO` em `src/services/fluxoPagamentoDativo.ts`: o card vai para qualquer etapa do caminho (frente ou trás) e para Indeferida; não vai para Recebida (exige a baixa) nem Recusada (exige motivo); card já recebido ou recusado não se move.
- Rota `PATCH /api/dative/cases/:id/etapa` em `src/routes/dative.ts`: grava só o status, sem o "só avança" do `PUT`; os campos da ficha ficam.
- Tela (`public/app.js`): ajudante único `datLigarArrastoDeEtapa` ligado nos dois quadros, **Kanban por fase** (aba Demandas, commit 8a2063b de outra sessão) e **Caminho do pagamento** (aba Projeção). Coluna Indeferida sempre visível nos dois, para receber card. Estilo do arrasto em `public/styles.css`.
- Testes: `tests/dativoMoverCard.test.mjs` (9). Manual: `docs/manual/05-dativo.md`, seção "Mover o card de etapa". `docs/api/rotas.md` regenerado.

## Verificado
- `npm run build` sem erro; `npm run lint` 0 erros; `npm test`: 1.480 testes, 1.446 passam, 0 falhas.
- **Não verificado no navegador** (sem banco local) nem em produção.

## Decisões e porquês
- Rota própria em vez do `PUT`: o `PUT` reaplica o "só avança" e desfaria o arrasto para trás quando há protocolo ou decisão preenchidos.
- Os dados da ficha não são apagados ao voltar uma etapa; consequência documentada no manual: ao salvar a ficha depois, a etapa avança de novo pelo campo preenchido.
- Recebida e Recusada ficam fora do arrasto porque têm efeitos (registro do pagamento, motivo obrigatório).

## Pendente
- Jessica testar o arrasto nas duas telas depois do deploy.
- Arrastar só funciona com mouse; no celular, a etapa continua pela ficha (Editar).

## Próxima sessão
Se ela relatar problema no arrasto, abrir a aba Demandas → Kanban por fase e conferir a resposta de `PATCH /api/dative/cases/:id/etapa`. Skills: `diagnosing-bugs`, `webapp-testing`.
