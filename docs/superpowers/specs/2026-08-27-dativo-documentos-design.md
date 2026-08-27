# Documentos por demanda dativa — design

## Contexto

O módulo Dativo (`src/routes/dative.ts`) gerencia demandas nomeadas pelo
Estado (audiências, valores estimados, recebimentos, relatos). Para solicitar
o pagamento de cada nomeação, a Dra. Letícia precisa reunir documentos
comprobatórios (termo de nomeação, certidões de audiência, comprovantes de
atuação) — hoje ela só tem esses documentos fisicamente, sem cópia
eletrônica organizada por demanda.

O sistema já tem um módulo de Documentos (GED) completo (`src/routes/
documents.ts`): upload em base64 (sem multer), armazenamento como blob em
`documents.data`, pastas por categoria, download autenticado, geração a
partir de template. Este design **estende** esse GED — não cria um sistema
de upload paralelo — adicionando um vínculo direto com a demanda dativa e uma
seção de documentos na própria tela de detalhe da demanda, para consulta e
upload sem sair da tela.

## 1) Novo campo em `documents`

Migration `ALTER TABLE documents ADD COLUMN dative_case_id INT NULL, ADD
FOREIGN KEY (dative_case_id) REFERENCES dative_cases(id)` — opcional, não
quebra documentos existentes. Segue o mesmo papel de `case_id`: um vínculo
adicional, não substitui `client_id` (que continua obrigatório).

## 2) Novas pastas (categorias) do GED

Adicionar ao array `FOLDERS` em `documents.ts`:

- `nomeacao` — termo de nomeação
- `certidao_audiencia` — certidões de audiência
- `comprovante_atuacao` — comprovantes de atuação
- `outros` (já existe) — qualquer outro documento sem categoria específica

Essas pastas convivem com as genéricas já existentes (`contratos`,
`procuracoes`, `documentos_pessoais`, `processos`, `financeiro`,
`audiencias`, `outros`) — um documento de dativo pode, em tese, usar
qualquer pasta, mas o formulário de upload na tela do dativo vai sugerir
só essas quatro.

## 3) Backend — `src/routes/documents.ts`

- `POST /` — aceita `dative_case_id` opcional no body; grava junto com os
  campos já existentes (`client_id`, `case_id`, `file_base64`, `mime`,
  `folder`, `status`).
- `GET /` — aceita `?dative_case_id=` como novo filtro, no mesmo padrão de
  `client_id`/`folder` já implementados.

Nenhuma outra rota muda — download (`GET /:id/file`), exclusão (`DELETE
/:id`), geração por template e assinatura continuam idênticas e já
funcionam com qualquer documento independente da origem.

## 4) Frontend — seção "Documentos" na tela da demanda dativa

Em `dativeCaseDetail` (`public/app.js`), adicionar uma nova seção logo após
"Audiências", dentro da mesma modal (sem navegação, sem nova aba de página):

- **Lista de documentos já anexados**, carregada via `GET /api/documents?
  dative_case_id=<id>`: nome, categoria (pasta), data, com botões Abrir/
  Baixar/Excluir — mesmo padrão visual (`mini-row`) já usado no GED geral
  (`gedDocumentos`).
- **Zona de envio**: uma área de arrastar-e-soltar que também é clicável
  (abre o seletor de arquivo nativo ao clicar, sem exigir drag). Ao soltar
  ou selecionar o arquivo, abre um mini-formulário com:
  - Nome do documento (pré-preenchido com o nome do arquivo, editável)
  - Categoria: Termo de nomeação / Certidão de audiência / Comprovante de
    atuação / Outros (as 4 pastas da seção 2)
  - Confirma e envia via `POST /api/documents` com `client_id` (do
    assistido, já presente em `d.client_id`), `dative_case_id: id`,
    `file_base64`, `mime`, `folder`, `name`.
- Limite de 15MB por arquivo — mesma validação já existente no backend
  (`documents.ts` linha ~151), replicada no client antes do upload (já é o
  padrão em `uploadDocForm`).

Como os documentos ficam na mesma tabela `documents` com `client_id`
preenchido, eles também aparecem organicamente quando a usuária for até
`Documentos → GED` e selecionar o cliente correspondente — sem duplicar
nada, sem sincronização manual.

## Fora de escopo

- Não altera o fluxo de geração de documentos (`POST /generate`) nem o de
  assinatura eletrônica — continuam servindo qualquer documento,
  independente de estar ligado a uma demanda dativa.
- Não cria uma tabela de anexos separada — a decisão explícita foi
  reaproveitar o GED existente para evitar duplicar armazenamento/lógica de
  upload já testada.
