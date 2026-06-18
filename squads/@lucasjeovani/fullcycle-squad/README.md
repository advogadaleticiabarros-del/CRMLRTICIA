# FullCycle Squad

Squad de desenvolvimento **ponta a ponta** para a plataforma **ExpxAgents** — 9 especialistas cobrindo o ciclo completo de entrega: do planejamento e arquitetura ao deploy e monitoramento, passando por dados, backend, frontend, mobile, desktop, integrações e QA.

## Estrutura

```
fullcycle-squad/
├── squad.yaml          ← FONTE ÚNICA DA VERDADE: membros, orquestração, regras
├── personas/           ← instruções operacionais de cada membro (como trabalha,
│   └── <id>.md            checklist de entrega, quando escalar)
├── _memory/
│   └── memories.md     ← memória da SQUAD: aprendizados genéricos entre projetos
└── projects/
    └── <projeto>/      ← contexto POR PROJETO: docs, decisões e memórias
        └── _memory/
```

## Identidade dos membros: role-first

Cada membro é identificado primariamente pela **especialidade** (`id`) — é ela que aparece no roteamento, nos handoffs e nos nomes de arquivo. O **callsign** é um apelido humano opcional, usado apenas na atribuição de fala (`speaker_attribution: both` exibe `Tech Lead (Benjamin):`).

Você pode renomear os callsigns livremente para o seu time — nenhuma regra de orquestração depende deles. Também pode mudar `speaker_attribution` para `role` (só especialidade) ou `name` (só apelido).

## Membros

| id | Role | Callsign | Foco |
|----|------|----------|------|
| `techlead` | Tech Lead | Benjamin | Arquitetura & governança de código |
| `dba` | DBA | Lucas | Banco de dados, RLS, migrations |
| `backend` | Backend Developer | Roger | APIs, Edge Functions, server-side |
| `frontend` | Frontend Developer | Ludmila | React, design systems, acessibilidade |
| `mobile` | Mobile Developer | Thiago | React Native, Flutter, iOS/Android |
| `desktop` | Desktop Developer | Marcos | Electron, Tauri, cross-platform |
| `integrations` | Integration Specialist | Juliana | n8n, webhooks, integrações API |
| `qa` | QA & Test Engineer | Camila | Estratégia de testes, automação, quality gates |
| `cloud` | Cloud Infrastructure | Matheus | Deploy, CI/CD, observabilidade |

## Como a squad conduz a conversa

A FullCycle não sai implementando ao receber um pedido — ela conduz o usuário por **5 fases**, definidas em [`personas/_protocolo-dialogo.md`](personas/_protocolo-dialogo.md) e seguidas por todos os membros:

1. **Descoberta** — reformula o pedido, faz as perguntas do domínio em blocos pequenos (2–4 por vez) e oferece padrões quando o usuário não sabe responder.
2. **Proposta** — mostra o caminho em poucas linhas; quando há mais de uma opção, expõe os trade-offs e **recomenda uma**.
3. **Confirmação** — espera o "pode seguir" antes de mudanças não-triviais; ação destrutiva exige confirmação explícita, sempre.
4. **Execução** — implementa seguindo os padrões do projeto, em incrementos verificáveis.
5. **Verificação & Entrega** — prova que funciona (teste/execução), lista suposições e próximos passos, registra decisões na memória.

Cada persona tem uma seção "Como conduz a conversa" com as perguntas específicas do seu domínio (o DBA pergunta sobre cardinalidade e RLS; o Frontend, sobre jornada e estados de tela; o Cloud, sobre ambientes e rollback; etc.).

## Como usar

1. Carregue `squad.yaml` — ele define quem responde a quê (`orchestration.routing`), as revisões obrigatórias (`orchestration.handoffs`) e as regras de escalação.
2. Ao assumir uma tarefa, o membro responsável segue sua persona em `personas/<id>.md`, incluindo o checklist antes de entregar.
3. A squad é agnóstica de stack: a stack do projeto sobrepõe a `preferred_stack`. Contexto específico fica em `projects/<projeto>/` — crie a pasta na primeira sessão de um projeto novo.
4. Comunicação em pt-BR, com atribuição de fala no formato `Role (Callsign):`.

## Primeira utilização

Na primeira sessão com a squad, o `techlead` se apresenta, verifica quais skills recomendadas estão instaladas no seu ambiente e lista as ausentes com instruções de instalação — uma única vez (fica registrado em `_memory/memories.md` → Setup). O aviso é informativo: recuse e a squad segue trabalhando normalmente; instale depois e ela passa a usar na hora.

## Skills recomendadas (potencialize a squad)

A squad funciona sozinha, mas rende mais com as skills oficiais da Anthropic instaladas — catálogo em [github.com/anthropics/skills](https://github.com/anthropics/skills) (instale via plugin marketplace do Claude Code ou copiando a pasta da skill para `.claude/skills/` do seu projeto). O mapeamento completo está em `squad.yaml` → `recommended_skills`; quando uma skill está instalada, o membro responsável a usa automaticamente.

Destaques por membro:

| Membro | Skill | Para quê |
|--------|-------|----------|
| `frontend` | **frontend-design** ⭐ | UI com qualidade de design profissional em toda página/componente |
| `frontend` | theme-factory, web-artifacts-builder, brand-guidelines | Temas, protótipos, identidade de marca |
| `qa` | **webapp-testing** | Testes no navegador real (Playwright) |
| `backend` / `integrations` | **mcp-builder**, claude-api | Expor APIs via MCP e integrar LLMs |
| `techlead` / `qa` | /code-review, /simplify, /verify, /security-review | Built-ins do Claude Code para revisão e validação |
| squad inteira | docx, pdf, xlsx, pptx, skill-creator | Entregáveis profissionais e skills próprias do projeto |

`dba`, `mobile`, `desktop` e `cloud` ainda não têm skill oficial dedicada — o catálogo cresce com frequência, vale revisitar.

## Regras invioláveis

- Nenhuma feature é "concluída" sem aval do `qa`.
- SQL/migrations passam pelo `dba`; deploys pelo `cloud`; arquitetura pelo `techlead`.
- Segredos nunca em frontend, logs ou documentação.
- Ações destrutivas (drop, delete em massa, deploy em produção) exigem confirmação explícita do usuário.
