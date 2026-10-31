# 31/10/2026 — Card do cliente: introdução do caso e documentos repetidos

## Pedido
Jessica, com prints do card do Valmirio: "nessa primeira parte ao abrir o card, preciso de uma introdução do caso, está muito bagunçado; além disso existem documentos duplicados, quando atualizo a pasta deve vir apenas os documentos que não estão, caso contrário terá excesso de documentos, kit incorreto e ainda vamos gastar mais para fazer leituras e análises duplicadas". O card mostrava 52 documentos, o mesmo histórico de créditos várias vezes e 39 anexos no kit do Itaú.

## Causa (documentos repetidos)
`importDriveFolder` só conferia o nome dentro da mesma ação. As 6 ações do cliente leem a mesma pasta, então cada arquivo entrava uma vez por ação. Cópias com outro nome e o mesmo conteúdo também entravam. O botão e a leitura automática podiam rodar juntos e gravar em dobro.

## Feito
- **Documentos repetidos** (publicado às 08:07 pelo commit 6b7e1b5, feito por outra sessão a pedido da Jessica, junto com a correção de datas da Dra. Helena):
  - Regra em `src/services/documentosDuplicados.ts`; banco em `documentosDuplicadosMysql.ts`; migration 176 (`documents.drive_md5`, `duplicado_de`).
  - Mesmo arquivo = mesmo ID do Drive ou mesmo md5, em qualquer ação do cliente. Não entra de novo ao atualizar a pasta; cópias "(2)" da própria pasta entram uma vez; uma leitura de pasta por cliente de cada vez.
  - Os repetidos que já existiam são marcados a cada leitura da pasta, nunca apagados, e saem da tela, do kit, da Mesa e das leituras (esteira e Dra. Helena). Fica o que já tem texto lido. O arquivo de várias ações passa a ser do cliente.
- **Introdução do caso** (este commit): bloco "Sobre o caso" no topo do card: assunto, ações e etapa, relato, **próximo passo** (travado / gerar / revisar / protocolar, com os bancos), bancos com a situação de cada um, documentos comuns que faltam e a conferência "uma peça por banco" recolhida. Regras em `apresentarCaso` (`loteProducao.ts`, já publicado); tela em `public/loteCliente.js` e `styles.css`.
- **Documentos agrupados por tipo** (os vários históricos de créditos numa linha que abre), com o total de repetidos fora da lista e do kit.

## Verificado
- `npm run build` OK; lint com 0 erros; `npm test`: 1.290 passando, 0 falhas (33 pulados, que precisam de banco e rodam no CI).
- Testes novos: `tests/documentosDuplicados.test.mjs` (9), `pastaDrive` (+2), `loteProducao` (+4: lista e kit sem repetição, introdução, próximo passo, sem ponto dobrado).
- Tela conferida com print local (dados fictícios, `montarLote` real + `loteCliente.js` real) no computador e no celular, sem erro no console. No cenário de teste, 6 repetidos saíram e o kit do Itaú caiu para 10 anexos.
- **Não verificado em produção:** a consulta ao banco da VPS foi negada pela permissão. Não sei quantos dos 52 documentos do Valmirio serão marcados.

## Decisões e porquês
- Marcar em vez de apagar: dá para desfazer e não se perde documento.
- Nome igual só conta na própria ação (pastas de bancos diferentes podem ter arquivos diferentes com o mesmo nome).
- A introdução é montada pelas regras, sem IA: instantânea, sem custo, sem inventar.
- A migration 176 subiu com o índice no mesmo comando das colunas. O deploy passou; não mexi no arquivo depois de aplicado.

## Pendente
- Jessica: abrir o card do Valmirio, clicar "Atualizar da pasta" em uma das ações (marca os repetidos antigos, inclusive as cópias com outro nome) e conferir o total de documentos e os anexos do kit de cada banco.

## Próxima sessão
- Conferir em produção `SELECT COUNT(*) FROM documents WHERE client_id = <Valmirio> AND duplicado_de IS NOT NULL`. Se algo não repetido foi marcado, ver o runbook ("documentos repetidos no card do cliente"). Skills: `diagnosing-bugs`.
