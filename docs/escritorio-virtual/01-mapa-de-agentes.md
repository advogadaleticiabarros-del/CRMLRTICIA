# Escritório virtual — mapa de agentes (etapa 1)

**Data:** 14/10/2026 · **Status:** proposta para a Dra. Letícia aprovar · **Base:** leitura do código do CRM + pesquisa das regras da OAB/CNJ e das fontes oficiais de jurisprudência.

## Resumo em 5 linhas

1. O escritório virtual **não começa do zero**: o CRM já faz cerca de metade do trabalho (monitorar tribunais, detectar prazo, minutar, revisar, cobrar, avisar). Os agentes novos se encaixam nele.
2. São **27 agentes em 6 departamentos**. 13 já existem (alguns em parte), 14 são novos.
3. Tudo gira sozinho, **menos 7 decisões que por lei e por ética são da advogada** (ver "Portões da Dra."). A principal é aprovar e protocolar a peça. O protocolo usa o certificado digital em nome dela.
4. **Jurisprudência só de fonte oficial e conferida.** Um agente pesquisa e **outro, independente, confere** cada citação antes de a peça chegar à Dra. Tribunais já multaram advogados por citar julgados inventados por IA.
5. Ordem sugerida: primeiro o **orquestrador, a caixa de aprovação e o pesquisador com verificador**. Depois os especialistas por área.

---

## Como um processo gira sozinho (fluxo principal)

```
Intimação/publicação chega (DJEN, DataJud, e-mail do tribunal)
  → [Monitor] lê e classifica o ato (já existe)
  → [Calculista de prazos] calcula o prazo fatal e o PRAZO INTERNO (2 dias úteis antes)
  → [Controller] decide o que fazer pelo playbook e abre o card na esteira com dono e SLA
  → [Especialista da área] minuta a peça
        ↔ [Pesquisador de jurisprudência] traz precedentes de fonte oficial
  → [Verificador de citações] confere cada lei e julgado; se algo não bater, a peça VOLTA
  → [Revisor sênior] aplica o checklist da peça (tempestividade, pedidos, documentos)
  → [Preparador de protocolo] monta os PDFs e os anexos no padrão do tribunal
  → ★ DRA. APROVA E PROTOCOLA (1 toque; ela pode editar antes)
  → [Monitor] vê a juntada no tribunal e fecha o prazo sozinho
  → [Relacionamento] avisa o cliente em linguagem simples
  → [Treinador] compara a minuta com o que ela protocolou e aprende
```

**Rede de segurança:** se a peça não estiver aprovada até o prazo interno, o aviso escala: sino, WhatsApp da Dra., WhatsApp da Jessica e, na véspera do prazo fatal, aviso a cada hora. Nenhum prazo pode vencer em silêncio.

---

## Os 27 agentes

Legenda: ✅ já existe · 🟡 existe em parte · 🆕 novo

### 1. Recepção e comercial

| # | Agente | O que faz | Situação no CRM |
|---|---|---|---|
| 1 | **Recepcionista** | Responde no WhatsApp 24h, identifica se a pessoa é cliente ou possível cliente, informa horário e marca atendimento. | 🟡 Há triagem de quem não tem cadastro (`triagemSemCadastro`) e lembrete de mensagem sem resposta, mas **nada responde ao cliente sozinho**. |
| 2 | **Triador jurídico** | Entrevista o possível cliente com roteiro por área. Checa prescrição, viabilidade e documentos e entrega uma ficha de triagem com recomendação de aceitar ou não. | 🟡 Há sugestão de prescrição por área e checklist por área. Falta o roteiro de entrevista. |
| 3 | **Comercial** | Gera a proposta, acompanha a abertura, faz o follow-up e transforma em contrato com assinatura eletrônica. | ✅ Proposta, follow-up, contrato padrão e assinatura (`propostaFollowupService`, `contractFlow`). |
| 4 | **Coletor de documentos** | Manda a lista de documentos da área, lê o que chega (RG, CTPS, CNIS, laudos), preenche a ficha e cobra o que falta. | 🟡 A extração de documentos (`extracaoDocumentos`) e as tarefas D+1/D+5 do contrato existem. Falta cobrar sozinho. |
| 5 | **Relacionamento com o cliente** | Avisa o andamento em linguagem simples e responde "como está meu processo?". Avisa audiência e perícia e manda pesquisa de satisfação. | 🟡 Hoje gera só **rascunho** para a equipe enviar. |

