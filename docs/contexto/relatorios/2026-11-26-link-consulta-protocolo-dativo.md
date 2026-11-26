# 26/11/2026 — Link de consulta do protocolo na demanda dativa

## Pedido
Jessica, com print da ficha "Demanda dativa": "Inclua um local para colocar o link para consulta direto, que sai junto com o código do protocolo." (Hoje o link estava sendo colado nas Observações.)

## Feito
- `migrations/191_dative_eflow_link.sql`: coluna `dative_cases.eflow_link VARCHAR(500) NULL` (só acrescenta).
- `src/services/fluxoPagamentoDativo.ts` (`validarCamposFluxo`): aceita `eflow_link` só com `http://` ou `https://`, até 500 caracteres; vazio apaga. O PUT `/api/dative/cases/:id` já grava todo campo que essa função devolve, então a rota não mudou.
- `public/app.js`, ficha da demanda: campo "Link de consulta (sai junto com o protocolo)" abaixo do código; botão "Consultar protocolo ↗" na faixa do caminho do pagamento; colar o link com o código vazio preenche o código pelo final do link (`/e/CÓDIGO`).
- Testes novos em `tests/fluxoPagamentoDativo.test.mjs`. Manual: `docs/manual/05-dativo.md` (seção e Changelog).

## Verificado
- `tsc` sem erros; `npm run lint` com 0 erros (32 avisos já existentes); `npm test`: 1708 testes, 1674 passaram, 0 falhas, 34 pulados.
- Não verificado no navegador; deploy acompanhado pelo `gh run watch` após o push.

## Decisões e porquês
- Coluna própria em vez de deixar nas Observações: vira botão clicável e não se perde no texto.
- Só http/https: o link vira `href`; bloqueia `javascript:` e afins.
- O link não avança a etapa (quem avança para "Protocolada" é o código), para não mudar a regra do caminho do pagamento.

## Pendente
- Demandas antigas com o link nas Observações (como a do print) continuam lá; dá para mover à mão, colando no campo novo.

## Próxima sessão
Nada obrigatório. Se pedirem, mostrar o link também no card do quadro/lista. Skills: domain-modeling, verification-before-completion.
