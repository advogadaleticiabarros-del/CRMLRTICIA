# WhatsApp: Categorização de Documento + Ação de IA na Conversa — Spec

**Status:** Aprovada (decisões tomadas pelo assistente por autorização explícita da usuária — "implemente o plano direto", sem mais perguntas de brainstorm)
**Parte de:** "WhatsApp & mensageria" (categoria do Diagnóstico do Ecossistema, hoje em 60%) — 2 de 3 itens pendentes. O terceiro (conexão oficial da Meta) fica de fora, por decisão explícita.

## Contexto real (confirmado por exploração de código, não pelo Artifact)

- Mídia recebida no WhatsApp já vira `documents` automaticamente (`src/routes/whatsapp-webhook.ts:33-70`, função `storeMedia`), mas sempre com `type='recebido'`, `folder='outros'` — sem categorização real.
- Existe uma função de IA que já lê a imagem (`descreverImagem`, `src/services/whatsappTranscricao.ts:48-55`, via Gemini/`aiExtractFromFile`), mas hoje só roda sob demanda antes do resumo de conversa, e só devolve texto solto anexado à mensagem — nunca grava nada em `documents`.
- A tela de Conversas (`public/whatsapp.js`, função `tabConversas`) já tem 3 ações de IA (resumir conversa, transcrever áudio, preencher lead) — todas chamando `aiComplete` com prompts fixos embutidos em `whatsapp-instance.ts`, sem passar pelo catálogo de tipos nem pelo histórico que o módulo de peças/minutas já tem.
- O módulo de peças/minutas (`src/routes/ai.ts`, `POST /api/ai/generate`) já tem: catálogo de tipos (`PIECE_TYPES`), reaproveitamento de modelo próprio do escritório (`document_templates`), histórico (`ai_generations`), e endpoint de salvar direto como documento (`POST /:id/save-document`, grava com `type='ia'`).
- Divisão de IA confirmada: Gemini lê imagem/redige texto longo; Groq analisa/tria rápido (resumo, extração, transcrição de áudio).

## Item 1 — Categorização automática de documento recebido

**Problema**: cliente manda RG/CTPS/comprovante pelo WhatsApp, documento entra genérico ("recebido"/"outros"), difícil de achar depois.

**Decisão de design**: NÃO perguntar "isso é um RG?" por mensagem de WhatsApp de volta pro cliente (fluxo conversacional de confirmação é complexo, exige estado de conversa pendente, e arrisca confundir o cliente). Em vez disso:
- Ao salvar a mídia como `documents` (mesmo ponto de `storeMedia`), chamar Gemini (`aiExtractFromFile`, já usado por `descreverImagem`) com um prompt curto pedindo só a classificação do tipo de documento dentre uma lista fixa (`rg`, `ctps`, `comprovante_residencia`, `procuracao`, `outro`).
- Gravar a sugestão em `documents.type` diretamente (best-effort — se a IA falhar ou não tiver certeza, mantém `'recebido'` como já é hoje, sem quebrar o fluxo existente).
- Na tela de Documentos do cliente (não no WhatsApp), o nome do arquivo passa a mostrar o tipo sugerido, e a usuária pode corrigir manualmente como já faz hoje com qualquer outro documento (não precisa de UI nova de confirmação — reaproveita o campo `type` e a edição que já existe).

**Fora de escopo**: fluxo de confirmação interativa via WhatsApp (pergunta/resposta), OCR estruturado (extrair nome/CPF do RG em campos separados — só classifica o tipo, não extrai dado).

## Item 2 — Botão de ação de IA dentro da conversa

**Problema**: usuária sai da tela de Conversas pra gerar proposta/minuta com dados que o cliente já mandou, perdendo contexto e retrabalho de digitar de novo.

**Decisão de design**: adicionar um botão "Gerar com IA" na tela de Conversas (`public/whatsapp.js`, perto do botão de resumo já existente), que abre um seletor com os tipos já catalogados em `PIECE_TYPES` (`src/routes/ai.ts`) — reaproveitando o catálogo existente, sem inventar um novo. Ao escolher um tipo:
- O texto da conversa (mensagens da timeline já carregada em `renderMsgs`) é enviado como `inputs.contexto_conversa` para `POST /api/ai/generate` (mesmo endpoint que Minutas já usa).
- O resultado abre no mesmo modal de preview que o módulo de peças já usa hoje, com a opção de salvar como documento do cliente (reaproveitando `POST /:id/save-document`, já existente).
- Não duplica prompt nem lógica de IA nova — só alimenta o pipeline existente com o contexto da conversa em vez de formulário manual.

**Fora de escopo**: gerar proposta preenchendo automaticamente valores financeiros a partir da conversa (isso exigiria extração estruturada, não coberta aqui — o Gemini recebe o texto bruto da conversa como contexto e redige, mas não popula campos numéricos da Proposta).

## Testes

- Item 1: teste de unidade da função de classificação (mock do retorno do Gemini) confirmando que só os 5 valores da lista fixa são aceitos, qualquer outro cai em `null`/mantém `'recebido'`; teste confirmando que falha da IA não impede o salvamento do documento (mesmo comportamento resiliente que `descreverImagem` já tem hoje).
- Item 2: teste de auditoria estática confirmando que a nova chamada de frontend usa o endpoint `/api/ai/generate` existente (não uma rota nova duplicada); teste de backend confirmando que `inputs.contexto_conversa` é aceito e incorporado ao prompt sem quebrar o fluxo existente de Minutas (que não manda esse campo).