### 2. Controladoria jurídica (o coração)

| # | Agente | O que faz | Situação |
|---|---|---|---|
| 6 | **Monitor de tribunais** | Lê DJEN, DataJud e e-mail do tribunal. Classifica o ato (sentença, decisão, citação…). | ✅ `monitoringService`, `djen`, `datajud`, `courtEmailMonitorService`, `movimentacaoIa`. |
| 7 | **Calculista de prazos** | Calcula o prazo fatal e o prazo interno. | 🟡 O CPC e os feriados nacionais estão prontos (`DeadlineCounterService`). **Faltam:** feriados municipais e do tribunal, portarias de suspensão, regras da CLT (art. 775), JEF e prazo em dobro. |
| 8 | **Controller (distribuidor)** | Para cada evento, escolhe o playbook, abre o card, define o responsável e controla o SLA e o prazo interno. | 🟡 Há automações e playbooks (`automationService`, `playbooksNegocio`, `productionSla`). Falta ser o "cérebro" único que liga tudo. |
| 9 | **Agenda e audiências** | Marca audiências e perícias, prepara o roteiro, avisa cliente e testemunhas e manda o link da sala virtual. | 🟡 Agenda, briefing da véspera e audiência sem duplicar existem. Falta o aviso ao cliente e às testemunhas. |
| 10 | **Administrativo INSS** | Acompanha requerimentos e exigências no Meu INSS e agenda perícias. | 🆕 A senha do cliente já fica protegida em `client_credentials`. |

### 3. Produção jurídica

| # | Agente | O que faz | Situação |
|---|---|---|---|
| 11 | **Especialista trabalhista** | Minuta iniciais, contestações e recursos (RO, embargos, AIRR). | 🟡 Há o Estagiário IA e o gerador de petição (`peticaoBuilder`). Tem 176 modelos, a maioria trabalhista. |
| 12 | **Especialista previdenciário** | Iniciais no JEF, impugnação de laudo e recursos à Turma Recursal. | 🆕 Como especialista: usa o mesmo motor, com playbook e modelos próprios. |
| 13 | **Especialista família** | Alimentos, guarda, divórcio e execução de alimentos. | 🆕 Idem. |
| 14 | **Especialista consumidor** | Iniciais no JEC, bancos (BMG etc.) e negativação. | 🆕 Idem. |
| 15 | **Estagiário** | Faz as tarefas simples: juntada, ciência, manifestação sobre laudo, petição de prazo, cumprimento de sentença padrão. | 🟡 O Estagiário IA faz a análise e a minuta da intimação. |
| 16 | **Pesquisador de jurisprudência** | Busca precedentes **só em fonte oficial** e entrega número, órgão, data, link e o trecho que sustenta a tese. | 🆕 **Novo e crítico.** Fontes na seção abaixo. |
| 17 | **Verificador de citações** | Agente separado do redator. Abre cada julgado e lei citados na fonte oficial, confere se existem e se dizem o que a peça afirma, e confere se a lei está vigente. O que não confere é retirado ou marcado em [colchete]. | 🆕 **Novo e crítico.** Hoje existe a camada anti-invenção para *dados do caso*, mas não para *jurisprudência*. |
| 18 | **Calculista de valores** | Faz a liquidação trabalhista, os atrasados previdenciários, a correção (IPCA-E/SELIC) e o valor da causa. | 🆕 Na JT, prepara os dados para o PJe-Calc. A contabilidade externa valida quando houver valor alto. |
| 19 | **Revisor sênior** | Aplica checklist por tipo de peça: tempestividade, preparo e custas, pedidos com valor, procuração nos autos, coerência com a tese do caso. | ✅ em parte (`peticaoReviewer`, que roda sozinho). Falta o checklist por tipo de peça. |
| 20 | **Preparador de protocolo** | Gera o PDF, divide e nomeia os anexos no limite do tribunal e entrega à Dra. o "pacote pronto para protocolar". | 🆕 |

### 4. Financeiro

