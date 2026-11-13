# 13/11/2026 — Caminho do pagamento do dativo

## Pedido
A Dra. pediu um campo para o código do protocolo que sai quando ela cadastra a certidão, e que o fluxo até o saque ficasse claro e controlável: nomeação (nº do processo e aceite) → atuação → certidão → cadastro no e-Flow → acompanhamento no e-Docs (deferido ou indeferido) → lista de pagamento da Sefaz → saque no banco e baixa. Também pediu os três links à mão: e-Flow (registrar), e-Docs (acompanhar) e Sefaz (ver a lista).

## Feito
- **Regra** em `src/services/fluxoPagamentoDativo.ts`, fonte única das etapas, rótulos e links: `statusAposRegistro` (avança a etapa pelo passo registrado, nunca volta, não mexe em paga/recusada), `resumoFluxo` (etapa atual, próximo passo com link, dias na etapa) e `validarCamposFluxo`.
- **Banco**, migration `179_dative_fluxo_pagamento.sql`: etapas `protocolada`, `deferida` e `indeferida` no status; colunas `aceite_date`, `certidao_date`, `eflow_protocolo`, `eflow_protocolo_date`, `decisao_pagamento`, `decisao_pagamento_date`, `decisao_pagamento_motivo`, `sefaz_lista_date`, `sefaz_lista_ref`; índice no protocolo. Só acrescenta; nada existente muda.
- **Rota** `src/routes/dative.ts`: o PUT grava os campos e aplica o avanço; a ficha recebe `fluxo`; a lista devolve o protocolo; nova rota `GET /api/dative/fluxo-pagamento` (quadro por etapa); a baixa usa o valor arbitrado antes do estimado. No resumo, protocolada e deferida contam como "realizado a faturar"; indeferida sai do estimado e das ativas.
- **Financeiro**: `aReceberMontar.ts` e `financeSummary.ts` deixam a indeferida fora do A Receber.
- **Tela** `public/app.js` e `public/styles.css`: barra com e-Flow, e-Docs e Sefaz no topo da Advocacia Dativa; filtro e selos com os nomes das etapas (e o protocolo na lista); na ficha, a faixa das 8 etapas, o próximo passo com o botão do site, "Copiar protocolo", "Recebi no banco — dar baixa" e a seção "Caminho do pagamento" com os campos (a data vira hoje quando se preenche o protocolo ou a decisão; o motivo só aparece se indeferido); quadro "Caminho do pagamento" na aba Projeção.
- Correção de quebra: a ficha não mostra mais o seletor de etapa em demanda recusada (antes, salvar podia trocá-la para "Nomeada").
- **Testes**: `tests/fluxoPagamentoDativo.test.mjs` (9 casos); `tests/dativoFiltrosEStatusRequerimento.test.mjs` atualizado para o rótulo novo.
- **Documentação**: `docs/manual/05-dativo.md` (tabela das etapas, regras, changelog), `16-ferramentas-acessos.md` (os três sites), `17-decision-log.md`, `docs/api/rotas.md`; espelho do Obsidian copiado.

## Verificado
- `npm run build`: ok. `node --check public/app.js`: ok.
- `npm run lint`: 0 erros (32 avisos antigos, nenhum nos arquivos mexidos).
- `npm test`: 1449 testes, 1415 passaram, 0 falhas (34 pulados por falta de banco local).
- As funções novas da tela foram rodadas em Node com demandas de exemplo (protocolada, indeferida, na lista): a faixa, os botões e o escape do protocolo saem certos.
- **Não verificado no navegador** nem com banco: a migration é validada no CI ("banco do zero") antes de publicar.

## Decisões e porquês
- As etapas ficaram no próprio status, sem tabela nova: cada demanda tem um único pedido de pagamento.
- Os nomes antigos do banco (`aguardando_liberacao_requerimento`, `a_receber`) foram mantidos com rótulos novos ("Certidão emitida — cadastrar no e-Flow", "Na lista da Sefaz — disponível para saque"), para não precisar mexer nos dados.
- Um único campo de código para o protocolo (e-Flow e e-Docs usam o mesmo número, pelo que ela descreveu). Se forem números diferentes, basta outra coluna.
- Os links estão em dois lugares (serviço e `DATIVE_LINKS` na tela), porque a barra do topo aparece antes de qualquer chamada à API; o manual diz onde trocar.

## Pendente
- A Dra. conferir as demandas que já estavam em "a receber" (antes significava "procedimento aberto") e em "aguardando liberação" (agora "certidão emitida"). Registrar o protocolo leva cada uma para a etapa certa.
- Confirmar com ela se o protocolo do e-Flow é o mesmo número que se acompanha no e-Docs.

## Próxima sessão
Em produção, abrir uma demanda dativa, preencher a data da certidão e o protocolo, salvar e ver a etapa ir para "Protocolada"; conferir o quadro na Projeção e a baixa. Skills: `webapp-testing`, `verification-before-completion`.
