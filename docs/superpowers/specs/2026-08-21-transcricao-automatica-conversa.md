# Transcrição automática de áudio e fotos no Resumo da conversa

**Data:** 2026-08-21
**Status:** aprovado para implementação

## Contexto

O botão "Resumo da conversa" (`POST /api/whatsapp-instance/chats/:phone/resumo`) já gera,
via IA, um resumo cronológico dos fatos relatados pelo cliente. Ele lê o `body` de cada
mensagem de `whatsapp_messages` através do helper `conversaTexto()`.

Hoje isso tem duas lacunas:
- **Áudio**: só entra no resumo se alguém já clicou manualmente em "Transcrever áudio"
  naquela mensagem antes. Áudio não transcrito é invisível pro resumo.
- **Foto**: nunca entra no resumo. Não existe descrição de imagem em lugar nenhum do
  sistema — só o link do anexo.

A usuária pediu para o resumo "ler tudo sozinho" — texto, áudio e foto — sem precisar
transcrever áudio por áudio antes.

## Decisão de design

Um único botão. Não existe ação nova separada — o botão "Resumo da conversa" que já existe
passa a, antes de montar o resumo, garantir que toda mensagem de áudio e toda foto daquela
conversa tenha uma versão em texto gravada na própria mensagem (igual já acontece hoje
quando alguém clica manualmente em "Transcrever áudio"). O botão de varinha do mockup sai —
vira o mesmo ícone de resumo que já existe hoje no cabeçalho da conversa.

A descrição de foto é **salva permanentemente** no `body` da mensagem, na mesma convenção
já usada pela transcrição de áudio (`\n📝 Transcrição: ...` vira `\n🖼️ Descrição: ...` para
foto), para não reprocessar a cada novo resumo pedido.

## O que muda tecnicamente

### 1. Novo helper: `garantirMidiaTranscrita(phone)` em `src/routes/whatsapp-instance.ts`

Roda antes de montar `conversaTexto()` dentro de `/resumo`. Passos:

1. Busca todas as mensagens da conversa que têm `media_id` e cujo `body` ainda NÃO contém
   `'📝 Transcrição:'` nem `'🖼️ Descrição:'`:
   ```sql
   SELECT w.id AS msg_id, w.media_id, wm.mime, wm.file_name, wm.data
     FROM whatsapp_messages w
     JOIN whatsapp_media wm ON wm.id = w.media_id
    WHERE w.phone = ?
      AND w.body NOT LIKE '%📝 Transcrição:%'
      AND w.body NOT LIKE '%🖼️ Descrição:%'
    ORDER BY w.msg_time ASC
   ```
2. Para cada linha:
   - Se `mime` começa com `audio/` ou `video/` → reaproveita exatamente a lógica hoje em
     `POST /media/:id/transcricao` (Whisper via Groq). Extrai essa lógica para uma função
     `transcreverAudio(mediaRow)` reutilizável pelas duas rotas (a rota existente e o helper
     novo), para não duplicar código.
   - Se `mime` começa com `image/` → chama `aiExtractFromFile(base64, mime, instrucao)` de
     `src/services/aiAssistant.ts` (já existe, usa Gemini Vision, já é o padrão do sistema
     pra ler anexos). Instrução:
     > "Descreva em português, de forma objetiva e factual, o conteúdo desta imagem enviada
     > por um cliente de escritório de advocacia. Se for documento, extraia os dados visíveis
     > (nome, datas, valores, número de processo). Se for foto/print, descreva o que se vê.
     > Não invente informação que não está na imagem. Máximo 500 caracteres."
   - Grava no `body` da mensagem:
     ```sql
     UPDATE whatsapp_messages SET body = CONCAT(body, '\n🖼️ Descrição: ', ?)
      WHERE id = ? AND body NOT LIKE '%🖼️ Descrição:%'
     ```
   - Outros tipos de mídia (PDF, vCard etc.) são ignorados nesta função — fora de escopo.
3. Falha individual (ex: um áudio corrompido, Gemini/Groq fora do ar) não interrompe o loop:
   `try/catch` por item, segue para o próximo. Erros não são reportados ao usuário
   individualmente — o resumo final simplesmente não vai ter aquele item específico.
4. Limite de segurança: processa no máximo 15 itens pendentes por chamada (evita uma
   conversa com 100 fotos travar a requisição). Se houver mais que 15 pendentes, processa os
   15 mais recentes primeiro (mais relevantes pro resumo).

### 2. `POST /chats/:phone/resumo` passa a chamar o helper primeiro

```typescript
router.post('/chats/:phone/resumo', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  await garantirMidiaTranscrita(phone);
  const texto = await conversaTexto(phone);
  // ...resto igual
});
```

Isso significa que o resumo pode demorar mais quando há mídia pendente (chamadas de IA
síncronas). Não há requisito de tempo máximo nesta spec — é aceitável a usuária esperar um
pouco mais quando a conversa tem áudio/foto não processados; chamadas subsequentes do
resumo (mesma conversa, sem mídia nova) continuam rápidas porque tudo já está gravado.

### 3. `POST /media/:id/transcricao` (rota existente) é refatorada, não muda de contrato

Extrai o corpo da rota para a função `transcreverAudio(mediaRow)` compartilhada. A rota HTTP
existente continua igual (mesmo endpoint, mesma resposta) — só passa a chamar a função
extraída, para o helper novo poder reaproveitá-la.

### 4. Frontend — `public/whatsapp.js`

Nenhuma mudança de UI além do que já existe: o botão de resumo já mostra loading enquanto
espera a resposta da API (confirmar isso na implementação — se não mostrar, adicionar
feedback de "Gerando resumo..." já que a chamada pode demorar mais agora).

## Fora de escopo

- Botão de "transcrever tudo" separado do resumo — foi descartado, vira a mesma ação.
- Transcrição/descrição automática disparada por outro evento que não seja o clique manual
  em "Resumo da conversa" (ex: não roda em background ao receber mensagem nova).
- PDF, vCard, sticker, documentos não-imagem — continuam sem tratamento automático.
- Mudança no botão manual "Transcrever áudio" por mensagem — continua existindo e funcionando
  como está, útil para quando a usuária quer só aquele áudio sem gerar resumo.

## Testes

- `transcreverAudio()` extraído como função pura o suficiente para mockar `db.query` e o
  `fetch` do Groq — testar sucesso e falha (sem GROQ_API_KEY, resposta de erro da API).
- `garantirMidiaTranscrita()`: teste com mensagens mistas (texto puro, áudio já transcrito,
  áudio pendente, foto pendente, PDF) — confirma que só os pendentes de áudio/imagem são
  processados e que o resultado é gravado com o marcador certo (`📝 Transcrição:` vs
  `🖼️ Descrição:`).
- Teste de idempotência: rodar `garantirMidiaTranscrita()` duas vezes seguidas não duplica
  a transcrição/descrição no `body` (já coberto pela cláusula `NOT LIKE` no `UPDATE` e no
  `SELECT`).
- Teste do limite de 15 itens: mais de 15 pendentes, processa só os 15 mais recentes.
- `POST /chats/:phone/resumo`: teste de integração confirma que passa a incluir texto vindo
  de uma "foto" mockada (descrição gravada) no resumo final.
