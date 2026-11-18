# Classificação, temperatura e partes dos processos — 18/11/2026

## Pedido
Jessica:
- "consegui conectar o TJ ES 1 grau. Faça os cadastros, se precisar criar campos para completar pode criar, inclua inclusive dados das partes contrárias";
- "faça tudo: classificação de tipo de caso, tipo de justiça, em que fase está, tudo que precisar para acompanharmos de forma efetiva";
- "atualize também os valores e a temperatura de cada processo, se está a nosso favor ou não de acordo com as decisões. O que não tiver resposta é morno. Teste uma forma de classificar isso".

## Feito
- **Commit 57bfce6:**
  - regras puras em `src/services/classificacaoProcesso.ts`: justiça, instância, área e temperatura;
  - banco e DataJud em `src/services/classificacaoProcessoMysql.ts`; migration 184;
  - MNI lê RG, sexo, mãe, pai, naturalidade, nacionalidade e a OAB dos advogados de cada parte (`src/services/mni/cliente.ts`);
  - `partesParaGravar` e `representadaPeloEscritorio` em `fichaPeloTribunal.ts`; `gravarPartesEVincular` em `src/services/mni/index.ts`;
  - telas: ficha do cliente com os campos novos, janela do processo com temperatura, classificação e partes, Termômetro com "Como estão as decisões", coluna Decisões e filtro por área.
- **Commit fe4ad38:**
  - DataJud limitado a 30 consultas por rodada, parando no 429 (migration 185); rotina 2x/dia;
  - partes contrárias copiadas para `case_partes` e polo do caso preenchido.
- Docs: manual 04 (duas seções), 01 (qualificação), decision log; espelho no Obsidian.

## Verificado
- Testes: `tests/classificacaoProcesso.test.mjs` (8), `tests/mniPartes.test.mjs` (8) e `tests/termometroCasos.test.mjs` (+1). `npm test`: 1545 ok, 0 falhas. Lint: 0 erros. Os dois deploys passaram.
- **Teste da regra de temperatura em produção**, só leitura, antes de ligar: 41 quentes, 24 frios e 100 mornos, de 165 processos. Conferi uma amostra: acordo sai quente, improcedência fria, cliente ré invertida.
- **Rodada em produção:** justiça gravada em 165; temperatura em 165; área preenchida em 9. Backup antes: `/root/backups/lp-antes-classificacao-1795000000.json`.
- **Não verificado:**
  - as partes pelo TJES: a rodada manual fora do app não alcança a ponte do escritório, e o token de administrador para disparar pelo app foi barrado pelo sistema de permissões;
  - a instância, a classe e os assuntos, porque o DataJud respondeu 429;
  - as telas novas no navegador.

## Decisões
Registradas no decision log de 18/11. Resumo:
- temperatura por regra, não por IA;
- `process_parties` separado de `case_partes`;
- cota no DataJud;
- área só é preenchida quando está vazia.

## Pendente
- Depois das 15h10: conferir `process_parties`, clientes cadastrados automaticamente (observação "Cadastrado automaticamente") e `polo_cliente`.
- Classe, assuntos e instância chegam aos poucos (até 30 por rodada). Os 90 processos sem área dependem disso.
- Equipe: conferir as temperaturas marcadas "conferir", que dependem de recurso ou de polo desconhecido.

## Próxima sessão
`SELECT nossa_parte, COUNT(*) FROM process_parties GROUP BY 1`; `SELECT COUNT(*) FROM legal_processes WHERE instancia IS NOT NULL`; `job_runs` de `processos:classificar` e `monitoramento:tribunais-mni`. Skills: `verification-before-completion`; `diagnosing-bugs` se a ponte falhar.
