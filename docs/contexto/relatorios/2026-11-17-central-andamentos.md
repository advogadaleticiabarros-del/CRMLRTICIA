# Central de andamentos, ação nova de cliente e audiência na agenda — 17/11/2026

## Pedido
"Vamos fazer tudo isso: a central de andamentos (prévia antes), o aviso de ação nova contra cliente, a audiência entrando sozinha na agenda." Depois da prévia: "quero ver sendo montada com os movimentos" (ver na tela real, com os andamentos de verdade).

## Feito
- Prévia (dados fictícios) no artefato "Central de andamentos — prévia" (claude.ai/artifact/QoLUXbFybZAfbL8CFEEj4n).
- **Central** (tela Andamentos nos tribunais, mesma rota `#monitor`): abas Caixa de entrada, Intimações pendentes, Ações novas de clientes e Processos monitorados (a tabela antiga, sem mudança). Quatro números no topo.
  - Caixa: lida/tratada pela equipe (migration 181: colunas em `process_movements`; mais de 7 dias entram como lidas), filtros, "Criar prazo" com caso/data/descrição preenchidos (`deadlineForm(onSave, preset)`), "Abrir processo".
  - `src/services/centralAndamentos.ts`, rotas `/api/andamentos` (equipe).
- **Ação nova de cliente:** navegador busca o nome de cada cliente ativo no DJEN (7 dias, 1x/dia, lotes de 20, para em 429/403); servidor guarda só nome exato em processo desconhecido (`acoes_novas_clientes`); confirmar cadastra o processo ligado ao cliente; descartar não volta. `src/services/acoesNovasClientes.ts`.
- **Audiência na agenda:** `src/services/audienciaDetectada.ts`, ligado nos dois pontos que gravam movimentação nova; data + hora futuras; evento de audiência na agenda da Dra. (e Google), aviso no sino, sem duplicar (`audiencias_detectadas`).
- Correção da entrega MNI: nome do órgão cortado em 120 caracteres (tamanho de `legal_processes.court`).

## Verificado
- `tests/centralAndamentos.test.mjs` (11 testes): formatos de data/hora de audiência, casos que não lançam, tipo do andamento, fonte, nome pesquisável, filtro de homônimo e processo conhecido, busca no navegador com parada em bloqueio, tabela antiga preservada.
- `npm run build` ok; `npm run lint` 0 erros; `npm test` 1494 ok, 0 falhas (34 pulados sem banco; rodam no CI).
- Não verificado ainda: a tela com dados reais em produção e a primeira busca de ações novas (dependem do deploy e de alguém abrir o CRM).

## Decisões
- Lida/tratada da equipe, não por usuário; ação nova só com nome exato e confirmação humana; audiência só com hora (decision log 17/11).

## Pendente
- Conferir a tela em produção com a Dra. e ajustar o que ela pedir.
- Busca por CPF/CNPJ (só em API paga) fica para depois.

## Próxima sessão
Ver `acoes_novas_buscas` (a busca rodou? `bloqueado`?) e `audiencias_detectadas` depois das primeiras rodadas.
