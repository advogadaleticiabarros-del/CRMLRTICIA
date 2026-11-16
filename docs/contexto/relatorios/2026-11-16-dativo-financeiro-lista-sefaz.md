# 16/11/2026 — Dativo no financeiro só a partir da lista da Sefaz

## Pedido
Depois do caminho do pagamento do dativo (13/11), a Dra. pediu: "só vai para financeiro a partir do momento que estiver na lista do Sefaz — aí sim está disponível para saque e entrada no nosso caixa em breve. No financeiro, após entrar nessa lista, coloque em disponível para recebimento, mas sem o dia, e mantenha acumulado, até irmos retirar e colocar como recebido."

## Feito
- `src/services/aReceberMontar.ts`: a nomeação dativa só entra no A Receber com status `a_receber` (na lista da Sefaz), valor arbitrado (senão o estimado), sem vencimento, marcada `disponivel: true`, com a referência e a data da lista na descrição. Antes entrava toda nomeação não paga, com o estimado. Recebimento previsto lançado à mão numa demanda que não está na lista também fica de fora (os recebidos continuam todos).
- `src/services/aReceberFiltro.ts`: item disponível em aberto passa por qualquer filtro de mês (acumulado); novo total `disponivel`. Depois de recebido, conta pela data da baixa como os demais.
- `src/services/financeSummary.ts`: o previsto do dativo (Cockpit e topo do Financeiro) segue a mesma regra.
- `public/app.js` (A Receber): origem "Dativo (lista da Sefaz)", coluna de data "sem data · na lista desde …", selo "disponível para recebimento", card "Disponível para recebimento (dativo)" e texto de ajuda. O "Receber" continua dando a baixa (a demanda vira "Recebida").
- Teste novo: `tests/dativoFinanceiroListaSefaz.test.mjs` (6 casos).
- Manual: `08-cobranca.md`, `05-dativo.md`, `17-decision-log.md` (com espelho no Obsidian).

## Verificado
- `npm run build`: ok. `node --check public/app.js`: ok.
- `npm run lint`: 0 erros (32 avisos antigos).
- `npm test`: 1455 testes, 1421 passaram, 0 falhas (34 pulados por falta de banco local).
- **Não verificado no navegador** nem com os dados de produção.

## Decisões e porquês
- Em vez de inventar um vencimento, o item "disponível" fura o filtro de período enquanto estiver em aberto: é o "acumulado" que ela pediu, sem data falsa.
- O fluxo de caixa mensal não mostra esses valores, porque é organizado por data.
- A tela do próprio Dativo (Projeção) não mudou: lá continua o controle de todas as etapas.

## Pendente
- Valores que somem do A Receber: as nomeações que ainda não estão na lista saem do total "a receber" do financeiro. É o pedido, mas o número do topo vai cair; vale avisar a Dra.
- Continua pendente conferir as demandas antigas em "a receber" (de 13/11): agora elas aparecem no financeiro como disponíveis para saque.

## Próxima sessão
Em produção, pôr uma demanda em "Na lista da Sefaz", ver no Financeiro › A Receber o selo "disponível para recebimento" em meses diferentes e dar a baixa. Skills: `webapp-testing`, `verification-before-completion`.
