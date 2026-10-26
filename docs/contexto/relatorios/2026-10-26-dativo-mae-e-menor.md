# 26/10/2026 — Demanda dativa com mãe e filho menor dava erro

## Pedido
A Dra. encaminhou o alerta do Dr. Bento: `"SAMARA FRAGA SCARDUA CALMON e B. F. S. C." junta mais de uma pessoa — cadastre cada uma separadamente`, em `POST /api/dative/cases` (Administrador).

## Feito
- Regra confirmada pela Dra.: só iniciais = menor em segredo de justiça; o nome vem sempre como representante + iniciais do(s) assistido(s).
- `ehSoIniciais`, `iniciaisDoNome`, `representanteDoNome` (estrita, para o DJEN em `src/services/monitoringService.ts`); `escolherFichaExistente` ignora nome só em iniciais; `encontrarOuCriarCliente` recusa nome só em iniciais.
- Dativo grava a nota "Segredo de justiça…" na linha do tempo quando há iniciais.
- `src/services/fichaUnica.ts`: nova regra pura `titularDoNome`. Se o nome junta pessoas, devolve a primeira com nome completo; iniciais (menor) não viram ficha; só iniciais → `null`.
- `src/routes/dative.ts` (`POST /cases`): a ficha é criada ou reaproveitada com o titular; o nome inteiro continua em `assisted_name`. Só iniciais → aviso 400 em vez de 500.
- `tests/fichaUnica.test.mjs`: teste novo de `titularDoNome`.
- Documentação: runbook (incidente), `05-dativo.md` e `10-monitoramento.md` (changelog), `17-decision-log.md`; espelho do Obsidian atualizado.

## Verificado
- Teste novo falhou antes da implementação e passou depois.
- `npm run build` ok; `npm run lint` sem erros (avisos antigos, nenhum nos arquivos alterados); `npm test`: 1.087 aprovados, 0 falhas (os de banco rodam no CI).
- Não verificado: fichas antigas só com iniciais em produção (consulta negada pela permissão da sessão); deploy e cadastro real em produção. O push não foi feito nesta sessão (permissão negada); a demanda da Samara não foi salva no erro e precisa ser cadastrada de novo.

- Primeiro deploy (3b4e76f) barrado pelo portão de vulnerabilidades (avisos novos, sem relação com a correção): body-parser e nodemailer via `npm audit fix`; zod 3 → 4.6.7. Validação do `.env` conferida com zod 4 (recusa chave curta, aceita a válida); build, lint e 1.087 testes ok.

## Decisões e porquês
- A ficha vai para a primeira pessoa de nome completo, em vez de recusar ou criar uma ficha por pessoa. A demanda tem um só cliente; o menor vem só com iniciais (ECA); quem a equipe atende é a mãe/representante.
- As outras rotas (parceria, atendimento, lead, contrato, publicações) continuam recusando nomes juntos, de propósito.

## Pendente
- Conferir se o deploy após a atualização do zod passou (ver ESTADO).
- Jessica: liberar a consulta em produção para rever fichas antigas com nome só em iniciais (ligar ao representante).
- Jessica/Dra.: liberar o push (commit local pronto) e acompanhar o deploy.
- Dra.: cadastrar de novo a nomeação da Samara (mãe e B. F. S. C.).

## Próxima sessão
Conferir se o commit chegou à `main` e o workflow Testes passou (`gh run list`). Se a mesma mensagem aparecer noutra rota, aplicar `titularDoNome` ali (skills: diagnosing-bugs, tdd).
