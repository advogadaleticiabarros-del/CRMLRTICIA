# 00b · Fluxograma do sistema

**Área:** Visão geral · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 04/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que um fluxo principal mudar de comportamento

## TL;DR

Dois fluxogramas: a jornada de negócio (de lead até honorário recebido) e o fluxo de automação por trás do monitoramento de processo. Renderiza direto no GitHub (e na versão web da documentação).

## Contexto

Consulte quando quiser ver o caminho completo de um caso de uma vez, em vez de módulo por módulo — ou pra explicar o sistema pra alguém novo.

## Jornada de negócio

```mermaid
flowchart TD
    A[Lead entra no funil] --> B{Origem identificável?}
    B -->|Sim, IA qualifica| C[Área/urgência/valor sugeridos]
    B -->|Não| D[Cadastro manual]
    C --> E[Atendimento inicial]
    D --> E
    E --> F{Fecha proposta?}
    F -->|Recusada/Perdido| G[Mensagem de despedida automática<br/>WhatsApp, uma única vez]
    F -->|Contrato assinado| H[Vira Cliente]
    H --> I{Tipo de caso}
    I -->|Processo próprio| J[Caso / Processo]
    I -->|Nomeação da Defensoria| K[Demanda Dativa]
    J --> L[Documentos e peças<br/>template ou IA]
    K --> L
    J --> M[Cobrança / parcelas]
    K --> N[Financeiro do Estado<br/>separado do cliente]
    L --> O[Assinatura eletrônica]
    M --> P[Honorário recebido]
    N --> P
```

## Automação de monitoramento de processo

```mermaid
flowchart TD
    A1[DJEN: descoberta por OAB<br/>7h · 13h · 19h] --> C1[Movimentação nova?]
    A2[DataJud/API tribunal: processo cadastrado<br/>de hora em hora, 7h-20h] --> C1
    A3[E-mail de monitoramento<br/>8h · 19h] --> C1
    C1 -->|Não| Z1[Nada a fazer]
    C1 -->|Sim| L1[Limpar HTML/entidades<br/>textCleanup.ts]
    L1 --> D1{Palavra-gatilho?<br/>sentença/acórdão/citação/etc.}
    D1 -->|Não| Z2[Só registra a movimentação]
    D1 -->|Marco processual<br/>sentença/acórdão| E1{Já avisou este<br/>processo+tipo antes?}
    E1 -->|Sim| Z3[Não reenvia]
    E1 -->|Não, primeira vez| F1[Marca em marco_processual_avisos]
    F1 --> G1[Avisa WhatsApp do escritório<br/>com nome da parte, se houver]
    D1 -->|Outro gatilho, fonte DJEN| H1[Cria prazo a confirmar]
    D1 -->|Outro gatilho, fonte DataJud| H2[Cria alerta]
    D1 -->|Nomeação dativa detectada| I1{Processo já<br/>cadastrado em Dativo?}
    I1 -->|Não| J1[Extrai dados por IA<br/>e cadastra demanda]
    I1 -->|Sim, dígitos batem| K1[Não duplica]
    J1 --> G1
```

## FAQ

**Por que dois fluxogramas em vez de um só?** A jornada de negócio (o que você vê nas telas) e a automação por trás dela (o que roda sozinho) são coisas diferentes — misturar os dois num diagrama só ficaria ilegível.

**Esses diagramas substituem os blocos de módulo?** Não — são um mapa de alto nível. O detalhe de cada etapa está no bloco correspondente ([Leads](02-leads.md), [Processos](04-processos.md), [Dativo](05-dativo.md), etc.).

## Links relacionados
- [Leads e comercial](02-leads.md)
- [Processos e prazos](04-processos.md)
- [Monitoramento automático](10-monitoramento.md)
- [Dativo](05-dativo.md)

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 04/09/2026 | Claude | Criação do documento |

---
◀ [Visão geral](00-visao-geral.md) · Próximo: [Clientes e cadastro](01-clientes.md) ▶
