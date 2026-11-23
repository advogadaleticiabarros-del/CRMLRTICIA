# Recebimentos da Dativa com a lista da Sefaz — 23/11/2026

## Pedido
Com print da aba Advocacia Dativa → Recebimentos e da coluna do quadro "Na lista da Sefaz — disponível para saque": "nessa parte de recebimentos deixar o que está na coluna que enviei no print".

## Feito
- `public/app.js`, `datRecebimentos`: bloco no topo "Na lista da Sefaz — disponível para saque", alimentado por `GET /api/dative/cases?status=a_receber` (as mesmas demandas da coluna 7 do quadro). Mostra assistido (e nº do processo), comarca, protocolo do e-Flow, valor (arbitrado ou, sem ele, o estimado), quantidade e total.
- Cada linha tem **Dar baixa** (cria o recebimento com a data de hoje e a demanda vira Recebida, pelo `PATCH /api/dative/cases/:id/receber` que já existia) e **Abrir** (ficha da demanda). Depois da baixa, o bloco e o histórico recarregam.
- O modal "Recebi no banco" virou a função `datDarBaixaModal`, usada pela ficha e pelo bloco novo (sem duplicar a regra).
- O histórico de recebimentos lançados continua embaixo, com o filtro de período e a exportação de antes.

## Verificado
- `node --check public/app.js`, `npm run lint` (0 erros), `npm run build`, `npm test`: 1641 passaram, 0 falhas.
- Não conferido em navegador local (precisa de banco); conferir na produção depois do deploy.

## Decisões
- O valor mostrado é o arbitrado, senão o estimado: é o mesmo que a baixa sugere. O total da coluna no quadro soma só o estimado, então pode diferir quando há valor arbitrado.
- Nenhuma mudança no back-end nem no banco.

## Pendente
- Nada novo.

## Próxima sessão
- Se a Dra. quiser só a lista da Sefaz na aba (sem o histórico), basta tirar o card `#dpay-card`.
