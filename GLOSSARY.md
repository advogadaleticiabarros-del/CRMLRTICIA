# Glossário do CRM jurídico

O vocabulário do escritório da Dra. Letícia e onde cada coisa mora no sistema. Use estes nomes no código, nos testes e nas conversas: quando um termo daqui muda de sentido, atualize este arquivo junto. Criado em 16/10/2026.

## Pessoas

| Termo | O que é | No sistema |
|---|---|---|
| **Cliente** | Quem contratou o escritório (contrato assinado). | `clients` |
| **Possível cliente** (lead) | Quem procurou o escritório e ainda não contratou. Passa por triagem, atendimento, reunião, documentação pendente, proposta e contrato. | `leads` (coluna `status`) |
| **Parte contrária** | Quem está do outro lado no processo (empresa, INSS, banco). Usada na checagem de conflito de interesses. | `case_partes` (`papel = 'contraria'`) |
| **Parceiro** | Advogado ou escritório que divide casos com a Dra. (parceria). | `partners` |
| **Correspondente** | Advogado contratado para um ato em outra comarca (audiência, diligência). | `correspondent_hearings` |
| **Assistido (dativo)** | Pessoa atendida pela Dra. por nomeação do juízo, paga pelo Estado. | `dative_cases` |
| **Comandantes** | Números que dão ordens ao CRM pelo WhatsApp: a Dra. e a Jessica. | `office_settings.assistente_whatsapp_numeros` |

## Casos e processos

| Termo | O que é | No sistema |
|---|---|---|
| **Caso** | O trabalho do escritório para um cliente sobre um assunto. Pode ter mais de um processo. | `cases` |
| **Processo** | O processo judicial, com número CNJ, vigiado nos tribunais. | `legal_processes` |
| **Movimentação** | Cada andamento do processo vindo do tribunal, do DJEN ou do e-mail. | `process_movements` |
| **Intimação / publicação** | Comunicação oficial ao advogado. Abre prazo. | `process_movements` com `source = 'djen_oab'` e outras fontes |
| **DJEN** | Diário de Justiça Eletrônico Nacional, varrido pela OAB da Dra. | rotina `monitoramento:descoberta-oab` |
| **Prazo** | Data-limite para um ato, contada em dias úteis. O **prazo detectado** é a sugestão da IA a confirmar. | `deadlines`, `detected_deadlines` |
| **Marcha processual** | As etapas do processo (inicial, citação, audiência, provas, sentença, recursos). "Tem dia para começar, mas não tem dia para terminar." | `negociador.ts` (`MARCHA_PROCESSUAL`) |
| **Sentença / acórdão** | Decisão do juiz / do tribunal. Lida pelo Dr. Lucas, com os prazos de recurso por tabela fixa. | `decisao_leituras`, `leitorDecisao.ts` |
| **Peça** | Documento para o processo (inicial, contestação, recurso, manifestação). **Minuta** é a versão que a Dra. revisa. | `documents`, `peca_modelos` |
| **Juntada de conta** | Manifestação que informa ao juízo os dados bancários para o crédito. Tem modelo padrão no Obsidian. | `Modelos de Peças/Trabalhista` |
| **Prescrição bienal** | Na trabalhista, a ação precisa entrar até 2 anos depois da saída. | `analistaDocumentos.ts` |

## Dinheiro

| Termo | O que é | No sistema |
|---|---|---|
| **Proposta** | Oferta de honorários ao possível cliente. Só vai ao cliente com o "aprovar" da Dra. | `propostas` |
| **Contrato** | Contrato de honorários assinado pelo link. | `contracts` |
| **Honorários iniciais** | Valor fixo (entrada + parcelas). | `propostas.honorarios.parcelamento` |
| **Êxito** | Percentual sobre o que o cliente ganhar. Padrão do escritório: 30% + sucumbência. | `honorarios.values.exito` |
| **Sucumbência** | Honorários pagos pela parte que perdeu. São do advogado e não abatem o contratual. | — |
| **Parcela** | Cada pagamento do cliente ao escritório. | `installments` |
| **Receita** | Dinheiro que entrou no escritório. | `receitas` |
| **Acordo** | Acordo no processo (a parte contrária paga em parcelas). | `agreements` |
| **Repasse** | O que o escritório recebeu em nome do cliente e passa a ele, já tirados os honorários. | `repasses`, `agreement_client_payouts` |
| **Prestação de contas** | Texto padrão ao cliente: o que entrou, o que ficou de honorário, o que foi repassado e o cronograma. | `prestacaoContas.ts` |
| **Tabela de honorários** | Parâmetro de valor das propostas, na ordem: tabela da Dra., OAB/RJ, histórico, só êxito. | `tabela_honorarios`, `tabelaOabRj.ts` |
| **URH** | Unidade Referencial de Honorários da OAB/ES, com valor mensal. É o piso ético da seccional (CED, art. 48, §6º). | — (a implementar) |
| **Capacidade de pagar / chance de fechar** | A qualificação em % do possível cliente, feita pelo Dr. Otávio. | `leads.capacidade_pct`, `fechamento_pct` |

## Escritório virtual

| Termo | O que é | No sistema |
|---|---|---|
| **Agente** | Membro da equipe virtual (ex.: Dra. Lívia, Dr. Rafael), dono de rotinas e ações. | `escritorioVirtual.ts` (`AGENTES`) |
| **Rotina** | Tarefa automática com horário (cron). Cada execução fica registrada. | `job_runs`, `src/crons/index.ts` |
| **Rascunho** | Resposta preparada por um agente que só sai depois de alguém da equipe aprovar. | `atendente_rascunhos` |
| **Portões da Dra.** | O que só ela decide: aceitar caso, protocolar, acordo, desistir, conteúdo jurídico ao cliente, pagamentos, proposta. | `docs/escritorio-virtual/01-mapa-de-agentes.md` |
| **Memória do agente** | O que o agente aprendeu com as correções e as reuniões. | `agente_memorias` |
| **Cérebro** | A biblioteca: o cofre do Obsidian indexado para busca. | `cerebro_notas`, `cerebro_trechos` |
| **Erro do sistema** | Falha do servidor ou da tela, agrupada e avisada pelo Dr. Bento. | `erros_sistema` |