| # | Agente | O que faz | Situação |
|---|---|---|---|
| 21 | **Faturamento e cobrança** | Emite parcelas, gera boleto/Pix, faz a régua de cobrança e avisa acordos. | ✅ Asaas, Pix, lembretes e aviso de acordos das 8h. |
| 22 | **Conciliação** | Bate o extrato do banco e o cartão com os lançamentos. | ✅ `bankStatementService`, `cardStatementService`. |
| 23 | **Alvarás e repasses** | Detecta alvará ou RPV expedidos, cobra o levantamento, calcula o repasse (30% + sucumbência, parceria 15/15) e prepara o pagamento. | 🟡 Há repasses e recebimento. Falta detectar o alvará e montar o repasse do começo ao fim. |
| 24 | **Dativo** | Detecta a nomeação e o arbitramento e cobra o Estado. | ✅ |

### 5. Qualidade, treino e testes

| # | Agente | O que faz | Situação |
|---|---|---|---|
| 25 | **Treinador** | Compara cada minuta da IA com a versão que a Dra. protocolou e extrai as preferências dela (estrutura, teses, tom). Propõe mudanças nos playbooks e modelos. **A Dra. aprova antes de valer.** | 🆕 |
| 26 | **Testador (QA dos agentes)** | Mantém um banco de casos de teste com intimações reais **anonimizadas** e a resposta certa. Roda sempre que um prompt, modelo ou regra muda. Mede acerto de prazo, de tipo de ato e citações 100% verificadas. Um agente que piora não entra no ar. | 🆕 Usa o padrão dos ~805 testes do CRM. |
| 27 | **Compliance (OAB/LGPD)** | Registra em log o que cada agente fez e com qual fonte. Garante que nada saiu sem passar pelo portão da Dra. Inclui no contrato o aviso de uso de IA. Confere publicidade (Provimento 205/2021) e dados sensíveis. | 🟡 Há log de acesso e de automações. Falta a trilha por agente. |

**Fora da lista, mas já em operação:**
- **Vigia de sistema:** saúde do sistema, backup e rotinas travadas. Já existe.
- **Chefe de gabinete:** briefing das 7h, tela "Hoje", fechamento do dia e assistente no WhatsApp. Já existe. Vira a **caixa de aprovação única** da Dra.
- **Marketing:** o Orbit continua separado.

---

## Portões da Dra. (o que NUNCA sai sem ela)

A Recomendação 001/2024 do Conselho Federal da OAB diz que **o julgamento profissional não pode ser feito pela IA sem supervisão humana**. O advogado responde pelo que protocola. Por isso, estes 7 passos ficam com ela. Todos chegam numa caixa única (WhatsApp ou tela "Hoje"), com resumo e botão de aprovar.

1. **Aceitar ou recusar** um caso novo.
2. **Aprovar e protocolar** qualquer peça. O certificado digital é dela e o PJe exige certificado em nome do advogado.
3. **Acordo:** aceitar, propor ou recusar.
4. **Não recorrer, desistir ou renunciar** a prazo.
5. **Mensagem ao cliente com conteúdo jurídico novo**, como uma chance de êxito ou o resultado de uma sentença. Status neutro ("seu processo teve andamento, está tudo em dia") pode sair automático, se ela autorizar.
6. **Pagamentos e repasses.** Já funciona assim no assistente: o "sim" só vale no financeiro.
7. **Mudança em playbook ou modelo** sugerida pelo Treinador.

O resto roda sozinho.

---

## Fontes de jurisprudência (só oficiais)

| Fonte | Para quê | Como acessar |
|---|---|---|
| **Pangea/BNP do CNJ** (pangeabnp.pdpj.jus.br) | Precedentes qualificados: repetitivos, repercussão geral, IRDR, IAC, súmulas (art. 927 do CPC). É a fonte que mais pesa. | Portal público. A API ainda não foi confirmada: avaliar na implementação. |
| **Portal de Dados Abertos do STJ** | Espelhos e íntegras de acórdãos, precedentes qualificados. Formato legível por máquina. | Download de datasets. |
| **Jurisprudência do TST, TRT17, TJES, TRF2 e TNU** | Entendimento local e regional: o que a vara e o tribunal dela decidem. | Portais de pesquisa de cada tribunal. Integração por tribunal. |
| **Planalto / LexML** | Texto de lei vigente, para conferir artigo citado. | Público. |
| **DataJud (CNJ)** | Metadados e movimentação, não acórdãos. | Já integrado. |

