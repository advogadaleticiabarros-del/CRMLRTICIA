# Relatório — Mesa do caso

**Data:** 22/10/2026

## Pedido
Na produção, dentro do card não dava para mudar, editar nem formatar nada. A Jessica pediu uma tela para trabalhar caso a caso, com início, meio e fim claros, usando o CRM inteiro sem sair dele, a não ser para copiar a versão final para o Jusbrasil. Também pediu que a edição da Dra. crie a v2 e que o agente responsável e a Laya comparem as versões e aprendam.

## Análise (skill impeccable)
- O modal antigo tinha 17 blocos no mesmo peso. A peça ficava no 13º e abria só para leitura.
- Não dizia o que fazer em cada etapa, tinha um "Salvar" por campo e misturava a produção com o processo depois do protocolo.
- O desenho foi aprovado no artefato "Mesa do caso", com o quadro de antes e depois.

## O que foi feito
- **`public/mesa.js` (tela nova):**
  - régua de etapas com "o que fazer" e "pronto quando";
  - o caso à esquerda e a peça no centro, com formatação, campos em amarelo, salvamento automático, versões, comparação, lições, versão final e cópia para o Jusbrasil;
  - pendências, recado, observação e linha do tempo à direita.
- **`src/routes/mesa.ts`:** dados da mesa, edição (cria a versão da Dra.), versão final, comparação, lições, decisão da lição e revisão manual.
- **`src/services/mesaCaso.ts`:**
  - limpeza do HTML por lista fechada;
  - conversão entre HTML e texto, e do texto da IA para HTML;
  - contagem de campos a preencher, comparação por parágrafo e palavra, etapas e prompt das lições.
- **Esteira da peça:** as regras aprovadas entram na redação. A numeração das versões conta as da Dra.
- **Migration 168:** `documents.content_html`, `versao_de` e `final_em`, mais a tabela `peca_licoes`.
- **Correção:** o recado ao cliente (`client_message`) não era gravado pela rota.

## Verificado
- `npm run build`, `npm run lint` (0 erros) e `npm test` (17 testes novos da mesa; suíte inteira sem falhas).
- Auditoria do SQL novo contra as migrations.
- Fotos reais da tela no Chromium (Playwright), com dados fictícios: computador, tema escuro e celular.
  - Corrigido nas fotos: os campos em amarelo viravam faixas (classe repetida), a comparação ficava picotada, o seletor tinha fundo repetido no escuro e a tela passava da largura no celular.
- Detector de design da skill: sem apontamentos.
- Teste de ponta a ponta novo (abre pelo card, edita, cria a v2, compara, fecha com Esc). Roda no CI, que tem banco.

## Decisões
- A versão da equipe nunca é sobrescrita, e a lição só vira regra com a aprovação da Dra.
- O HTML fica numa coluna própria; o texto puro continua servindo à revisão e à Dra. Vera.
- Tela cheia por baixo dos modais, em vez de mais um modal.

## Pendente
- **Avisos ao cliente no Protocolado e no Concluído:** saem pela fila automática de WhatsApp, sem aprovação. Decidir com a Jessica se passam por "Mensagens para aprovar".
- **Primeira peça real:** conferir na mesa, em produção, a edição, a comparação e as lições.

## Próxima sessão
Ver com a Jessica as primeiras lições aprovadas e ajustar o prompt das lições se vierem regras ruins.
