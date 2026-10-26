# 26/10/2026 — Demanda dativa com mãe e filho menor dava erro

## Pedido
A Dra. encaminhou o alerta do Dr. Bento: `"SAMARA FRAGA SCARDUA CALMON e B. F. S. C." junta mais de uma pessoa — cadastre cada uma separadamente`, em `POST /api/dative/cases` (Administrador).

## Feito
- `src/services/fichaUnica.ts`: nova regra pura `titularDoNome`. Se o nome junta pessoas, devolve a primeira com nome completo; iniciais (menor) não viram ficha; só iniciais → `null`.
- `src/routes/dative.ts` (`POST /cases`): a ficha é criada ou reaproveitada com o titular; o nome inteiro continua em `assisted_name`. Só iniciais → aviso 400 em vez de 500.
- `tests/fichaUnica.test.mjs`: teste novo de `titularDoNome`.
- Documentação: runbook (incidente), `05-dativo.md` (changelog), `17-decision-log.md`; espelho do Obsidian atualizado.

## Verificado
- Teste novo falhou antes da implementação e passou depois.
- `npm run build` ok; `npm run lint` sem erros (avisos antigos, nenhum nos arquivos alterados); `npm test`: 1.084 aprovados, 0 falhas (os de banco rodam no CI).
- Não verificado: deploy e cadastro real em produção. O push não foi feito nesta sessão (permissão negada); a demanda da Samara não foi salva no erro e precisa ser cadastrada de novo.

## Decisões e porquês
- A ficha vai para a primeira pessoa de nome completo, em vez de recusar ou criar uma ficha por pessoa. A demanda tem um só cliente; o menor vem só com iniciais (ECA); quem a equipe atende é a mãe/representante.
- As outras rotas (parceria, atendimento, lead, contrato, publicações) continuam recusando nomes juntos, de propósito.

## Pendente
- Jessica/Dra.: liberar o push (commit local pronto) e acompanhar o deploy.
- Dra.: cadastrar de novo a nomeação da Samara (mãe e B. F. S. C.).

## Próxima sessão
Conferir se o commit chegou à `main` e o workflow Testes passou (`gh run list`). Se a mesma mensagem aparecer noutra rota, aplicar `titularDoNome` ali (skills: diagnosing-bugs, tdd).