**Regra do pesquisador:** sem número do processo, órgão julgador, data, link oficial e trecho literal conferido, **o precedente não entra na peça**. Bases pagas (Jusbrasil, Escavador, Judit) servem para *achar*, mas a citação final é sempre conferida na fonte oficial.

**Por que tanto cuidado:** TJPR, TJSC, TSE, Justiça Federal do Paraná e Justiça do Trabalho já multaram por litigância de má-fé quem citou julgado inexistente gerado por IA. As multas chegaram a 10% do valor da causa e a dez salários mínimos, e os casos foram enviados à OAB.

---

## Como construir (recomendação técnica)

- **Dentro do CRM**, como módulos TypeScript que reagem a eventos. Motivo: os dados, as rotinas automáticas, o WhatsApp e as regras de negócio já estão lá, e o deploy na VPS é automático. As squads do ExpxAgents servem para tarefas pontuais no Claude Code, não para um escritório rodando 24h.
- **Cada agente é um módulo profundo:** interface pequena (`receber evento → devolver ação`) e dependências injetadas (IA, banco, fontes de jurisprudência, WhatsApp). Isso permite testar cada um com o banco de casos do Testador antes de entrar no ar.
- **Modelos de IA por tipo de tarefa:**
  - modelo forte para redigir e verificar peças;
  - modelo barato para triagem, classificação e mensagens simples.
- **Trilha de auditoria:** cada ação grava qual agente agiu, qual fonte usou, qual versão do prompt e quem aprovou.

---

## Ordem de construção sugerida

| Fase | O que entra | Por quê |
|---|---|---|
| **1. Fundação** | Controller (orquestrador) + caixa de aprovação única + prazo interno com escalonamento + Pesquisador + Verificador + Testador | Sem isso, nada pode rodar sozinho com segurança. |
| **2. Produção** | Especialista trabalhista (área com mais modelos) → previdenciário → família → consumidor; calendário forense completo; Preparador de protocolo; checklist do Revisor por peça | Coloca o fluxo principal de ponta a ponta. |
| **3. Cliente** | Recepcionista com resposta automática, Triador, Coletor de documentos, Relacionamento, Administrativo INSS | O cliente passa a ser atendido sem a Jessica no meio. |
| **4. Aprendizado** | Treinador; Alvarás e repasses de ponta a ponta; protocolo automático via MNI (só onde o tribunal permitir) | Melhora contínua e o último passo manual. |

---

## Decisões que são da Dra.

1. **O que pode ir ao cliente sem ela ver?** Sugestão: só status neutro e lembretes (documento, audiência, parcela). Conteúdo jurídico passa por ela.
2. **Orçamento de IA e de bases pagas.** Usar só fontes oficiais gratuitas no começo, ou também uma base paga para achar precedentes mais rápido?
3. **Certificado digital no servidor (protocolo automático).** Sugestão: **não, por enquanto.** Um certificado A1 instalado no servidor permite que qualquer pessoa com acesso ao servidor assine como ela. O protocolo continua sendo o toque dela, com o pacote já pronto.
4. **Por qual área começar.** Sugestão: trabalhista, que tem mais modelos e mais volume.
5. **Aviso de IA no contrato.** A OAB recomenda informar o cliente sobre o uso de IA. Sugestão: incluir uma cláusula no contrato padrão.

## Fontes consultadas

- Recomendação 001/2024 do CFOAB e diretrizes do TED da OAB/SP (mai/2026): oabsp.org.br/jornaldaadvocacia, cj.estrategia.com/portal/uso-da-inteligencia-artificial-na-advocacia
- Plano nacional da OAB para IA (jun/2026): migalhas.com.br/quentes/458194
- Multas por jurisprudência falsa: tjsc.jus.br (jurisprudência falsa gerada por IA), lex.com.br (TJPR; JF Londrina), conjur.com.br (TSE)
- Resolução CNJ 615/2025 (IA no Judiciário): mattosfilho.com.br/unico/uso-inteligencia-artificial-judiciario
- Pangea/BNP: cnj.jus.br/cnj-relanca-o-banco-nacional-de-precedentes-bnp
- Dados Abertos do STJ: cnj.jus.br/portal-de-dados-abertos-do-stj-oferece-informacoes-em-formato-legivel-por-maquina
- Certificado digital no PJe e MNI: cnj.jus.br/certificacao-digital, trf1.jus.br (MNI Orientações), csjt.jus.br (MNI no PJe-JT)
