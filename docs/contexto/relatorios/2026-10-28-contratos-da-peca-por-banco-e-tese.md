# 28/10/2026 — Contratos da peça por banco e tese (Mesa do caso)

## Pedido
Jessica, com print da peça do Valmirio Pinto (empréstimo consignado contra o Banco Itaú S.A., parceria INFINITY LAW): a peça citava um empréstimo do BANCO PAN e um cartão RMC da FACTA. "RCC e RMC de um único banco é junto, mas isso não é junto." Pediu "uma forma de você me trazer tudo que ele tem e eu poder associar e produzir uma peça só", relacionando o tipo (RCC, RMC, empréstimo) e a parte contrária.

## Feito
- **Causa:** a ficha de fatos levava todos os contratos do extrato do INSS (todos os bancos) ao cálculo do indébito e ao redator. O "processo único" de 22/10 junta cards, não contratos.
- **Regra nova:** `src/services/contratosDoCaso.ts` (`separarParaPeca`, `inventarioDaPeca`, `mesmoBanco`, `chaveContrato`, `familiaDoContrato`). Sem decisão da Dra., entra só o contrato do banco do réu e da mesma família de tese; contrato sem banco fica fora; os descontos seguem os contratos.
- **Esteira:** `esteiraPeca.ts` aplica a regra antes do cálculo, guarda todos os contratos lidos no cliente e manda ao redator a lista "NÃO SÃO DESTA PEÇA". `levantarContratos` só lê os contratos, sem redigir. `pecaDossie.ts` traz o prompt `promptContratos`, o banco nos descontos e a seção "Ficaram fora desta peça" no dossiê.
- **Banco:** tabela `cliente_contratos` (migration 171, só tabela nova). `contratosSalvos` e `guardarContratos` ficam em `esteiraPecaMysql.ts`.
- **Tela:** Mesa do caso → aba Caso → "Contratos nos documentos" (`public/mesa.js`, `styles.css`), com os contratos por banco, entra ou fica fora e o motivo, um seletor de destino e o botão "Ler os contratos agora". Rotas `GET /api/mesa/:caseId/contratos`, `POST /api/mesa/:caseId/contratos/levantar` e `PUT /api/mesa/contrato/:id`.
- **Docs:** `docs/manual/06-documentos.md`, `14-runbook.md` (incidente), `17-decision-log.md`, `GLOSSARY.md` e `docs/api/rotas.md`.

## Verificado
- `npm test`: 1.106 testes passam, 0 falhas, 33 pulados (os que usam banco rodam no CI). Testes novos: 16 em `tests/contratosDoCaso.test.mjs` e 3 em `tests/esteiraPeca.test.mjs`. O caso Valmirio está reproduzido no teste.
- `tsc` sem erro; lint sem aviso nos arquivos alterados.
- Tela: página de teste com o `mesa.js` real e a API simulada pelas regras reais. Antes das escolhas, 1 de 4 contratos entra; depois de mudar o destino de dois contratos, 2 de 4. A largura de celular (390 px) fica sem rolagem lateral. Os prints ficaram no scratchpad da sessão.
- Teste de ponta a ponta novo em `e2e/essencial.spec.mjs`. **Não rodou localmente**: o MySQL local pede uma senha que não está no `.env`. Ele roda no CI.
- **Não verificado em produção:** a consulta (só leitura) ao caso do Valmirio foi bloqueada pela permissão. A causa foi confirmada pelo código.

## Decisões e porquês
Estão no decision log (28/10). Em resumo:
- os contratos são do cliente, e a decisão é por contrato;
- a regra automática é conservadora: na dúvida, o contrato fica fora e aparece na mesa;
- filtrar só pelo prompt foi descartado, porque o cálculo em código continuaria somando os outros bancos.

## Pendente
- **Jessica/Dra.:** na mesa do Valmirio, "Ler os contratos agora", conferir os destinos e "Gerar nova versão". As peças já geradas não mudam sozinhas.
- **Observar:** se os nomes de bancos do HISCON batem com os réus cadastrados. Grupos com nomes diferentes (ex.: Olé/Santander) precisam de associação à mão.
- **Ideia, não feita:** criar o processo novo direto de um contrato "sem processo" (ex.: os do PAN do Valmirio).

## Próxima sessão
Ver no GitHub Actions se o CI passou (ponta a ponta incluído). Depois, se a Jessica pedir, criar um processo a partir dos contratos sem destino. Skills: `domain-modeling`, `tdd`, `verification-before-completion`.
