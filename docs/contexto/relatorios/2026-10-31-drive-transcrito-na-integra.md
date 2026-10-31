# Calculista do Itaú ainda dava R$ 0,00: o Drive era resumido, não transcrito (31/10/2026)

## Pedido
A Jessica mandou o demonstrativo de descontos do caso do Itaú (contrato 632706066, sem inclusão, 0 meses, R$ 0,00) e a peça gerada: "mesmo com todos os documentos o contabilista não está calculando. O que tem de errado, por que não está sendo feito?"

## Feito
- **Causa:** os documentos do caso são links do Google Drive. A leitura do Drive (`lerArquivoDoDrive`, `peticaoBuilder.ts`) pedia à IA um **resumo** "em tópicos curtos". Do extrato de empréstimos (HISCON) ficava o cabeçalho (10 contratos, comprometimento de R$ 802,49, margem de R$ 0,31), sem parcela, início e data de inclusão de cada contrato. Do histórico de créditos ficavam alguns valores "entre outros". Sem parcela e sem período, o Calculista não liga nenhum desconto ao contrato do Itaú. A transcrição integral feita na correção anterior só valia para arquivo guardado no banco. O resumo ficava gravado (`documents.content` e `documento_leituras`), então gerar de novo repetia o erro.
- **Correção:** `src/services/transcricaoDocumento.ts` é o pedido único de leitura de arquivo: PDF e foto são transcritos na íntegra, com todas as colunas; o áudio continua com a transcrição de áudio. O Drive usa esse pedido, com rótulo novo ("[Transcrito por IA de ...]") e memória nova (prefixo `drive-integral`). Resumos antigos de **extratos** são transcritos de novo na próxima leitura do caso (até 10 por vez); os de outros documentos ficam. A cópia entre ações do mesmo arquivo do Drive não copia resumo antigo de extrato.
- Rótulo do demonstrativo e descrição do Calculista no Escritório virtual diziam "simples até 03/2021"; o cálculo já aplica tudo em dobro (Tema 929). Corrigido.

## Verificado
- `tests/transcricaoDocumento.test.mjs` (5 testes); build sem erro; `npm test`: 1.310 passando, 0 falhas, 33 pulados (precisam de MySQL, rodam no CI); lint com 0 erros.
- **Não verificado em produção:** a consulta ao banco da VPS foi negada pela permissão. A causa vem do código e bate com o que aparece no print e na peça (contrato sem inclusão, valores do HISCRE "entre outros", só o cabeçalho do HISCON).

## Decisões
- Reler só os resumos antigos de extratos, não de todos os documentos: os outros (RG, comprovante) já servem como estão, e reler tudo gastaria cota da IA em todos os clientes.

## Pendente
- Jessica: no caso do Itaú, "Ler os contratos" (relê os extratos do Drive e mostra no sino o valor por banco) e depois "gerar nova versão". Se o contrato do Itaú ainda vier sem parcela, conferir se o extrato de empréstimos do caso traz esse contrato.
- Liberar para o Claude a leitura do banco de produção (regra de permissão), para conferir casos reais.

## Próxima sessão
- Conferir em produção o texto novo do HISCON do Valmirio (começa com "[Transcrito por IA de") e a planilha do Itaú.
