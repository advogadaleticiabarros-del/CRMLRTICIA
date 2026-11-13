# 13/11/2026 — Incluir relato e audiência na ficha do dativo

## Pedido
Jessica mandou um print das seções "Relatos", "Audiências" e "Documentos" da ficha da demanda dativa: "quero poder incluir isso no card dos dativos".

## Feito
- `public/app.js`, função `dativeCaseDetail`: as seções Relatos e Audiências ganharam o botão "+ Incluir". O "+ Incluir relato" do topo continua lá e usa a mesma função.
- `public/app.js`, função `dativeHearingForm(onSave, caso)`: aceita a demanda opcionalmente. Vindo da ficha, a demanda vai num campo oculto e a comarca já vem preenchida. Depois de salvar, a ficha abre de novo. Pela aba Audiências, nada mudou.
- Documentos: já tinham anexo na própria ficha (`dativeDocsSection`), então ficaram como estavam.
- Back-end: nenhuma mudança. `POST /api/dative/hearings` já recebia `dative_case_id` e confere se a demanda é da usuária.
- Teste novo: `tests/dativoIncluirNaFicha.test.mjs` (4 casos).
- Manual: `docs/manual/05-dativo.md` (seção Audiências + Changelog), com cópia no espelho do Obsidian.

## Verificado
- `node --check public/app.js`: sem erro.
- `npm run lint`: 0 erros (32 avisos que já existiam).
- `npm run build`: ok.
- `npm test`: 1440 testes, 1406 passaram, 0 falhas (os outros foram pulados).
- **Não verificado no navegador** nem em produção.

## Decisões e porquês
- Entendi "incluir isso" como poder **adicionar** itens em cada seção, porque as três seções já apareciam na ficha. Mostrar relatos e audiências no cartão do quadro foi descartado: o cartão ficaria cheio.
- A audiência reaproveita o formulário que já existe, sem criar outro.

## Pendente
- Se ela queria ver relatos e audiências no **cartão da lista** (não na ficha aberta), isso ainda falta. Quem decide é a Jessica.

## Próxima sessão
Abrir uma demanda dativa em produção, clicar em "+ Incluir audiência" e conferir se ela aparece na lista e na agenda. Skills: `webapp-testing`, `verification-before-completion`.
