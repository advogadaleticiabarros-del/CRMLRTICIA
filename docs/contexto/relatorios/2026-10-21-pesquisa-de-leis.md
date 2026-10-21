# 21/10/2026 — Pesquisa de Leis (acervo ctresb/leis, Dra. Júlia e Dra. Vera)

## Pedido
A Jessica pediu "um novo módulo, um painel onde eu possa pesquisar leis", a partir de `gh repo clone ctresb/leis`. Depois de ver a proposta: "pode seguir, precisamos usar isso plenamente com o pesquisador, com o produtor das peças etc. Desde consulta à produção, à revisão e validação."

## Feito
- **Acervo:**
  - cópia parcial do repositório público ctresb/leis (só a versão atual e só as pastas úteis; lista em `PASTAS_DO_ACERVO`): 76.142 normas e 437 mil artigos e enunciados;
  - indexado num SQLite à parte (`node:sqlite`, FTS5 sem acento), em `/home/crmapp/leis` na VPS.
- **Módulos (deep modules com dependências injetadas):**
  - `src/services/leisTexto.ts`: regras puras;
  - `leisAcervo.ts`: índice;
  - `leisSync.ts`: git, com reindexação só do que mudou;
  - `leisPesquisa.ts`: Dra. Júlia e Dra. Vera;
  - `leisServico.ts`: o que o resto do CRM chama;
  - `src/routes/leis.ts`, `src/scripts/leisAtualizar.ts` e `public/leis.js`: rota, script de atualização e tela.
- **Tela "Pesquisa de Leis":**
  - busca por palavras ou citação ("art 482 clt"), com filtros e atalhos dos códigos;
  - leitor da lei com sumário e "Copiar citação";
  - abas "Conferir citações" e "Fundamentos para a peça".
- **Produção:**
  - a Dra. Júlia entrega fundamentos conferidos ao Enzo (`aiAssistant.ts`), à petição inicial e à análise do caso (`peticaoBuilder.ts`) e ao Assistente de IA (`routes/ai.ts`);
  - a Dra. Vera entra no parecer do revisor (`peticaoReviewer.ts`).
- **Assistente do WhatsApp:** responde consulta de lei sem IA (dependência `leis` em `assistenteWhatsapp.ts`).
- **Escritório virtual:** Júlia e Vera saem de "em construção".
- **Rotina `leis:atualizar`:** domingo às 5h15 e no boot, se o acervo não existe. Roda em processo separado.
- **Documentação:**
  - `docs/manual/18-pesquisa-de-leis.md` (novo);
  - 00, 03, 06, 13, 16 e 17 atualizados (três decisões no decision log);
  - espelho do Obsidian copiado;
  - `docs/api/rotas.md` regerado;
  - ESTADO.md.

## Verificado
- **Testes:** `npm test` com 1.062 testes, 0 falhas e 33 pulados (os que precisam de MySQL, que não roda neste computador; no CI eles rodam). 59 testes novos dos módulos de leis e da tela. Build e tipos sem erro; lint com 0 erros.
- **Acervo real indexado no computador:** 76.142 normas, 0 erros, cerca de 7 minutos, índice de cerca de 0,7 GB. Buscas levaram de 3 a 90 ms.
- **Conferência de uma peça com 14 citações:** todas classificadas certo, inclusive ADCT, RPS, OJ, tema, artigo inexistente e súmula inventada.
- **Com a IA real (OpenAI):**
  - a Dra. Vera apontou que o art. 7º, XXIX, da CF "não sustenta" a prescrição de dez anos plantada no teste;
  - a Dra. Júlia separou, para uma gestante terceirizada, ADCT art. 10, CLT arts. 391 e 477, Súmulas 244 e 331 do TST e a Lei 6.019.
- **Tela vista no Edge** (computador e celular), num servidor de teste com a rota real e o acervo real: sem erro de JavaScript. Não foi testada com o CRM inteiro aqui, porque o MySQL local recusou a conexão; o teste de ponta a ponta do CI passou a abrir a tela.
- **Na VPS:** Node 22.23 com `node:sqlite` e FTS5 testados, `git` instalado, 66 GB livres. **Não verificado ainda:** o 1º download e a indexação na VPS depois do deploy (ver Pendente).

## Decisões e porquês
- **SQLite à parte, fora do MySQL e do backup:** o MEGA já lota em dezembro e o acervo se refaz do GitHub (decision log).
- **A IA sugere, o índice confere:** o que não existe ou foi revogado nunca chega ao redator; a opinião da IA sobre o sentido só aparece como "a rever".
- **Decretos federais só de 1988 em diante**, mais os regulamentos consolidados (RPS).
- **Achados no teste real e corrigidos:**
  - jurisprudência não é quebrada por "Art." citado no precedente;
  - hifenização dos PDFs do TST desfeita;
  - o trecho do § ou inciso citado vai à IA (antes, só o começo do artigo, o que gerava "parcial" falso);
  - **súmula ou OJ cancelada só no enunciado** passa a contar como cancelada (a OJ SDI1-88 tinha entrado como fundamento).
- **`VERSAO_REGRAS`** (hoje 4): ao mudar as regras de leitura, a próxima atualização relê o acervo todo.

## Pendente
- **Conferir na VPS, depois do deploy:**
  - se `leis:atualizar` rodou: Escritório virtual → Dra. Júlia, ou `ls -la /home/crmapp/leis` e o log do PM2;
  - se a tela abre com "76.142 normas".
- **Fora do acervo:** jurisprudência de TRT17, TRF2 e TJES e leis do RJ. Precisaria de outra fonte; a decisão é da Dra. e da Jessica.
- **Observar** as primeiras minutas e revisões reais com a seção "CONFERÊNCIA DAS CITAÇÕES".

## Próxima sessão
1. Ver no PM2 o log do boot (`leis:atualizar`) e o tamanho de `/home/crmapp/leis/acervo.db`.
2. Abrir a tela em produção e pesquisar "art 482 clt".
3. Na primeira revisão real, ler a seção da Dra. Vera.

Skills sugeridas: `diagnosing-bugs`, se a indexação na VPS falhar, e `tdd` para qualquer ajuste nas regras de citação (`tests/leisTexto.test.mjs`).
