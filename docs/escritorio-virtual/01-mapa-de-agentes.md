# Escritório virtual — mapa de agentes (v2)

**Data:** 14/10/2026 · **Status:** aprovado pela Dra. ("faça tudo de acordo com a sua sugestão") e em construção · **Base:** código do CRM, regras da OAB/CNJ e pesquisa sobre a estrutura de escritórios (controladoria, paralegal, backoffice) e sobre agentes jurídicos de IA.

## Resumo

- **67 agentes em 10 departamentos.** Cobrem o escritório inteiro: atendimento, contrato, monitoramento, leitura de decisões, prazos, produção, cliente, financeiro, secretaria e qualidade.
- Situação hoje: **27 já existem**, 17 existem em parte e 23 são novos. O CRM já é a espinha dorsal.
- **Primeiros agentes novos entregues em 14/10/2026: o Leitor de sentença e a Secretária particular.** A sentença ou o acórdão chega à Dra. resumido, com o que ganhamos e o que perdemos, o valor e os prazos de recurso com data.
- **Entregues depois:**
  - **14/10:** Cérebro e a esteira comercial (Bianca, Felipe, Camila).
  - **15/10:** Dra. Lívia (atendente) e a sociedade dos agentes.
  - **16/10:** Dr. Rafael (objeções), Dra. Helena (análise de documentos) e Dr. Otávio (qualificação em % e copiloto). A Laya também foi instalada no servidor.
  - **Total na sala hoje:** 28 agentes, sendo 3 ainda em construção (Júlia, Vera e Tomás).
- Tudo gira sozinho, **menos 7 portões da Dra.** (ver abaixo). O principal é aprovar e protocolar.

Legenda: ✅ existe · 🟡 existe em parte · 🆕 novo · ⭐ entregue nesta etapa

---

## Fluxo principal: do processo ao resultado

```
Publicação/movimentação chega  →  MONITORAMENTO (vigias de DJEN, tribunais, e-mail, INSS, pauta)
  → LEITURA (Leitor de sentença, de decisão, de laudo, de ata)
  → SECRETÁRIA PARTICULAR entrega à Dra. já resumido, com prazo e sugestão
  → CONTROLADORIA calcula o prazo fatal e o interno, confere duas vezes e distribui
  → PRODUÇÃO (especialista da área + pesquisador + verificador + revisor + preparador)
  → ★ DRA. APROVA E PROTOCOLA
  → Conferente de protocolo vê a juntada e fecha o prazo
  → RELACIONAMENTO explica ao cliente
  → FINANCEIRO (alvará → repasse → honorários)
  → TREINADOR aprende com as correções da Dra.
```

---

## 1. Atendimento e recepção

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 1 | Recepcionista | Responde 24h no WhatsApp e separa cliente de possível cliente. | 🟡 triagem existe; não responde sozinho |
| 2 | Transcritor de áudios | Converte em texto os áudios do cliente. | ✅ `whatsappTranscricao` |
| 3 | Triador jurídico | Entrevista por área (datas, salário, CNIS, filhos…). Checa prescrição e viabilidade e recomenda aceitar ou recusar. | 🟡 qualificação de lead existe |
| 4 | Checador de conflito de interesses | Verifica se a pessoa já é parte contrária em algum caso do escritório. | 🆕 (usa `case_partes`) |
| 5 | Agendador de consultas | Marca o atendimento na agenda da Dra. | 🟡 `agendaSlots` |
| 6 | Ouvidoria e satisfação | Faz pesquisa de satisfação e recebe reclamações. | 🆕 |

