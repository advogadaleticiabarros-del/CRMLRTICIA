# Portal do Cliente 2.0 — Design

**Data:** 2026-07-03
**Autor:** Claude (metodologia Superpowers) + Dra. Letícia
**Status:** aguardando revisão

## 1. Objetivo

Elevar o Portal do Cliente (papel `cliente`) a uma experiência **acolhedora, clara e
completa**: o cliente leigo entende onde seu processo está, acessa os documentos que a
advogada liberar, paga suas parcelas via **Pix do escritório** de forma simples, e fala
com o escritório — tudo com a identidade visual já existente (navy + dourado, responsivo).

## 2. Não-objetivos (YAGNI)

- **Gateway de pagamento (Mercado Pago)** NÃO entra agora — mas a estrutura de dados já
  o prevê para ser plugado depois sem reescrever o fluxo do cliente.
- Chat em tempo real: o contato é via **WhatsApp** (botão), não um chat interno.
- Assinatura de documentos pelo portal (já existe fluxo próprio de assinatura).

## 3. Decisões (do brainstorming)

1. Escopo **completo**: experiência + funcionalidades.
2. Pagamento: **Pix do escritório** (chave copia-e-cola + QR). Comprovante é **opcional**.
3. Documentos: só os marcados **"visível ao cliente"** (interruptor por documento).
4. Andamento: **linha de etapas amigável** + **recado em linguagem simples** (campo por processo).
5. **"Já paguei"**: o cliente clica e a parcela fica **"em processamento"**; o escritório
   recebe **alerta** e dá a **baixa** manualmente (ou recusa). Anexar comprovante é opcional.

## 4. Modelo de dados (migrations)

Próxima migration livre: **053** (a última é 052).

1. `053_portal_cliente.sql`:
   - `ALTER TABLE cases ADD COLUMN client_message TEXT NULL;` — recado ao cliente.
   - `ALTER TABLE documents ADD COLUMN visible_to_client TINYINT(1) NOT NULL DEFAULT 0;`
   - `CREATE TABLE office_settings (setting_key VARCHAR(60) PRIMARY KEY, setting_value TEXT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);`
     - Chaves usadas: `pix_key`, `pix_nome`, `pix_cidade`, `whatsapp`. (Futuro: `mercadopago_token`.)
   - `CREATE TABLE payments (id INT AUTO_INCREMENT PK, installment_id INT NOT NULL, client_id INT NOT NULL, method ENUM('pix_manual','mercadopago') DEFAULT 'pix_manual', status ENUM('em_processamento','confirmado','recusado') DEFAULT 'em_processamento', amount DECIMAL(12,2), proof_url VARCHAR(500) NULL, note VARCHAR(500) NULL, provider_txn_id VARCHAR(120) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, confirmed_at DATETIME NULL, confirmed_by INT NULL, INDEX(installment_id), INDEX(status));`
   - `installments.status` passa a aceitar o valor lógico **`em_processamento`** (não muda o
     ENUM se a coluna já for VARCHAR; se for ENUM, adicionar o valor). A "verdade" do
     pagamento fica em `payments`; o `installments.status` reflete o estado para exibição.

**Seam para Mercado Pago:** quando ativado, o "Pagar com Pix" cria um `payments` com
`method='mercadopago'` + `provider_txn_id`, e um webhook muda `status` para `confirmado` e
baixa a parcela — o front do cliente não muda.

## 5. Backend

### Portal (cliente) — `src/routes/portal.ts`
- `GET /me` — (existe) inclui saudação e resumo.
- `GET /cases` — (existe) + `client_message` + `stage_label` amigável.
- `GET /cases/:id` — + etapas amigáveis + recado + **documentos visíveis do caso** + movimentações (detalhes).
- `GET /documents` — lista `documents WHERE client_id = ? AND visible_to_client = 1` (download por `file_url`).
- `GET /pix?installment=:id` — retorna: `pix_copia_cola` (payload EMV do BR Code), `qr` (data-URI PNG), beneficiário (`pix_nome`/`pix_cidade`), `valor`. Gerado a partir de `office_settings`.
- `POST /installments/:id/pagar` — corpo opcional `{ note, proof (multipart) }`. Cria `payments`
  (`em_processamento`), marca `installments.status='em_processamento'`, e dispara **notificação
  ao escritório** (sino + e-mail) "Cliente X informou pagamento da parcela Nª".

