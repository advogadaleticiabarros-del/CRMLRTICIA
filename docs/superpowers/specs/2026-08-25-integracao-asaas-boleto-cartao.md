# Integração Asaas — boleto e cartão recorrente com confirmação automática

**Data:** 2026-08-25
**Status:** aprovado para implementação

## Contexto

O CRMLRTICIA hoje só tem um meio de pagamento eletrônico: PIX estático
(`src/services/pixService.ts`), que monta o BR Code "copia e cola" localmente, sem nenhum
gateway de terceiro e sem custo por cobrança. Isso é ótimo em custo, mas tem uma limitação
estrutural: **não há confirmação automática de pagamento**. O status de uma parcela paga por
PIX sempre depende de alguém marcar manualmente como `pago` — hoje isso já gera fricção real,
comprovada pela existência da automação `financeiro:pagamentos-parados` (roda a cada 6h,
avisa quando um "já paguei" fica sem confirmação por 48h+).

Clientes que não usam PIX no dia a dia (comum entre clientes mais velhos, ou quem prefere
parcelar no cartão) hoje não têm alternativa dentro do sistema — a cobrança precisa ser feita
"por fora", sem registro automático.

Esta spec cobre o primeiro dos dois sub-projetos identificados para completar a categoria
Financeiro do CRM: **boleto e cartão (à vista e recorrente) com confirmação automática via
gateway de pagamento**. O segundo sub-projeto (previsão de receita ponderada por
probabilidade) é independente e será tratado em spec separada.

## Decisão do gateway: Asaas

Pesquisa comparativa (agosto/2026) entre Asaas, Efí, Cora, Mercado Pago, Pagar.me e Iugu,
com foco em baixo custo para baixo volume (dezenas de cobranças/mês, não centenas):

| Gateway | Mensalidade | Boleto pago | Cartão | Assinatura recorrente | API |
|---|---|---|---|---|---|
| **Asaas** | R$ 0 | R$ 0,99–1,99 | R$ 0,49 + 1,99–4,29% | Nativa (boleto + cartão) | REST simples, PT-BR |
| Efí | R$ 0 | R$ 3,45 | 3,49–4,39% | Nativa | REST, doc técnica robusta |
| Cora | R$ 0 (exige CNPJ) | grátis até 100/mês, depois R$1,90 | não confirmado p/ recorrência | boleto sim, cartão incerto | preço de API não público |
| Mercado Pago | R$ 0 | ~R$3,49 (fonte não oficial) | assinatura nativa forte | sim | mais voltada a e-commerce |
| Pagar.me / Iugu | sob consulta comercial | não confirmado | não confirmado | sim (produto dedicado) | modelo "fale com vendas", penaliza baixo volume |

**Decisão: Asaas.** Mensalidade zero, boleto mais barato do mercado avaliado, assinatura de
cartão pronta nativamente, API REST com webhook bem documentado, documentação em português,
sem necessidade de negociação comercial para saber o preço.