## 2. Comercial e contratos

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 7 | Comercial | Monta e envia a proposta. | ✅ |
| 8 | Follow-up de propostas | Cobra quem abriu e não respondeu. | ✅ `propostaFollowupService` |
| 9 | Redator de contrato e procuração | Gera contrato, procuração e declaração pelo padrão de cada área. | ✅ ⭐ agora com aviso de uso de IA |
| 10 | Coletor de assinaturas | Envia o link, acompanha e lembra quem não assinou. | ✅ |
| 11 | Onboarding | Boas-vindas, explica como o processo anda e alerta para os canais oficiais (golpe do falso advogado). | 🟡 tarefas D+1/D+5 |
| 12 | Coletor de documentos | Pede a lista da área, lê o que chega e cobra o que falta. | ✅ Dra. Camila (14/10) |
| 12a | **Negociação (objeções)**: Dr. Rafael | Responde às objeções da proposta enviada ("tá caro", "vou pensar", prazo, garantia, sindicato) com a ética da OAB. Explica a marcha processual, não dá desconto (avisa a Dra.) e trabalha em rascunho. | ⭐ **entregue 16/10** (`negociador.ts`) |
| 12b | **Analista de documentos**: Dra. Helena | Cruza cada documento com a história contada: nome, CPF, empresa, datas, salário por fora, carteira, FGTS, comprovante, gestação, prescrição, ilegível ou alterado. | ⭐ **entregue 16/10** (`analistaDocumentos.ts`) |
| 12c | **Copiloto comercial da Dra.**: Dr. Otávio | Qualifica em % (capacidade de pagar, potencial, chance de fechar), com perguntas sutis feitas pela Lívia. Na conversa da Dra., quando aparece a intenção de proposta, sugere só a ela os valores (OAB/RJ), a forma de pagamento e a próxima mensagem. Comando "montar proposta N". | ⭐ **entregue 16/10** (`copilotoComercial.ts`, `tabelaOabRj.ts`) |

## 3. Monitoramento de processos

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 13 | Vigia do DJEN | Busca toda publicação pela OAB, 3 vezes ao dia. | ✅ |
| 14 | Vigia dos tribunais | Consulta o DataJud e as APIs dos tribunais de hora em hora. | ✅ |
| 15 | Vigia do e-mail do tribunal | Lê as intimações que chegam por e-mail. | ✅ |
| 16 | Vigia do e-Proc/PJe | Consulta pública direta quando o DataJud atrasa. | 🆕 avaliar por tribunal |
| 17 | Vigia do Meu INSS | Acompanha requerimentos, exigências e perícias administrativas. | 🆕 |
| 18 | Vigia de pauta | Avisa quando um recurso entra em pauta de julgamento, para memoriais e sustentação oral. | 🆕 |
| 19 | Vigia de processo parado e prescrição | Avisa processo parado há 30 ou 60 dias e prescrição próxima. | ✅ `carteira:vigia` |
| 20 | Vigia de alvarás, RPV e precatórios | Detecta a expedição e acompanha até o pagamento. | 🆕 |
| 21 | Conferente cruzado | Detecta movimento visto numa fonte sem a intimação correspondente na outra. | ✅ `movement_alerts` |
| 22 | Vigia do sistema | Robôs, WhatsApp, backup e rotinas travadas. | ✅ |

## 4. Leitura de decisões e documentos

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 23 | **Leitor de sentença e acórdão** | Lê a íntegra e extrai resultado para o cliente, ganhos e perdas, valor, sucumbência, gratuidade, pontos de atenção e sugestão. O recurso e o prazo vêm de tabela fixa. | ⭐ **entregue** |
| 24 | Leitor de decisões e despachos | Tutela, liminar, perícia designada, "manifeste-se em X dias". | 🟡 `movimentacaoIa` |
| 25 | Leitor de laudo pericial | Laudo médico (INSS), insalubridade, contábil: aponta contradições e sugere quesitos complementares ou impugnação. | 🆕 |
| 26 | Leitor de ata de audiência | Resume o que foi decidido, os prazos dados e as provas a produzir. | 🆕 |
| 27 | Leitor de documentos do cliente | CTPS, CNIS, holerites, certidões → ficha. | ✅ |

## 5. Controladoria (prazos e distribuição)

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 28 | Calculista de prazos | Prazo fatal e prazo interno (2 dias úteis antes). | 🟡 falta calendário por tribunal e portarias |
| 29 | Auditor de prazos | Segunda contagem independente: se as duas divergirem, alerta. | 🆕 |
| 30 | Controller (distribuidor) | Escolhe o playbook, abre o card, define o responsável e o SLA, escala atrasos. | 🟡 automações e playbooks |
| 31 | Agenda e audiências | Audiências, perícias e sincronização com o Google. | ✅ |
| 32 | Preparador de audiência | Roteiro, perguntas, testemunhas, documentos e link da sala. | 🟡 briefing da véspera |
| 33 | Gestor de correspondentes | Contrata e acompanha diligências e audiências em outra comarca. | 🟡 portal do correspondente |

