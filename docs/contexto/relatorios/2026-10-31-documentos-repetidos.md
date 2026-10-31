# 31/10/2026 — Documentos repetidos do cliente

## Pedido
Jessica: "quando atualizo a pasta deve vir apenas os documentos que não estão, caso contrário terá excesso de documentos, kit incorreto e vamos gastar mais com leituras e análises duplicadas". Caso do Valmirio: 52 documentos, o mesmo histórico de créditos várias vezes e 39 anexos no kit de cada banco. O código foi feito em outra sessão e ficou sem commit; foi publicado junto com a correção de datas da Dra. Helena, a pedido da Jessica ("o que está faltando comitar ainda? faça isso junto").

## Feito
- Regras: `src/services/documentosDuplicados.ts`. Banco: `src/services/documentosDuplicadosMysql.ts`. Migration `176_documentos_repetidos.sql` (`documents.drive_md5` e `duplicado_de`, só acrescenta colunas).
- O mesmo arquivo é reconhecido pelo ID do Drive ou pelo conteúdo (md5), em qualquer ação do cliente. Ele não entra de novo ao atualizar a pasta, e cópias "(2)" da mesma pasta ficam de fora.
- O repetido é **marcado, nunca apagado**, e sai da tela, do kit e das leituras (`analistaServico`, `loteProducao*`, `mesa.ts`, `peticaoBuilder.ts`, `pastaDrive.ts`).
- Arquivo que aparece em várias ações passa a valer para todas as ações do cliente.

## Verificado
- `npm run build` OK; lint com 0 erros; `npm test` com 1289 testes passando, 0 falhas (inclui `tests/documentosDuplicados.test.mjs`, `pastaDrive` e `loteProducao`).
- **Não verificado em produção:** a limpeza dos 52 documentos do Valmirio.

## Decisões e porquês
- Marcar em vez de apagar: dá para desfazer e não se perde documento.
- Peças, planilhas, dossiês e demonstrativos gerados pelo CRM nunca contam como repetidos.

## Pendente
- Jessica: "Atualizar da pasta" no caso do Valmirio e conferir o total de documentos e os anexos do kit de cada banco.

## Próxima sessão
- Conferir em produção a quantidade de documentos marcados como repetidos do Valmirio (consulta a `documents.duplicado_de`). Skills: `diagnosing-bugs` se algo vier errado.
