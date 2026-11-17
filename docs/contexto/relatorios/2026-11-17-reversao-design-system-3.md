# 17/11/2026: Reversão do design system 3.0

## Pedido

A Jessica, depois de ver o design system 3.0 em produção:

- "não ficou bom, existem telas com limites, as divisões não ficaram boas, estava melhor antes, estava tudo mais organizado, quero que volte como estava, exatamente como estava";
- "se fosse um design com poucas alterações, sem mudar o uso, poderia manter, mas foi limitado telas, ficou inconsistente".

## Feito

- `git revert` do commit 505c4dc (design system 3.0) por inteiro, sem manter nenhuma parte.
- O código e as telas voltaram a ser idênticos ao commit 9a1b801. O índice ficou igual a 9a1b801 antes de os registros abaixo serem acrescentados.
- Os seguintes itens saíram junto com o resto:
  - `DESIGN.md`;
  - a diretriz de interface do `CLAUDE.md`;
  - o teste `tests/designSystem.test.mjs`;
  - os registros do 3.0 em `docs/manual/00`, `14` e `17`;
  - o relatório anterior.
- Registros novos: uma linha em `docs/contexto/ESTADO.md` e uma em `docs/manual/17-decision-log.md`.

## Verificado

- `git diff --cached 9a1b801` vazio para todo o código depois do revert.
- `npm run lint` e `npm test` antes do push. CI e deploy acompanhados com `gh run watch`.

## Decisões

- **Voltou tudo, não só as partes de largura e divisão.** Ela pediu "exatamente como estava". Isso também desfaz as correções que vieram junto:
  - nomes ilegíveis no modo escuro do celular;
  - sombra da gaveta;
  - data com maiúsculas.

## Pendente

- Nada aberto. Se ela quiser de volta alguma correção pontual do 3.0 (por exemplo o modo escuro do celular), fazer como mudança pequena e isolada, que não altere o uso nem a largura das telas.

## Próxima sessão

- **Não refazer revisão visual ampla sem pedido novo.** Se houver pedido, mostrar antes a prévia de cada tela real e só publicar com aprovação.
