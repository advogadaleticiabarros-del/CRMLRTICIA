# Uma peça por banco na leitura dos extratos (30/10/2026)

## Pedido
Jessica: "confira os extratos: se forem RCC e RMC de banco diferentes devem ser duas peças; se for RMC de um banco e RCC de outro, peças diferentes. Isso precisa ser confirmado também na leitura dos documentos."

## Feito
- **`conferirPecasPorBanco`** em `src/services/contratosDoCaso.ts`: compara os cartões RMC/RCC lidos (`cliente_contratos`, sem os que a Dra. tirou das peças) com as ações do cliente. Problemas apontados: `falta_acao`, `bancos_misturados` (ação contra dois bancos, ou contrato posto na ação de outro banco), `acao_sem_contrato`, `banco_nao_identificado`, `mesmo_banco_separado` e `nao_lidos`. Empréstimo consignado fica fora desta conferência.
- **Leitura dos documentos (`esteiraPeca.ts`):**
  - `levantarContratos` (botão "Ler os contratos agora") devolve a conferência, registra a ação do agente, e o aviso do sino mostra os problemas;
  - `produzirPeticao` põe os problemas em "A conferir" do dossiê, com o prefixo "Uma peça por banco:";
  - a dependência nova `acoesDoCliente` fica em `esteiraPecaMysql.ts`.
- **Telas:**
  - bloco "Uma peça por banco" no card do cliente (`loteProducao.ts` → `Lote.conferencia`; `loteProducaoMysql.ts` carrega os contratos; `public/loteCliente.js`);
  - aviso na Mesa → aba Caso → "Contratos nos documentos" (`routes/mesa.ts`, `public/mesa.js`).
- **Documentação:**
  - `docs/manual/06-documentos.md` (bloco + Changelog), copiado para o Obsidian;
  - regra em `docs/contexto/LEIA-PRIMEIRO.md`.

## Verificado
- Testes novos: `tests/conferenciaPecasPorBanco.test.mjs` (10) e 3 em `tests/esteiraPeca.test.mjs`, escritos antes do código.
- `npm run build` ok. ESLint sem avisos nos arquivos alterados. `npm test`: 1.196 passaram, 0 falharam, 33 pulados (os de banco, que rodam no CI).
- **Não verificado:** as telas não foram abertas no navegador, e nada foi conferido com dados reais em produção.

## Decisões e porquês
- **Só cartão consignado (RMC/RCC):** o extrato traz todos os empréstimos, inclusive os que o cliente não contesta. Cobrar uma ação para cada empréstimo encheria a tela de avisos falsos.
- **Ação sem tese no título vale pelo banco do réu:** títulos como "Ação contra o Pan" não dizem a tese.
- **Só avisa, não cria nem separa ações sozinho:** dividir ou juntar processos é decisão da Dra.

## Pendente
- **Caso dos 6 bancos:** falta o HISCON. Sem ele, os cartões vêm sem banco e a conferência mostra "banco não identificado".
- **Leitor determinístico HISCON + HISCRE:** proposto no relatório `2026-10-30-demonstrativo-de-descontos.md`.

## Próxima sessão
Abrir o card de um cliente com extrato completo em produção e conferir o bloco "Uma peça por banco". Skills sugeridas: `webapp-testing` e `verification-before-completion`.
