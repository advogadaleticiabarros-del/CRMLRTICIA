# 30/10/2026 — A barra de progresso não apareceu (tela antiga no navegador)

## Pedido
Print da Jessica na Mesa do caso: "onde está a barra?". O aviso era o texto antigo e o botão não travou.

## Diagnóstico
- Esperado: depois do deploy, a Mesa com confirmação, botão travado e barra.
- Encontrado: `mesa.js` antigo rodando no navegador.
- Causa: o cache-busting do `index.html` (`src/app.ts`) só colocava `?v=` em `app.js`, `whatsapp.js`, `portal-parceiro.js` e `styles.css`. `mesa.js`, `loteCliente.js`, `escritorio.js`, `leis.js` e `visaoCliente.js` ficavam sem versão (conferido no HTML de produção: `<script src="/mesa.js">`).

## Feito
- `src/utils/versionarIndexHtml.ts`: versiona todo script da raiz de `public/` (fora `/vendor/` e `/socket.io/`) e o CSS; `src/app.ts` usa a função.
- `tests/versionarIndexHtml.test.mjs` (3 testes, vistos falhando antes; um lê o `index.html` real).
- Runbook (incidente), ESTADO.

## Verificado
- Build, lint (0 erros), suíte inteira; depois do deploy, o HTML de produção conferido com `?v=` no `mesa.js`.
- O clique do print já usou a rota nova (trava + registro): a geração estava rodando no servidor.

## Pendente
- Jessica: Ctrl+Shift+R uma vez (ou só reabrir o CRM depois deste deploy) e conferir a barra na próxima geração.
