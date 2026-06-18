# Design Executor

> Recebe o pacote do design e aplica num projeto existente — sem quebrar o que ja funciona.

Squad de execucao **multi-stack** que pega o output do `frontend-design-squad` (DESIGN.md, telas aprovadas, componentes gerados) e aplica num projeto real, preservando **100% da logica de negocio** (queries, state, navegacao, integracoes, handlers). Funciona com Flutter, React/Next.js, Delphi (VCL/FMX) e Go (templ+htmx).

## Por que existe

A parte "facil" do design e produzir mockup bonito. A parte dificil e **aplicar em projeto vivo** sem:

- Quebrar a logica de negocio que ja esta em producao
- Deixar `Color(0xFF...)`, hex inline ou `clBtnFace` espalhados pelo codigo
- Esquecer de atualizar o ThemeData/paleta central/CSS vars
- Perder micro-interacoes e animacoes nas telas refatoradas
- Fazer merge sem teste cobrindo

Este squad resolve isso simulando uma equipe senior de verdade: 11 agentes com personalidade e papeis especificos, TDD na red phase, code review rigoroso, verification com comandos reais da stack.

## O que ele entrega

Ao rodar, voce recebe em `output/v{N}/`:

| Artefato | O que e |
|---|---|
| `step-01-checklist.md` | Checklist priorizado do que aplicar (Lucas) |
| `step-02-tech-decisions.md` | Decisoes arquiteturais e ordem de aplicacao (Caio) |
| `step-03-packages.md` | Packages premium pesquisados via Context7 (Patricia) |
| `step-04-tests.md` | Testes escritos ANTES da implementacao — TDD red phase (Fernanda) |
| `step-05-tema-componentes.md` | [Flutter] ThemeData + componentes compartilhados (Marina) |
| `step-06-telas.md` | [Flutter] Telas refatoradas (Isabela) |
| `step-05r-telas.md` | [React] Tokens shadcn + componentes + paginas refatoradas (Henrique) |
| `step-05d-telas.md` | [Delphi] Paleta central + forms refatorados (Eduardo) |
| `step-05g-telas.md` | [Go] CSS vars + templ components + paginas refatoradas (Matheus) |
| `step-07-review.md` | Code review rigoroso (Carla) |
| `step-08-verification.md` | Relatorio final com metricas e comandos executados (Gustavo) |

## Stacks suportadas

| Stack | Ferramentas aplicadas | Specialists |
|---|---|---|
| **Flutter** | `ThemeData` mapeado, componentes em `lib/componentes/`, `flutter_animate`, `lucide_icons`, `fl_chart` | Marina + Isabela (2 specialists dedicados) |
| **React / Next.js** | CSS vars shadcn, `cva` pra variantes, `tailwind-merge`+`clsx`, `framer-motion`, `lucide-react` | Henrique Vasconcellos |
| **Delphi** | `Tema.Cores.pas` com `TColor`, Segoe UI corrigida, `TShadowEffect` (FMX) ou `TGradientFill` (VCL), tab order preservado | Eduardo Bastos |
| **Go** | CSS vars em `:root`, componentes `.templ`, htmx pros fluxos, Tailwind standalone | Matheus Okabe |

## Os 11 agentes

| Agente | Papel | Personalidade |
|---|---|---|
| **Lucas** | Plan Reader | Organizado, voz de PM — abre a sprint, distribui tarefas |
| **Caio Mendes** | Tech Lead | Pragmatico, opinativo mas aberto — decide ordem e abordagem |
| **Patricia** | Dependency Researcher | Curiosa, detalhista — compara 2-3 packages e escolhe com criterio |
| **Fernanda** | QA Engineer | Nao passa pano — TDD red phase antes de qualquer implementacao |
| **Marina** | Frontend Developer (Flutter) | Criativa, UX-first — ThemeData e componentes base |
| **Isabela** | Flutter Specialist | Perfeccionista com tokens — ultima linha visual em Flutter |
| **Henrique Vasconcellos** | React Specialist | 7 anos React, fanatico por TypeScript e shadcn — fullstack da stack |
| **Eduardo Bastos** | Delphi Specialist | 20 anos Delphi — respeita codigo que rodou 15 anos em producao |
| **Matheus Okabe** | Go Specialist | Minimalista — "se da pra resolver com templ+htmx, nao precisa de React" |
| **Carla** | Code Reviewer | Rigorosa mas construtiva — ultimo filtro antes da verificacao |
| **Gustavo** | Verification Agent | Calmo, conclusivo — evidencia antes de afirmacao |

## Pipeline

```
step-01    Lucas         Le handoff ou pergunta, monta checklist
step-02    Caio Mendes   Analisa projeto, decide ordem por stack
step-03    Patricia      Pesquisa packages premium via Context7
step-04    Fernanda      Testes ANTES da implementacao (TDD red)
step-05    Marina         [Flutter] ThemeData + componentes base
step-06    Isabela       [Flutter] Refatora telas
step-05r   Henrique      [React] Tokens + componentes + paginas (step unico)
step-05d   Eduardo       [Delphi] Paleta + forms (step unico)
step-05g   Matheus       [Go] CSS vars + templ + paginas (step unico)
step-07    Carla         Code review rigoroso
step-08    Gustavo       Verification + relatorio final
```

## Assimetria por maturidade

Flutter tem **2 specialists** (Marina + Isabela) em 2 steps porque e o caso mais maduro do squad — separamos "tema+componentes" de "aplicar nas telas" pra maxima fidelidade. As outras stacks tem **1 specialist fullstack** que faz tudo num step so. Se o uso crescer, dividimos depois.

## Detecao automatica de stack

Se invocado com um `design-handoff.yaml` do `frontend-design-squad`, o Lucas detecta a stack automaticamente e o pipeline roda condicionalmente (so o specialist da stack alvo executa). Se invocado standalone, ele pergunta.

## Potencial

- **Zero logica de negocio quebrada:** specialists aplicam design sem tocar em queries/state/handlers
- **TDD como rede:** Fernanda escreve testes na red phase — impossivel merge sem cobertura
- **Context7 pra tudo:** Patricia pesquisa APIs/packages em doc atualizada, nao em conhecimento defasado
- **Review rigoroso stack-aware:** Carla grepa hardcoded values especificos da stack
- **Verification com comandos reais:** Gustavo roda `flutter analyze`, `tsc --noEmit`, `go vet`, compila Delphi — evidencia antes de dar "done"
- **pt-BR obrigatorio:** nomes em portugues, textos com acentos corretos — anti-gringo-programado

## Como usar

```bash
expxagents add @viggo/design-executor
expxagents run design-executor
```

Se voce ja rodou o `frontend-design-squad`, o handoff e automatico — nao precisa invocar manualmente:

```bash
# Dentro do frontend-design-squad, ao concluir o step-12:
# Skill(skill: "expxagents", args: "run design-executor --handoff output/v1/design-handoff.yaml")
```

## Requisitos

- Node 18+
- Context7 MCP pra documentacao atualizada
- Projeto alvo com estrutura reconhecivel pela stack (ex: Flutter tem `pubspec.yaml`, React tem `package.json`, etc.)

## Licenca

Publicado por @viggo no marketplace ExpxAgents.