## 6. Produção jurídica

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 34 | Especialista trabalhista (**área-piloto**) | Inicial, réplica, RO, contrarrazões, ED. | 🟡 Estagiário IA + 176 modelos |
| 35 | Especialista previdenciário | JEF, impugnação de laudo, recurso à Turma Recursal. | 🆕 |
| 36 | Especialista família | Alimentos, guarda, divórcio, execução de alimentos. | 🆕 |
| 37 | Especialista consumidor | JEC, bancos, negativação. | 🆕 |
| 38 | Estagiário | Peças simples: ciência, juntada, manifestação, pedido de prazo. | 🟡 |
| 39 | Especialista em recursos | Cabimento, preparo, custas, depósito recursal. | 🆕 |
| 40 | Especialista em execução | Liquidação, cumprimento de sentença, penhora e pesquisa de bens. | 🆕 |
| 41 | Negociador de acordos | Calcula o piso e o teto, monta a contraproposta e a minuta. A Dra. decide. | 🆕 |
| 42 | Pesquisador de jurisprudência | Só fonte oficial, com número, órgão, data, link e trecho. | 🆕 |
| 43 | Verificador de citações | Separado do redator: confere se cada julgado e lei existem e dizem o que a peça afirma. | 🆕 |
| 44 | Calculista de valores | Liquidação trabalhista (dados para o PJe-Calc), atrasados do INSS, correção. | 🟡 **Dr. Augusto** (28/10/2026): planilha de cálculos da petição inicial de consumidor (indébito simples/dobro com correção e juros desde cada desconto, índices do Bacen, .xlsx). Falta: trabalhista (PJe-Calc) e atrasados do INSS |
| 45 | Revisor sênior | Checklist por tipo de peça. | 🟡 `peticaoReviewer` |
| 46 | Preparador de protocolo | PDFs, anexos no limite do tribunal, nomes dos arquivos. | 🆕 |
| 47 | Conferente de protocolo | Vê a juntada no tribunal e fecha o prazo sozinho. | 🆕 |

## 7. Relacionamento com o cliente

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 48 | Relacionamento | Andamentos em linguagem simples e "como está meu processo?". | 🟡 rascunho |
| 49 | Avisador de compromissos | Lembra o cliente de audiência, perícia e documento pendente. | 🆕 (status neutro: automático) |
| 50 | Comunicador de resultado | Explica a sentença ao cliente **depois** que a Dra. aprova o texto. | 🆕 |

## 8. Financeiro

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 51 | Faturamento e cobrança | Parcelas, boleto/Pix, régua e acordos. | ✅ |
| 52 | Recuperação de inadimplentes | Negocia atrasados dentro de limites que a Dra. definir. | 🟡 |
| 53 | Conciliação | Extrato do banco e cartão contra os lançamentos. | ✅ |
| 54 | Alvarás e repasses | Alvará → levantamento → repasse (30% + sucumbência; parceria 15/15). | 🟡 |
| 55 | Dativo | Nomeação, arbitramento, cobrança do Estado. | ✅ |
| 56 | Contas a pagar | Lança e lembra contas; baixa só com "sim". | ✅ |
| 57 | Fiscal | Recibos e notas, apoio ao carnê-leão. | 🆕 |
| 58 | Controladoria financeira | Rentabilidade por caso, relatório executivo mensal. | ✅ |

## 9. Gestão e secretaria

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 59 | **Secretária particular da Dra.** | Recebe o trabalho de todos os agentes e entrega à Dra. mastigado, numa caixa única no WhatsApp. Primeira função: a sentença lida. Próximas: aprovar ou recusar com uma resposta ("recorrer", "não recorrer", "aprovar peça"). | ⭐ **entregue (1ª função)** |
| 60 | Chefe de gabinete | Briefing das 7h, tela "Hoje", fechamento do dia. | ✅ |
| 61 | Assistente de comando | A Dra. e a Jessica mandam fazer pelo WhatsApp. | ✅ |
| 62 | Gestor de conhecimento | Biblioteca de teses e modelos (Obsidian → CRM). | 🟡 |
| 63 | Radar jurídico | Súmulas novas, temas repetitivos e mudanças de lei que afetam processos da carteira. | 🟡 `legalNewsService` |

