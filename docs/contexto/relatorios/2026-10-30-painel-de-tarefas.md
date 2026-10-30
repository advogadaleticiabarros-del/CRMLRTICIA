# 30/10/2026 — Painel de tarefas: barra e confirmação de conclusão

## Pedido
Jessica: "toda a ação preciso de confirmação de conclusão, pode colocar barras também para acompanhamento, exemplo leitura de documentos, atualização de pasta, tudo que eu precise esperar para finalizar".

## Feito
- Registro de tarefas na memória do servidor: `src/services/tarefasEmAndamento.ts` (iniciar/rodar, etapa com contagem, acompanhar uma fonte externa, concluir/falhar, OK).
- Rotas `src/routes/tarefas.ts`: `GET /api/tarefas`, `POST /api/tarefas/:id/ok`, `POST /api/tarefas/ok` (montadas em `src/app.ts`, só equipe).
- Ações que viraram tarefas (o sino continua): ler a pasta do Drive / analisar (`routes/cases.ts`, com andamento arquivo por arquivo via `pastaDrive.sincronizarPasta` e `peticaoBuilder.analyzeCaseDrive`), ler os contratos, analisar e revisar (`routes/mesa.ts`), geração da peça (`geracaoPeca.ts` ganhou o dep opcional `tarefa`, ligado em `geracaoPecaMysql.ts` às etapas da trava).
- Tela: `public/tarefas.js` (painel fixo no canto, barra, etapa, tempo, "✓ Concluído"/"✕ Não concluído" até o OK, "OK em todas", "Abrir o caso", recolher). A Mesa se atualiza quando uma tarefa do caso termina; a barra própria da Mesa (`.mesa-gerando`) saiu, e o botão continua travado com a etapa. Toast passou de 3 s para 5 s (erro, 9 s) e sobe acima do painel.
- Documentação: `docs/manual/06-documentos.md` (seção "Painel de tarefas" + changelog), `docs/manual/17-decision-log.md`, `docs/api/rotas.md`.

## Ajuste (mesma noite)
Print da Jessica: a seção "Análise dos documentos" só mostrava o botão apagado. Agora a barra aparece dentro da própria seção da Mesa (análise, contratos, pasta, revisão), o botão mostra "Analisando… 38%", e a análise da Dra. Helena conta arquivo por arquivo (`analistaServico.analisarCaso`, opção `etapa`). Evento `tarefas-atualizadas` emitido por `public/tarefas.js`. Testado no navegador com o trecho real do `mesa.js`. A aba que estava aberta antes da publicação precisa ser recarregada (F5).

## Verificado
- `npm run lint`: 0 erros. `npm run build`: OK. `npm test`: 1.247 aprovados, 0 falhas, 33 pulados (os de banco, que rodam no CI). 15 testes novos (13 do registro, 1 do andamento da pasta, 1 do painel na geração).
- Painel testado no navegador (Playwright, página de teste com o CSS real e respostas simuladas): 3 tarefas rodando com barras; depois concluída/falhou com selos e aviso; OK remove; recolher funciona.
- **Não verificado em produção:** aparece na próxima ação demorada real (ex.: "Atualizar da pasta" na Mesa).

## Decisões e porquês
- Registro na memória, sem tabela: ver decision log. A peça já sobrevive a reinício por `geracoes_peca_pendentes`; para o resto, a tela mostra "o sistema foi atualizado no meio, peça de novo".
- Consulta a cada 2,5 s só com tarefa rodando (20 s parado), sem socket novo.
- Ações instantâneas continuam com o aviso rápido (toast), agora mais longo; o painel é para o que é preciso esperar.

## Pendente
- Jessica conferir o painel na próxima leitura de pasta / geração de peça.
- Outras esperas ainda fora do painel (rodam na própria tela, com texto no botão): kit .zip do cliente, "Baixar do e-mail", importar modelos do Obsidian. Dá para trazer se ela quiser.

## Próxima sessão
Se ela relatar algo do painel, começar por `public/tarefas.js` e `GET /api/tarefas`. Skills: `diagnosing-bugs`, `verification-before-completion`.
