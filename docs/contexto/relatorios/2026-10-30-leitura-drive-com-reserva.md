# Extrato de empréstimos nunca era lido: leitura do Drive com reserva (30/10/2026)

## Pedido
O extrato de empréstimos completo do Valmirio (caso #110) continuava sem texto depois de "Ler os contratos"; a peça do Itaú saía sem número de contrato e com o cálculo zerado.

## Feito
- **Causa:** `extractCaseDocuments` e `importDriveFolder` (`src/services/peticaoBuilder.ts`) liam os anexos do Drive só pelo Gemini gratuito (`aiExtractFromFile`, 20 leituras por dia). Com a cota esgotada, a leitura falhava calada e o documento ficava sem texto.
- As duas leituras passaram a usar `aiLerArquivo`, que já existia: Gemini e, sem cota, OpenAI com visão.
- Docs: incidente no `docs/manual/14-runbook.md` (+ Changelog), copiado para o Obsidian.

## Verificado
- A leitura isolada do mesmo PDF com `aiLerArquivo` trouxe o texto.
- Teste novo `tests/leituraDriveComReserva.test.mjs` barra a volta da chamada só pelo Gemini nesse arquivo.
- Testes e deploy na VPS: workflow "Deploy para VPS" do commit 786778f concluído com sucesso.
- **Não verificado em produção:** a nova leitura do caso #110 e a peça do Itaú refeita.

## Decisões e porquês
- Reaproveitar `aiLerArquivo` em vez de criar outra reserva: a regra de "qual IA tentar" fica num lugar só.

## Pendente
- Clicar "Ler os contratos" de novo no caso #110 e gerar nova versão da peça do Itaú.
- Se a OpenAI também estiver sem crédito ("no credits remaining"), recarregar em platform.openai.com → Billing.

## Próxima sessão
Documento do Drive com `content` NULL depois de uma leitura = a IA recusou. Ver o incidente no runbook. Skill sugerida: `diagnosing-bugs`.
