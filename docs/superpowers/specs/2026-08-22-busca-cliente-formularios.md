# Busca de cliente nos formulários (substituir lista de até 100)

**Data:** 2026-08-22
**Status:** aprovado para implementação

## Contexto

Praticamente todo formulário do CRM que precisa "escolher um cliente" carrega a lista
inteira via `api('/api/clients?limit=100')` e monta um `<select>` HTML simples com
`clients.data.map(...)`. A rota `GET /api/clients` (`src/routes/clients.ts:55-96`) tem um
teto de segurança de 100 registros por página (`Math.min(100, ...)`, linha 62) — mesmo que o
front pedisse mais, a API corta em 100.

Isso quebrou na prática: a cliente Waleska Gera Leal Welsing (id 109) não tem nenhum
processo vinculado (`cases` vazio para ela). A listagem ordena por
`(SELECT MAX(lp.last_movement_at) ...) DESC, name ASC` — clientes sem movimentação de
processo caem para o fim da ordenação. Com 108 clientes cadastrados, ela ficou fora dos 100
primeiros e **não aparecia em nenhum desses formulários**, mesmo estando cadastrada e ativa.

Aumentar o limite (100 → 500, por exemplo) só adia o problema até a base crescer de novo, e
piora o peso de carregamento de toda tela que usa esses formulários, mesmo quando ninguém
precisa da lista inteira. A correção é trocar "carrega tudo, rola a lista" por "digita,
busca só quem interessa" — a rota já suporta isso (`?search=`, filtra por
`name`/`cpf_cnpj`/`email`, `src/routes/clients.ts:68-72`), só não é usada nesses formulários.

## Objetivo

Um componente único de busca de cliente, reutilizado nos 10 lugares do sistema que hoje
usam o padrão `<select>` com lista de até 100 clientes, sem framework novo — segue as
convenções já existentes do projeto (`public/app.js`, funções globais `field()`, `el()`,
`api()`, frontend vanilla sem build step).

## Design aprovado

### Comportamento do componente

- Campo de texto (não mais `<select>`). Usuária digita pelo menos 2 caracteres do nome (ou
  CPF/CNPJ) do cliente.
- Após um pequeno atraso de digitação (debounce ~400ms — mesmo padrão já usado em
  `attachConflictCheck`, `public/app.js:5428-5453`), chama
  `GET /api/clients?search=<texto>&limit=15` (a rota já suporta `search`; parâmetro `limit`
  reduzido de 100 para 15 — é busca, não listagem, não precisa de mais que isso por
  consulta).
- Uma lista pequena aparece flutuando abaixo do campo com os até 15 resultados (nome +
  CPF/CNPJ, quando houver, para diferenciar homônimos). Clicar em um resultado:
  - preenche o campo de texto visível com o nome do cliente escolhido;
  - guarda o `id` num campo oculto (`<input type="hidden">`) com o mesmo `name` que os
    formulários já esperam (ex.: `client_id`) — **não muda o formato do body enviado no
    submit**, os formulários continuam funcionando exatamente como hoje nesse ponto;
  - fecha a lista de sugestões.
- Sem resultado (busca sem match) mostra uma linha "Nenhum cliente encontrado" na lista, sem
  quebrar o formulário.
- **Pré-seleção**: quando o formulário abre já com um cliente definido (editar um registro
  existente, ou criar a partir da ficha de um cliente específico), o campo mostra o nome do
  cliente já preenchido e o campo oculto já com o `id` — sem precisar buscar de novo. Só
  refaz a escolha se a usuária decidir digitar algo nele.
- Clicar fora da lista de sugestões (ou apertar Escape) fecha a lista sem limpar a seleção
  já feita.

### Onde entra no código

Novo componente `clientSearchField(name, label, opts)` em `public/app.js`, próximo aos
outros helpers de formulário (`field()`, `attachConflictCheck()`, por volta da linha 5417).
Duas partes, como o padrão já usado por `attachConflictCheck`:

1. Uma função que gera o HTML do campo (label + input de texto + input oculto + container da
   lista de sugestões), para ser interpolada dentro do template do formulário — mesmo
   contrato de `field()`.
2. Uma função `wireClientSearch(form, name)` que liga o comportamento (debounce, chamada à
   API, clique nas sugestões, Escape) depois que o formulário já está no DOM — mesmo padrão
   de `attachConflictCheck(form)`.

### Formulários afetados (troca do `<select>` client_id pelo componente novo)

Os 10 pontos confirmados em `public/app.js` que hoje fazem
`api('/api/clients?limit=100')` para montar um `<select>` de cliente (linhas conferidas
diretamente no código, buscando por essa string exata):

1. `renegociar-btn` handler (linha 4746) — modal de renegociação de parcelas
2. `acordoForm` (linha 5182) — Financeiro → Acordos
3. `receitaForm` (linha 5330) — Financeiro → nova receita
4. `caseForm` (linha 6070) — novo processo
5. `eventForm` (linha 6680) — novo compromisso de agenda
6. `financialForm` (linha 6780) — novo lançamento financeiro
7. `userForm` (linha 6806) — novo usuário, campo "Cliente vinculado" (só quando papel =
   cliente)
8. `dativeCaseForm` (linha 7014) — nova demanda dativa
9. `contractForm` (linha 7263) — novo contrato
10. `processForm` (linha 7567) — novo processo (fluxo mais completo, com advogados/tribunais)

Cada um desses pontos: troca a linha `const clients = await api('/api/clients?limit=100')`
(e o `field('Cliente...', 'client_id', { options: clients.data.map(...) })` correspondente)
pelo novo componente, e adiciona a chamada de `wireClientSearch(form, 'client_id')` depois
que o form é montado — sem alterar mais nada da lógica de cada formulário.

## Fora de escopo

- Não mexe na rota `GET /api/clients` além de já usar o `search` que existe (nenhuma mudança
  de backend é necessária — a busca já funciona).
- Não mexe em listas de outras entidades (advogados, parceiros, tribunais) mesmo que usem
  padrão parecido — só client_id.
- Não aumenta o limite de 100 da rota (decisão explícita da usuária: a busca resolve sem
  precisar tocar nesse teto).
- Não adiciona cadastro de cliente novo "inline" a partir da busca (se não achar, a usuária
  cadastra separadamente e volta ao formulário).

## Testes

- Componente de busca não tem lógica de servidor nova para testar com `node --test`
  (reaproveita a rota `search` já existente e já cobriria por testes de `clients.ts` se
  houver). A verificação é funcional/manual: digitar nome da Waleska num dos formulários
  trocados e confirmar que ela aparece e é selecionável.
- Conferir manualmente que os 10 formulários listados continuam enviando `client_id`
  corretamente no submit (mesmo formato de antes) — evitar regressão silenciosa onde o campo
  oculto não é preenchido corretamente antes do envio.
