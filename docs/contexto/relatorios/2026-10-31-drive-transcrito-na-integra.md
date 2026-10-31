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

## Teste em produção (pedido da Jessica: "faça isso agora para testar")
Rodei "Ler os contratos" e "gerar nova versão" no caso do Itaú por script na VPS (sem envio a cliente). Cada rodada mostrou uma causa a mais:
1. **v6:** extratos já transcritos por inteiro e o Itaú achado pelo Calculista, mas a peça seguiu com "[valor a apurar]". O extrato escreve "341 - BANCO ITAU SA", e `nucleoBanco` tomava o "341" como nome. Corrigido em `contratosDoCaso.ts`.
2. **v7:** R$ 865,98, mas só de 01 a 09/2026. A leitura dava a cada fonte ~8.700 caracteres (200 mil / 23). `montarFontes` passou a dar a cada uma o que ela precisa (as pequenas inteiras, depois os extratos); `VERSAO_FICHA = 3`.
3. **v9:** com tudo inteiro, a IA parou a lista de descontos em 2021 (centenas de linhas). `src/services/hiscre.ts` lê os descontos do histórico em código.
4. **v10:** Itaú com 2 contratos, 64 descontos cada (05/2021 a 09/2026), R$ 4.367,36 descontados e R$ 12.618,30 atualizados; demonstrativo, planilha e peça batem.

## Depois: cálculos de todas as ações e dano moral padrão
- Pedido da Jessica: "leia uma única vez para todos os processos... as demais já com os cálculos prontos, focando nas teses"; "padrão de dano moral 10.000,00 para todas as peças desse mesmo perfil".
- A leitura já era única por cliente. Faltava deixar as planilhas limpas e ligadas: cada leitura agora troca o conjunto inteiro (as antigas se acumulavam porque o nome do banco muda entre leituras), e a planilha só vai para a ação da mesma modalidade.
- Dano moral padrão de R$ 10.000,00 em empréstimo consignado e cartão consignado (`danoMoralPadrao`), na peça, nas planilhas e no valor da causa. Testes: `tests/danoMoralPadrao.test.mjs` e caso Valmirio em `tests/esteiraPeca.test.mjs`.
- Conferido em produção: 6 ações do Valmirio com a planilha na ação certa e o valor da causa já com o dano moral; peça v11 do Itaú com R$ 22.618,30 (R$ 12.618,30 + R$ 10.000,00).

## Decisões
- Reler só os resumos antigos de extratos, não de todos os documentos: os outros (RG, comprovante) já servem como estão, e reler tudo gastaria cota da IA em todos os clientes.

## Pendente
- Dra.: usar a peça **v10** do Itaú (as v6 a v9 são do teste). Decidir os 325 descontos "sem contrato certo" (R$ 29.711,84), quase todos anteriores aos contratos do extrato atual.
- Planilha "Banco PAN S.A." separada da "623 - Banco PAN S.A." (3 descontos): conferir.
- A ficha ainda pede à IA a lista de descontos do histórico (agora substituída pelo código). Se a resposta ficar longa demais e falhar, tirar esse pedido do prompt.
- Liberar para o Claude a leitura do banco de produção (regra de permissão), para conferir casos reais.

## Próxima sessão
- Conferir em produção o texto novo do HISCON do Valmirio (começa com "[Transcrito por IA de") e a planilha do Itaú.
