# Valor da causa e partes vindos do tribunal — 18/11/2026

## Pedido
Jessica, sobre o que o login dos tribunais permite: "quero tudo isso" (fichas completadas, intimações pendentes com ciência automática, andamentos direto do tribunal, valor da causa e lista de partes) e "me dê o passo a passo" do que depende delas.

## Feito
- Os três primeiros itens já estavam programados (commits c8e1e81 e ceb2266) e só esperam o login salvo.
- O quarto não estava: o tribunal devolvia valor da causa e partes, mas nada era guardado. Agora:
  - `resumoDasPartes` (`src/services/mni/fichaPeloTribunal.ts`): só polo, nome e tipo de pessoa.
  - Dependência `guardarDadosDoProcesso` em `src/services/mni/monitorMni.ts`; gravação em `src/services/mni/index.ts`.
  - Migration 183: `legal_processes.valor_causa`, `partes_json`, `dados_tribunal_em`. O caso ligado só recebe o valor se estiver vazio.
  - Janela do processo (`processoDadosTribunal` em `public/app.js`) mostra o quadro quando há dado.
- Docs: `docs/manual/10-monitoramento.md` (seção e changelog), espelho no Obsidian, ESTADO.

## Verificado
- `tests/mniPartes.test.mjs` com 2 testes novos (6 ok); `npm test`: 1509 ok, 0 falhas, 34 pulados; lint 0 erros; build ok.
- **Não verificado:** com resposta real do tribunal (falta o login) e a janela no navegador.

## Decisões
- CPF, nascimento e endereço das partes não ficam no processo: só vão para a ficha do cliente, pela regra já existente.
- Valor da causa digitado pela equipe no caso nunca é sobrescrito.

## Pendente
- Jessica/Dra.: salvar os logins do TJES 1º grau e do eproc; conferir as fases em "Fases dos processos"; escolher o telefone da ficha nº 6 (ficha da própria Dra.).

## Próxima sessão
Depois do login salvo, ver o resumo da rotina `monitoramento:tribunais-mni` (`campos_de_ficha_completados`) e conferir `SELECT COUNT(*) FROM legal_processes WHERE dados_tribunal_em IS NOT NULL`. Ver também a primeira rodada real de `prazos:agente`. Skills: `verification-before-completion`.
