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

**Decisão de design (corrigida após leitura do código real — `PIECE_TYPES` não é o catálogo certo)**: o catálogo real de tipos geráveis é `TEMPLATES` em `src/routes/ai.ts` (6 tipos: petição inicial, contestação, resumo de intimação, parecer, e-mail de cobrança, resumo da movimentação para o cliente — já exposto via `GET /api/ai/templates`), cada um com seus próprios campos de `inputs` específicos (não existe nem deve ser criado um campo genérico `contexto_conversa` aceito por todos). Adicionar um botão "Gerar com IA" na tela de Conversas (`public/whatsapp.js`, dentro de `renderContexto`, seguindo o mesmo padrão visual/estrutural do bloco `data-conv` já existente — tarefa/prazo/compromisso/anotação), que:
- Abre um modal com `<select>` dos 6 tipos de `GET /api/ai/templates` e, ao escolher um, mostra os campos daquele template (`fields`, já vem na resposta da API).
- Pré-preenche o primeiro campo do tipo `textarea` de cada template (ex: `texto` em `resumo_intimacao`, `movimentacao` em `resumo_cliente`, `consulta` em `parecer`) com o **resumo da conversa já gerado** (reaproveita `POST /api/whatsapp-instance/chats/:phone/resumo`, que já existe e já processa áudio/imagem via `garantirMidiaTranscrita`) — não com a timeline bruta, que teria ruído demais e templates diferentes esperam formatos diferentes de texto.
- A usuária pode revisar/editar o texto pré-preenchido antes de gerar.
- Envia para `POST /api/ai/generate` com `client_id` (de `cx.client?.id`, já disponível no contexto da conversa) e `inputs` no formato que aquele template espera.
- O resultado abre no mesmo modal de preview que o módulo de peças já usa hoje (a UI de resultado de `/api/ai/generate` já existe em outro lugar do frontend — reaproveitar o componente/fluxo, não recriar), com a opção de salvar como documento do cliente via `POST /:id/save-document` (já existente).
- Não duplica prompt nem lógica de IA nova — só alimenta o pipeline existente (templates, `ai_generations`, `document_templates`) a partir do resumo da conversa em vez de formulário manual do zero.

**Fora de escopo**: gerar proposta preenchendo automaticamente valores financeiros a partir da conversa (isso exigiria extração estruturada, não coberta aqui — o Gemini recebe o texto bruto da conversa como contexto e redige, mas não popula campos numéricos da Proposta).

**Reaproveitamento confirmado**: `iaForm(onSave)` e `iaViewer(id, onSave)` (`public/app.js:2447-2519`) já implementam o formulário de tipo+campos e o modal de preview/salvar-no-GED inteiros, e como `app.js` carrega antes de `whatsapp.js` no `index.html` (sem módulos ES — escopo global compartilhado), `whatsapp.js` já pode chamá-las diretamente. `iaForm` hoje sempre renderiza campos vazios; será generalizada para aceitar valores iniciais (client_id fixo + pré-preenchimento de um campo), sem duplicar o modal/form em `whatsapp.js`.

## Testes

- Item 1: teste de unidade da função de classificação (mock do retorno do Gemini) confirmando que só os 5 valores da lista fixa são aceitos, qualquer outro cai em `null`/mantém `'recebido'`; teste confirmando que falha da IA não impede o salvamento do documento (mesmo comportamento resiliente que `descreverImagem` já tem hoje).
- Item 2: teste de auditoria estática confirmando que a nova chamada de frontend usa o endpoint `/api/ai/generate` existente (não uma rota nova duplicada); teste de backend confirmando que `inputs.contexto_conversa` é aceito e incorporado ao prompt sem quebrar o fluxo existente de Minutas (que não manda esse campo).
