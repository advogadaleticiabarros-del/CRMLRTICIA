# 16/11/2026 — Fases dos dativos antigos corrigidas

## Pedido
Depois do novo caminho do pagamento (13/11), a Jessica pediu: "vamos trocar, colocar nas formas certas", referindo-se às demandas que ficaram no status antigo.

## Feito
Mudança só de dados, em produção. Nenhum código mudou.
- Antes: 7 demandas em `a_receber` e 1 em `aguardando_liberacao_requerimento`.
- Para cada uma, li as observações e documentos (consulta só de leitura). O código anotado ("Protocolo 2026-XXXXXX") foi para `eflow_protocolo` e a demanda foi para a fase certa:
  - ids 6, 12, 16, 20, 25, 26 → `protocolada`;
  - id 2 (nota "Deferido") → `deferida`, com `decisao_pagamento = deferido`.
- Códigos gravados em maiúsculas.
- A id 30 continuou em `aguardando_liberacao_requerimento`: não tem protocolo nem nota.
- Feito numa transação, com `WHERE status = 'a_receber'` para não sobrescrever nada que tivesse mudado.

## Verificado
- Consulta depois da mudança: nomeada 10, em_andamento 16, concluida 5, aguardando_liberacao_requerimento 1, protocolada 6, deferida 1, a_receber 0.
- Backup das 8 linhas antes da mudança: `/root/backups/dativo-fases-antes-20261116.sql` (VPS).
- **Não verificado na tela.**

## Decisões e porquês
- Nenhuma tinha sinal de ter saído na lista da Sefaz, então nenhuma ficou em `a_receber`. Elas saem do A Receber do Financeiro, o que está certo, porque o dinheiro ainda não está disponível.
- As datas do protocolo e da decisão ficaram vazias porque não são conhecidas. Por isso a ficha não mostra "dias parada" nessas demandas.

## Pendente (Jessica)
- Conferir no e-Docs o andamento de cada protocolo e preencher as datas.
- Id 16: tem a nota "ganhou a primeira fase — aguardar".
- Id 30: confirmar em que fase está.
- Id 6: tem um recebimento "previsto" de R$ 850 em `dative_payments`, de antes.

## Próxima sessão
Se precisar desfazer: restaurar o backup acima.
