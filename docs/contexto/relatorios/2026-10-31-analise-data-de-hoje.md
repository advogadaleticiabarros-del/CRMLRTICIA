# 31/10/2026 — Dra. Helena acusava "data futura" em datas já passadas

## Pedido
Print da Jessica: a "Análise dos documentos" do Valmirio apontou como **grave** "Data de emissão futura (20/10/2026)" na procuração e "Data de emissão (16/04/2025) é futura" no RG. Pergunta: "A data e hora do nosso CRM não acompanha horário de Brasília e data atual?"

## Feito
- O relógio do CRM estava certo. O erro vinha da IA: o pedido de leitura mandava apontar "datas impossíveis" sem dizer que dia é hoje, e a IA usava a data do próprio treinamento, que é anterior a 2025.
- `src/services/analistaDocumentos.ts`:
  - `PROMPT_LEITURA_CRITICA` virou `promptLeituraCritica()`, que leva "HOJE É dd/mm/aaaa (horário de Brasília)";
  - `hojeBrasilia()` substitui o dia em UTC;
  - `indiciosValidos()`, dentro de `cruzar`, descarta o indício de "futura" quando a data dele já passou. Isso limpa também as leituras guardadas em `documento_leituras`, sem ler de novo.
- `src/services/analistaServico.ts`: passou a usar o pedido novo.
- Documentação: incidente no `docs/manual/14-runbook.md` e linha no Changelog do `06-documentos.md`, com cópia no espelho do Obsidian.

## Verificado
- 4 testes novos em `tests/negociadorAnalista.test.mjs`, com as datas do print. Os 3 de data falham no código antigo e passam no novo.
- `npm run build` OK; `npm run lint` com 0 erros; `npm test` com 1275 testes passando, 0 falhas.
- **Não verificado em produção:** falta clicar "Analisar de novo" no caso do Valmirio.

## Decisões e porquês
- **Filtrar no código, além de mudar o pedido.** As leituras ficam guardadas, e reler tudo custaria IA. O filtro também segura a IA se ela errar de novo.
- **Data realmente futura continua grave.** Um indício só cai se todas as datas dele forem iguais ou anteriores a hoje. Se o texto não traz data, vale a data de emissão lida.

## Pendente
- Jessica: "Analisar de novo" no caso do Itaú/Valmirio e conferir que os dois pontos graves sumiram.

## Próxima sessão
- Se aparecer outro pedido à IA que julgue se uma data é passada ou futura, incluir a data de hoje no texto. Skills: `diagnosing-bugs` e `tdd`.
