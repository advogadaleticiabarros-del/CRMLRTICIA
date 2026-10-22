# Relatório — Mesa do caso por etapa

**Data:** 22/10/2026

## Pedido
A Jessica perguntou se as outras partes do card (a abertura do card, a separação de documentos e as demais etapas) já estavam no formato novo. Não estavam: a mesa abria sempre na aba Peça. Ela pediu para aplicar direto.

## O que foi feito
- **A mesa abre no trabalho de cada etapa.** A regra fica no servidor (`abaDaEtapa` em `src/services/mesaCaso.ts`):
  - Em análise → Caso;
  - Separação de documentos → Documentos;
  - Criação inicial e Aguardando protocolo → Peça;
  - Revisão inicial → Peça com o parecer ao lado;
  - Protocolado e Concluído → Caso.
- **Aba Caso:**
  - resumo do protocolo: nº, data, versão protocolada, valor e acompanhamento nos tribunais;
  - relato do atendimento e relato da Dra. Camila;
  - análise da Dra. Helena, com os pontos graves primeiro e "Analisar de novo" (rota `POST /api/mesa/:id/analisar`, em segundo plano, sem mandar nada ao cliente).
- **Aba Documentos:**
  - aviso de mensagens esperando aprovação;
  - checklist grande;
  - coleta da Dra. Camila (`resumoColeta`: o que pediu, o que chegou e as cobranças preparadas);
  - enviar arquivos (escolher ou arrastar, até 15 MB, pela rota de documentos que já existia);
  - Drive e lista dos documentos do caso.
- **Coluna da esquerda:** passou a mostrar só o resumo dos documentos, com atalho para a aba.

## Verificado
- 3 testes novos de regra (aba por etapa, resumo da coleta, ordem dos achados); suíte inteira sem falhas; lint sem erros.
- Fotos de cada etapa no Chromium, com dados fictícios: cada uma abre na aba certa, sem erro de JavaScript, e a tela cabe no celular.
- Detector de design: sem apontamentos.
- O teste de ponta a ponta confere que o caso em análise abre na aba Caso e que a aba Documentos tem o envio de arquivos.

## Pendente
- Continua em aberto (decisão da Jessica): os avisos de WhatsApp ao cliente no Protocolado e no Concluído vão pela fila automática, sem aprovação.
- A tela "Processos" ainda abre o detalhe antigo para processos que não estão na produção.