## 10. Qualidade, treino e testes

| # | Agente | O que faz | Hoje |
|---|---|---|---|
| 64 | Treinador | Compara a minuta da IA com o que a Dra. protocolou e propõe ajustes nos modelos. Ela aprova. | 🆕 |
| 65 | Testador | Banco de casos anonimizados com a resposta certa. Um agente que piora não entra no ar. | 🟡 836 testes automáticos; falta o banco de casos reais |
| 66 | Compliance OAB/LGPD | Trilha de quem fez o quê, portões respeitados, aviso de IA, publicidade. | 🟡 |
| 67 | Auditor de custo de IA | Gasto por agente e alerta de exagero. | 🆕 |

Marketing (Orbit) segue separado.

---

## Portões da Dra. (nunca saem sem ela)

1. Aceitar ou recusar caso.
2. Aprovar e protocolar peça. O certificado é dela e fica com ela.
3. Acordo.
4. Não recorrer, desistir ou renunciar.
5. Mensagem ao cliente com conteúdo jurídico. Status neutro e lembretes saem automáticos.
6. Pagamentos e repasses.
7. Mudança em modelo ou playbook sugerida pelo Treinador.

## Decisões aprovadas (14/10/2026)

| Decisão | Ficou assim |
|---|---|
| O que vai ao cliente sem a Dra. ver | Só status neutro e lembretes |
| Jurisprudência | Só fontes oficiais gratuitas no começo |
| Certificado digital no servidor | Não; o protocolo é o toque dela |
| Área-piloto | Trabalhista |
| Aviso de IA no contrato | Feito: está nos 4 contratos padrão |

## Fontes oficiais de jurisprudência

Pangea/BNP do CNJ (precedentes qualificados), Portal de Dados Abertos do STJ, portais do TST, TRT17, TJES, TRF2 e TNU, Planalto/LexML (lei vigente) e DataJud (andamentos). **Regra:** sem número, órgão, data, link oficial e trecho conferido, o precedente não entra na peça.

---

## Ordem de construção

| Fase | Conteúdo | Situação |
|---|---|---|
| **1. Fundação** | ⭐ Leitor de sentença · ⭐ Secretária particular (1ª função) · ⭐ aviso de IA no contrato · ⭐ Escritório virtual visual (menu) + Métricas da IA · ⭐ Laya na qualificação (instalada na VPS em 16/10) · Secretária com aprovação por resposta · prazo interno com escalonamento · Auditor de prazos · Pesquisador + Verificador · Testador com casos reais | **em andamento** |
| **2. Produção trabalhista** | Especialista trabalhista ponta a ponta, Especialista em recursos, Revisor por peça, Preparador e Conferente de protocolo, calendário forense TRT17 | |
| **3. Demais áreas e leitura** | Especialistas previdenciário, família e consumidor; Leitor de laudo e de ata; Calculista de valores; Execução | |
| **4. Cliente** | Recepcionista automática, Triador, ~~Conflito de interesses~~ ✅, ~~Coletor de documentos~~ ✅, ~~Negociação~~ ✅, ~~Analista de documentos~~ ✅, ~~Qualificação em % e copiloto~~ ✅, Avisador, Comunicador de resultado | em andamento (adiantado) |
| **5. Dinheiro e aprendizado** | Vigia de alvarás/RPV, repasse de ponta a ponta, Fiscal, Treinador, Auditor de custo, vigias de pauta e do INSS | |

## Fontes consultadas

- Recomendação 001/2024 do CFOAB e diretrizes do TED da OAB/SP (mai/2026); plano nacional de IA da OAB (jun/2026).
- Multas por jurisprudência falsa gerada por IA: TJSC, TJPR, TSE, JF Londrina, Justiça do Trabalho.
- Resolução CNJ 615/2025; Pangea/BNP (Res. CNJ 444/2022); Portal de Dados Abertos do STJ; certificado digital e MNI no PJe (CNJ, TRF1, CSJT).
- Estrutura de escritório: controladoria jurídica (ADVBOX), paralegal e backoffice (Company Hero; vagas reais).
- Agentes jurídicos de IA em 2026: Migalhas, iaLocus, Glade (guia de jun/2026: revisão humana antes de sair do escritório; autonomia total da entrada ao protocolo falha).
