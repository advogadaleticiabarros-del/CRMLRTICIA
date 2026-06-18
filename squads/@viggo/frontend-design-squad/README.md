# Frontend Design Squad

> Do brief ao design de producao em uma unica esteira — e, quando voce quiser, com execucao automatica em seguida.

Squad multi-stack que transforma uma ideia vaga em **pacote de design pronto pra implementar**: arquitetura de informacao, design system com tokens, telas geradas via **Stitch (Google)**, e componentes de producao na stack que voce usa. No final, dispara automaticamente o squad `design-executor` com um handoff YAML — fechando o ciclo **design → codigo**.

## Por que existe

A maioria dos times cai numa de duas armadilhas:

- **Design bonito que nao vira codigo** — mockups do Figma que se perdem na traducao pra implementacao
- **Codigo rapido que sai feio** — IA gerando React/Flutter com visual generico (Inter font, cinzas simetricos, zero personalidade)

Este squad ataca os dois problemas: usa o Stitch da Google pra gerar telas **com direcao visual forte**, valida a tela-hero antes de replicar pras outras, e entrega codigo estruturado no padrao da stack alvo. E tem handoff automatico pro executor.

## O que ele entrega

Ao rodar, voce recebe em `output/v{N}/`:

| Artefato | O que e |
|---|---|
| `step-01-design-brief.md` | Diagnostico do projeto, personas, inventario de telas, tier visual |
| `step-02-ux-architecture.md` | Arquitetura de informacao, fluxos, inventario final de telas |
| `step-04-design-system.md` | DESIGN.md — tokens (cores, tipografia, spacing), anti-patterns, componentes base |
| `step-05b-stitch-prompt-boilerplate.md` | Prompt consistente pra gerar telas no Stitch sempre no mesmo padrao |
| `step-06-hero-screen.md` | Tela principal gerada pra validar direcao visual |
| `step-08-all-screens.md` | Todas as demais telas geradas seguindo a diretriz aprovada |
| `step-10-<stack>-components.md` | Componentes convertidos pra stack escolhida |
| `step-11-delivery-package.md` | Pacote final pronto pra entregar ao dev |
| `design-handoff.yaml` | Manifest pro design-executor — handoff automatico |

## Stacks suportadas

| Stack | Specialist | Output tipico |
|---|---|---|
| **React / Next.js** | Paulo Henrique (converter) + Frontend Converter pipeline | Componentes tipados com TypeScript, `cva`, shadcn/ui, Tailwind |
| **Flutter** | Bia Menezes | Widgets Dart com ThemeData mapeado do DESIGN.md |
| **Delphi** | Sergio Almeida | Paleta central (`TColor`), Segoe UI corrigida, shadows sutis sem `clBtnFace` espalhado |
| **Go** | Lucas Prado | Componentes `.templ` + CSS vars, htmx pros fluxos interativos |

## Os 11 agentes

| Agente | Papel | Personalidade |
|---|---|---|
| **Clara Nascimento** | Orientadora | Triagem inicial — novo projeto ou redesign? qual stack? |
| **Rafael Sato** | Code Auditor | Auditoria visual do codigo existente (apenas modo redesign) |
| **Marina Campos** | Design Chief | Orquestra o squad, decide tier visual, entrega pacote final |
| **Camila Fontes** | UX Architect | Arquitetura de informacao, fluxos, inventario de telas |
| **Thiago Vilela** | Design System Engineer | Cria o DESIGN.md com taste-design — zero visual generico |
| **Bruno Takeda** | Boilerplate Extractor | Extrai tokens e anti-patterns pro prompt do Stitch |
| **Renata Oliveira** | Screen Generator | Gera telas via Stitch — hero primeiro, resto depois |
| **Paulo Henrique** | Frontend Converter | Roteador pra specialist da stack correta |
| **Sergio Almeida** | Delphi Specialist | Converte design pra VCL/FMX |
| **Bia Menezes** | Flutter Specialist | Converte design pra Widgets Flutter |
| **Lucas Prado** | Go Specialist | Converte design pra templ+htmx ou API Go |

## Pipeline

```
step-00    Orientador          Diagnostica (novo|redesign) + stack + configura Stitch
step-00b   Code Auditor        [redesign] Relatorio de auditoria visual
step-01    Design Chief        Brief + inventario de telas + tela-hero
step-02    UX Architect        Arquitetura de informacao e fluxos
step-03    [CHECKPOINT]        Aprovar arquitetura
step-04    Design System Eng   DESIGN.md com tokens premium (taste-design)
step-05    [CHECKPOINT]        Aprovar design system
step-05b   Boilerplate Extr    Prompt base pro Stitch
step-06    Screen Generator    Gerar tela-hero
step-07    [CHECKPOINT]        Aprovar direcao visual da hero
step-08    Screen Generator    Gerar todas as demais telas
step-09    [CHECKPOINT]        Aprovar telas
step-10    Frontend Converter  Rotear pro specialist da stack
step-10-X  <stack> Specialist  Converter pra codigo de producao
step-11    Design Chief        Pacote final de entrega
step-12    Design Chief        Handoff automatico pro design-executor
```

## Potencial

- **Velocidade com qualidade:** brief → design validado em horas, nao dias
- **Multi-stack num squad so:** mesmo design, 4 stacks suportadas
- **Anti-generico por design:** taste-design + Stitch + checkpoints humanos quebram o visual padrao de IA
- **Handoff automatico:** nao termina num PDF — termina com o codigo sendo implementado
- **Redesign inteligente:** audita o codigo existente antes de mexer, respeita o que funciona

## Como usar

```bash
expxagents add @viggo/frontend-design-squad
expxagents run frontend-design-squad
```

O squad vai te guiar pelo brief. Quando o pipeline concluir, se voce quiser fechar o ciclo automaticamente, instale tambem o design-executor:

```bash
expxagents add @viggo/design-executor
```

## Requisitos

- Conta no **Stitch** (Google) conectada ao MCP
- Node 18+
- Context7 MCP pra documentacao atualizada da stack escolhida

## Licenca

Publicado por @viggo no marketplace ExpxAgents.
