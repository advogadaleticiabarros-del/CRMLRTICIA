# 30/10/2026: WhatsApp desconectado ("session is not reconnectable")

## Pedido
A Jessica colou o aviso crítico "Rotina automática falhou: whatsapp:verificar-conexao — WhatsApp disconnected: session is not reconnectable".

## Feito
- Diagnóstico pelo código: a rotina `whatsapp:verificar-conexao` (`src/crons/index.ts`) só avisa e não reconecta. O texto do erro vem da Uazapi e indica que o WhatsApp invalidou a sessão do lado dele, então o religamento automático não volta.
- A Jessica reconectou escaneando o QR pelo painel da Uazapi.
- Runbook (`docs/manual/14-runbook.md`, "WhatsApp desconectado"): ganhou a exceção para esse erro (só o QR resolve; o que para durante a queda; o que conferir depois). Antes dizia "não há ação manual além de aguardar".

## Verificado
- Nada em produção: o acesso SSH à VPS foi negado pela permissão automática da sessão. A reconexão foi informada pela Jessica.

## Decisões
- Nenhuma mudança de código: o aviso funcionou como projetado. Só faltava a instrução certa no runbook.

## Pendente
- Conferir em Saúde do WhatsApp se está "conectado" e no sino se algum envio falhou durante a queda.
- Causa da queda (hora exata e se é recorrente): precisa dos logs da VPS.

## Próxima sessão
- Se o erro voltar em poucos dias, investigar pelos logs do PM2 (`crm-juridico`) e pelo painel da Uazapi se o aparelho está sendo desconectado.
