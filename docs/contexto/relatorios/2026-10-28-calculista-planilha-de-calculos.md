# 28/10/2026 — Calculista: planilha de cálculos da peça

## Pedido
Jessica: "Preciso que algum agente analise os extratos e faça planilhas de cálculos para colocar nas peças."

## Feito
- **Novo agente Dr. Augusto (Calculista)**, o #44 do mapa, entra na esteira da petição inicial logo depois do cálculo nominal. Ele usa os descontos que a Dra. Helena leu nos extratos, já sem repetição e só os contratos da peça, e monta a planilha mês a mês: devolução simples ou em dobro, correção monetária e juros de mora desde cada desconto. Critério completo em `docs/manual/06-documentos.md` (Esteira, item 3) e no decision log de 28/10.
- **Índices do Bacen** (INPC 188, IPCA 433, Selic 4390), guardados em `indices_economicos` (migration 172). Só se busca o que falta, em janelas de até 10 anos, e o mês corrente nunca entra.
- **Saídas:**
  - documento "Planilha de cálculos — Cliente (vN)" no caso, com a tabela no CRM e o arquivo .xlsx com fórmulas e a aba "Índices";
  - aba **Cálculos** na Mesa do caso, com o botão "Baixar planilha (.xlsx)";
  - a petição diz que o detalhamento está na planilha anexa;
  - o valor da causa passa a usar a restituição atualizada;
  - a conferência checa o total atualizado.
- **Arquivos novos:** `src/services/planilhaCalculos.ts`, `indicesEconomicos.ts`, `indicesEconomicosMysql.ts`, `xlsxSimples.ts`, `tests/planilhaCalculos.test.mjs`.
- **Arquivos alterados:** `pecaCalculos.ts` (`descontosUnicos`, `CalculoPeca.descontos` e `CalculoPeca.atualizacao`), `pecaDossie.ts`, `esteiraPeca.ts`, `esteiraPecaMysql.ts`, `peticaoBuilder.ts`, `peticaoReviewer.ts` (não revisa a planilha), `routes/mesa.ts`, `public/mesa.js`, `escritorioVirtual.ts`, `public/escritorio.js`. Também `jszip` passou a dependência direta.

## Verificado
- `npm run build` ok, `npm run lint` sem erros e `npm test` com 1.128 testes passando, 0 falhas e 33 pulados (os que usam banco, que rodam no CI). São 22 testes novos: 20 em `planilhaCalculos` e 2 na esteira.
- **Amostra com os índices reais do Bacen** (descontos fictícios, fora do banco): data-base 09/2026; R$ 54,90 de 01/2020 virou R$ 136,85 (fator 1,446474 e juros de 72,33%). O .xlsx abriu no openpyxl, com fórmulas, totais e a aba de índices.
- **Não verificado:**
  - a geração real em produção (nenhuma peça foi regerada; isso gasta IA e cria versão nova);
  - a tela da aba Cálculos no navegador. O e2e do CI cobre a Mesa, mas não essa aba.

## Decisões e porquês
- **Juros desde cada desconto (Súmula 54), não desde a citação:** o desconto indevido é ilícito extracontratual e é o pedido mais favorável. Se a Dra. preferir a citação, a troca é fácil.
- **Virada da Lei 14.905/2024 em 09/2024** (base mensal; a lei vale desde 30/08/2024).
- **Índice negativo** aplicado sem reduzir o valor original (orientação do STJ).
- **Gerador de .xlsx próprio**, em vez do `exceljs`, que é pesado e tem dependências antigas (risco na auditoria do CI).
- **Os juros pagos a mais** da revisão da taxa continuam nominais: não há a data de cada parcela.

## Pendente
- **Jessica/Dra.:** confirmar o critério (juros desde o desconto ou desde a citação; INPC até 08/2024).
- **Valmirio (#110):** continua dependendo do extrato de empréstimos (HISCON). Sem contrato do Itaú identificado, a planilha sai vazia. Com o extrato juntado, a v3 já sai com a planilha.
- **O Calculista ainda não faz:** liquidação trabalhista (PJe-Calc), atrasados do INSS e a taxa média do Bacen da data do contrato.

## Próxima sessão
1. Depois do deploy, gerar uma nova versão de um caso de consumidor com extrato lido, abrir Mesa → Cálculos e baixar o .xlsx.
2. Ajustar o que a Dra. pedir. Skills sugeridas: `tdd`, `verification-before-completion`, `webapp-testing`.
