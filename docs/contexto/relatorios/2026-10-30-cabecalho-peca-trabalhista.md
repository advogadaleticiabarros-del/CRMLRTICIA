# 30/10/2026 — Cabeçalho fixo da peça trabalhista

## Pedido
Jessica: "regra de cabeçalho de peça DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)".

## Feito
- Módulo novo `src/services/enderecamentoPeca.ts`: `ehAreaTrabalhista` (trabalhista, gestante, texto com "trabalh"), `enderecamentoTrabalhista(cidade, uf)`, `regraEnderecamento(area)` (linha do prompt) e `aplicarEnderecamento(texto, area)` (garante a 1ª linha).
- Esteira da petição inicial: a regra entra no prompt da redação (`pecaDossie.ts`, `montarPromptRedacao`) e o texto da IA passa por `aplicarEnderecamento` antes da conferência (`esteiraPeca.ts`).
- Assistente de IA, modelo "Petição Inicial" (`src/routes/ai.ts`): mesma regra no prompt e na resposta quando a área do caso ou do formulário é trabalhista.
- Manual: `docs/manual/06-documentos.md` (parágrafo na esteira da petição inicial + Changelog).

## Verificado
- `tests/enderecamentoPeca.test.mjs`: 8 testes, todos passam.
- `npm run build` sem erro; `npm run lint` com 0 erros; `npm test`: 1.265 testes, 0 falhas.
- **Não verificado em produção:** só aparece na próxima peça trabalhista gerada.

## Decisões e porquês
- Vara sempre "___" (sai na distribuição). Cidade e UF entram só se constarem das fontes (local da prestação do serviço, art. 651 da CLT). Se não constarem, ficam os marcadores (CIDADE) e (ESTADO). Não foi usado o endereço do cliente porque ele não define a competência.
- Duas camadas: a regra no prompt e a correção da 1ª linha no código, porque a IA às vezes volta ao "EXCELENTÍSSIMO SENHOR JUIZ…". A correção aproveita a cidade e a UF que estavam no cabeçalho antigo.
- A área "gestante" conta como trabalhista (estabilidade da gestante).
- A versão que a Dra. cola ou edita na Mesa não é alterada; a regra vale só para o texto gerado pela IA.

## Pendente
- Jessica: dizer se a regra vale também para outras peças trabalhistas além da inicial (contestação, recurso). Hoje vale só para a petição inicial.

## Próxima sessão
Conferir a 1ª linha da próxima peça trabalhista gerada. Skills: `verification-before-completion`.