Fontes: [asaas.com/precos-e-taxas](https://www.asaas.com/precos-e-taxas),
[sejaefi.com.br/tarifas](https://sejaefi.com.br/tarifas),
[cora.com.br/boletos](https://www.cora.com.br/boletos/).

## Decisões de produto (confirmadas com a usuária)

1. **PIX atual não é substituído.** Continua exatamente como está — gratuito, estático,
   confirmação manual. O Asaas entra como opção **adicional**, não substitui nada que já
   funciona.
2. **O cliente escolhe a forma de pagamento**, não o sistema decide sozinho. As opções
   disponíveis: PIX (grátis, como hoje), Boleto, Cartão à vista, Cartão recorrente
   (assinatura automática mensal).
3. **Cartão recorrente é uma opção, não a única forma de cobrar por cartão** — a usuária
   confirmou querer as duas modalidades (assinatura automática E cobrança avulsa mês a mês)
   disponíveis, com a escolha entre elas feita no momento de fechar o contrato.
4. **A escolha da forma de pagamento acontece na Proposta**, e viaja junto quando ela vira
   Acordo/contrato — não se escolhe de novo depois.
5. **Consentimento explícito obrigatório** antes de enviar dado do cliente (nome, CPF,
   e-mail) ao Asaas — só acontece quando boleto/cartão é escolhido (nunca para PIX, que
   continua 100% interno). Um checkbox visível na Proposta, registrado com data/hora.
6. **Ambiente sandbox primeiro.** Toda a integração é construída e testada no ambiente de
   testes do Asaas (dados fictícios, mesma API) — a usuária ainda não tem conta Asaas criada;
   abrir a conta real e passar pela verificação deles é um passo que ela faz depois,
   trocando só a chave de API de sandbox para produção quando estiver pronta.

## Arquitetura

### Novo serviço: `src/services/asaasService.ts`

Isolado, seguindo o mesmo padrão de `pixService.ts`/`uazapiClient.ts` (um arquivo por
integração externa). Responsabilidades:
- Criar/buscar cliente no Asaas (`POST /v3/customers`) a partir dos dados do `clients`.
- Gerar cobrança avulsa — boleto ou cartão à vista (`POST /v3/payments`).
- Gerar assinatura recorrente de cartão (`POST /v3/subscriptions`).
- Validar a assinatura do webhook recebido (o Asaas assina os eventos; confirmar o token
  configurado bate antes de processar).

Nenhuma chamada ao Asaas acontece se `office_settings.asaas_api_key` (ou variável de
ambiente equivalente) estiver vazia — mesmo padrão de "automação para de funcionar em
silêncio, documentado" já usado para outras integrações (ex.: `briefing_whatsapp`).

### Onde a escolha entra: formulário de Proposta

O formulário de proposta (que já tem "entrada + parcelamento") ganha um campo novo
**"Forma de pagamento"**: `pix | boleto | cartao_avista | cartao_recorrente`. Quando a opção
é diferente de `pix`, aparece o checkbox de consentimento (obrigatório para salvar):

> "Autorizo o envio dos dados deste cliente (nome, CPF, e-mail) ao Asaas, processador de
> pagamento, para emissão de boleto/cobrança de cartão."

Esse campo (`payment_method`) e o registro do consentimento (`payment_consent_at`) ficam
gravados na proposta e são copiados para o Acordo quando a proposta é convertida — sem pedir
de novo.

### Geração da cobrança

Quando uma parcela (`installments`) associada a uma proposta/acordo com `payment_method !=
'pix'` está pronta para cobrança (mesmo gatilho que hoje prepara a fila do WhatsApp,
`whatsapp:fila`, 07:15):
1. Garante que o cliente existe no Asaas (`asaas_customer_id` salvo em `clients`, criado na
   primeira cobrança).
2. Cria a cobrança (boleto ou cartão avulso) ou, se `cartao_recorrente`, cria a assinatura
   **uma vez** na primeira parcela — as parcelas seguintes desse mesmo parcelamento não geram
   nova cobrança, pois a assinatura já cobra sozinha todo mês.
3. Salva `asaas_payment_id` (ou `asaas_subscription_id` na primeira parcela) na linha de
   `installments` correspondente.
4. O link de pagamento do Asaas é incluído na mensagem de cobrança que já existe hoje
   (WhatsApp/e-mail), sem duplicar o fluxo de envio.

### Confirmação automática via webhook

Novo endpoint público: `POST /api/public/asaas-webhook` (mesmo padrão de montagem do webhook
do WhatsApp — rota pública, validada por assinatura, não por sessão de usuário).

Ao receber o evento `PAYMENT_RECEIVED` (ou `PAYMENT_CONFIRMED`):
1. Valida a assinatura do webhook.
2. Localiza a parcela em `installments` pelo `asaas_payment_id`.
3. Marca como `pago`, com `paid_at` = data informada pelo Asaas.
4. Segue o mesmo fluxo que já existe hoje quando uma parcela é confirmada manualmente
   (nenhuma lógica nova aqui — reaproveita o que já existe em `financial.ts`).

### Rede de segurança contra webhook perdido

A automação já existente `financeiro:pagamentos-parados` (a cada 6h) passa a, além do
comportamento atual, também consultar diretamente o status no Asaas de qualquer parcela com
`asaas_payment_id` preenchido e ainda `pendente`/`em_processamento` há mais de algumas horas
— cobrindo o caso raro de o webhook não chegar por instabilidade momentânea.

### Cadastro da conta

Tela em Configurações → Financeiro: campo para colar a chave de API do Asaas (sandbox ou
produção). Sem chave configurada, as opções de boleto/cartão simplesmente não aparecem no
formulário de Proposta — só PIX continua disponível, sem erro nem tela quebrada.

## Modelo de dados

Migration nova, adicionando:
- `clients.asaas_customer_id VARCHAR(60) NULL`
- `propostas.payment_method ENUM('pix','boleto','cartao_avista','cartao_recorrente') NOT NULL DEFAULT 'pix'`
- `propostas.payment_consent_at DATETIME NULL`
- `agreements.payment_method` / `agreements.payment_consent_at` (mesmos campos, copiados da
  proposta na conversão)
- `installments.asaas_payment_id VARCHAR(60) NULL`
- `installments.asaas_subscription_id VARCHAR(60) NULL`
- `office_settings` ganha as chaves `asaas_api_key` e `asaas_environment` (`sandbox` |
  `production`)

## Fora de escopo

- Substituir o PIX estático atual — permanece como está.
- Previsão de receita ponderada por probabilidade — sub-projeto separado, spec própria.
- Reembolso/estorno via Asaas — não solicitado, tratar manualmente se necessário por ora.
- Split de pagamento (dividir automaticamente entre escritório e terceiro) — não é o caso de
  uso aqui (já existe fluxo de repasse próprio para acordos, tratado à parte).
- Emissão de nota fiscal automática — fora do escopo desta integração.

## Testes

- `asaasService`: testes unitários mockando a API do Asaas — criação de cliente, criação de
  cobrança avulsa, criação de assinatura, validação de assinatura de webhook (aceita
  assinatura válida, rejeita inválida).
- Auditoria de schema (reaproveitar `tests/helpers/schemaAudit.mjs`) nas novas colunas/rotas.
- Teste de integração do webhook: evento `PAYMENT_RECEIVED` válido marca a parcela certa como
  paga; evento com assinatura inválida é rejeitado sem alterar nada; evento para
  `asaas_payment_id` inexistente não derruba a rota (log de erro, sem 500).
- Teste do formulário de Proposta: campo de forma de pagamento default `pix` (compatibilidade
  com propostas existentes); checkbox de consentimento obrigatório quando forma != `pix`;
  campos aparecem/desaparecem apenas quando a chave do Asaas está configurada.
