# Relatório — Processo único

**Data:** 22/10/2026

## Pedido
Definir quando vários cards do mesmo cliente viram uma única petição inicial e um único processo. O exemplo foi um cliente fictício com vários cards de RMC, RCC e empréstimo contra bancos diferentes. A regra da Jessica, com as respostas dela:
- **Juntam numa peça:** RMC e RCC do mesmo banco; vários empréstimos consignados do mesmo banco, incluindo refinanciamento e portabilidade.
- **Ficam separados**, mesmo contra o mesmo banco:
  - empréstimo pessoal e consignado;
  - cartão consignado e empréstimo consignado;
  - cartão comum e cartão consignado.
- **Juros abusivos:** sempre um pedido dentro da peça.

## O que foi feito
- `src/services/pecaConsolidacao.ts`:
  - `familiaDaTese` (cartão consignado, empréstimo consignado, empréstimo pessoal, cartão comum);
  - `reuDoTitulo` (banco depois de "—", "x" ou "contra");
  - `sugestoesDeJuncao` (mesmo cliente, área, banco e família, antes do protocolo);
  - `casosCorrelatos`, que passou a exigir a mesma família.
- **Migration 169:** coluna `cases.unido_ao_caso`.
- **Rotas:**
  - `GET /api/mesa/sugestoes-juncao`;
  - `POST /api/mesa/juntar` (mesmo cliente, antes do protocolo; o principal é o que já tem pedidos, depois o mais adiantado, depois o mais antigo);
  - `POST /api/mesa/:id/separar`.
- **Quadro:**
  - faixa "processos únicos possíveis", com a confirmação por grupo;
  - os pedidos unidos somem do quadro e o card do processo mostra "+N pedidos";
  - mover o card do processo leva os pedidos junto: etapa, nº do processo e data do protocolo.
- **Mesa:** a aba Caso mostra os "Pedidos neste processo", com "Separar"; o pedido unido mostra o atalho para o processo.
- **Esteira da peça:** junta só o grupo confirmado. Pedido unido gera a peça do principal. A leitura dos contratos separa consignado, pessoal, RMC, RCC e cartão comum.

## Verificado
- 6 testes novos da regra; teste de consolidação antigo atualizado com a família; suíte inteira sem falhas; lint sem erros; auditoria do SQL.
- Teste de ponta a ponta novo: três cards do mesmo cliente (RCC, RMC e empréstimo pessoal, todos do "Banco Teste"); o quadro sugere juntar só RCC + RMC; depois de juntar sobram 2 cards e um deles mostra "+1 pedido".

## Pendente
- **Casos sem banco identificado:** casos antigos com título genérico ("empréstimo consignado") e sem parte contrária não são sugeridos. Cadastrar a parte contrária, ou pôr o banco no título, resolve.
- **Teto do Juizado:** o aviso de que a soma dos pedidos passa do teto ainda não existe.
- **Avisos ao cliente:** continuam pela fila automática no Protocolado e no Concluído (decisão da Jessica em aberto).