### Escritório (staff/admin)
- `PATCH /documents/:id` — alterna `visible_to_client` (no GED/produção).
- `PATCH /cases/:id` (ou production-meta) — grava `client_message`.
- `GET/PATCH /settings` — lê/grava `office_settings` (Configurações → chave Pix, WhatsApp).
- `GET /payments?status=em_processamento` — fila "Pagamentos a confirmar".
- `POST /payments/:id/confirmar` — `status='confirmado'`, `installments.status='pago'`, baixa e
  registra na timeline. `POST /payments/:id/recusar` — `status='recusado'`, volta parcela a `pendente`.

Rota nova `src/routes/payments.ts` (staff) + `office_settings` numa rota `settings` (admin).

### Geração do Pix (BR Code / EMV)
- Payload EMV montado em TS (sem lib): campos 00/26 (GUI br.gov.bcb.pix + chave)/52/53/54(valor)/58(BR)/59(nome)/60(cidade)/62(txid)/63(CRC16). CRC16-CCITT calculado em código.
- QR como imagem: usar o pacote **`qrcode`** (npm) no servidor para gerar PNG data-URI a partir do payload. (Dependência nova pequena.)

## 6. Frontend — Portal do cliente (repaginado)

- **Cabeçalho** caloroso ("Olá, {nome} 👋" — texto, não emoji-ícone) + 3 cartões.
- **Meus processos:** cada caso é um cartão com:
  - **linha de etapas** (Documentos → Elaboração → Protocolo → Andamento → Conclusão) marcando a atual;
  - **recado da advogada** (client_message) em destaque suave;
  - botão **"Ver detalhes"** que abre as movimentações técnicas (ocultas por padrão).
- **Documentos:** seção listando os liberados, com **baixar**.
- **Valores a pagar:** cada parcela com **"Pagar com Pix"** → painel com chave copia-e-cola
  (botão copiar) + QR + botão **"Já paguei"** (e, opcional, "anexar comprovante"). Após clicar,
  a parcela mostra **"em processamento — aguardando confirmação do escritório"**.
- **Falar com o escritório:** botão WhatsApp (número de `office_settings`).
- Ícones **SVG** (padrão do sistema), responsivo, temas.

## 7. Frontend — controles do escritório

- **GED/Produção:** interruptor "visível ao cliente" por documento.
- **Processo:** campo "Recado ao cliente".
- **Configurações:** chave Pix (+ nome/cidade) e WhatsApp do escritório.
- **Financeiro:** aba/lista **"Pagamentos a confirmar"** com Confirmar (baixa) / Recusar.

## 8. Segurança e privacidade

- Portal já isola por `client_id` (middleware `loadClientId`). Manter em todas as rotas novas.
- Documentos: **só** `visible_to_client=1` do próprio cliente. Testar que não vaza minuta/peça interna.
- Pagamento: cliente só pode declarar pagamento de **parcela sua**; confirmação é sempre do escritório.

## 9. Fluxo de estados do pagamento

```
pendente ──(cliente "Já paguei")──> em_processamento ──(escritório confirma)──> pago
                                             └────────(escritório recusa)──────> pendente
```

## 10. Testes / QA

- Manual: cliente declara pagamento → escritório recebe alerta → confirma → parcela "paga".
- Manual: documento não-liberado NÃO aparece no portal; liberado aparece e baixa.
- Manual: etapas e recado aparecem corretamente; WhatsApp abre o número certo.
- Verificar isolamento por client_id (um cliente não vê dados de outro).

## 11. Fases de entrega (se preferir fatiar)

- **Fase 1:** experiência + etapas amigáveis + recado + documentos liberados.
- **Fase 2:** pagamento Pix (settings + payments + fila de confirmação + alertas).
- (Cada fase é independente e entregável.)
