# Acordo Extrajudicial (cliente x empresa) — design

## Contexto

O módulo `agreements` (tela "Acordos") hoje modela acordos judiciais: parte
contrária como texto livre, número de processo, honorários contratuais e
sucumbenciais, cronograma de entrada + parcelas, sincronização automática com
o financeiro (`syncAgreementFinanceLaunches`).

A Dra. Letícia também faz **acordos extrajudiciais** — negociados diretamente
entre cliente e empresa, sem processo judicial por trás (ex.: rescisão
trabalhista por acordo, reconhecimento de dívida civil, indenizações). Ela
pediu para isso ficar "válido" dentro do mesmo módulo de Acordos: dados
completos da empresa (inclusive advogado da parte contrária), forma de
pagamento/recebimento, e um termo gerado em papel timbrado a partir de
modelos reais que ela já usa.

Este design **estende** `agreements` — não cria um módulo separado — e reusa
o mecanismo de `document_templates` (já usado para Procuração e Contrato de
Honorários) para gerar o termo.

## Modelos reais usados como base (pesquisa)

Analisados os `.docx` da pasta `MODELO DE PEÇAS/EXTRAJUDICIAIS` (já
organizados em fichas no Obsidian, `Fichas/Extrajudicial/`):

- **Termo de acordo extrajudicial trabalhista (minuta simples)** — empresa
  (1º Acordante) x funcionário (2º Acordante), qualificação completa dos
  dois lados incluindo representante legal da empresa, objeto, valor,
  verbas discriminadas, cláusula de quitação geral com renúncia a ações
  futuras, assinatura + 2 testemunhas.
- **Instrumento particular de acordo extrajudicial (dívida civil)** —
  CREDOR (empresa) x DEVEDOR, reconhecimento de dívida, parcelamento com
  dados bancários (banco/agência/conta), cláusula de não-judicialização
  enquanto cumprido, notificação extrajudicial prévia via cartório antes de
  executar, cláusula penal por descumprimento, eficácia de título executivo
  extrajudicial (art. 784 CPC), foro de eleição.
- **Acordo em execução de alimentos** (judicial, mas mesmo padrão de
  pagamento) — parcelamento com datas, dados bancários do beneficiário,
  prazo de tolerância antes de vencimento antecipado, cláusula penal (20%),
  juros/correção monetária.

O termo gerado (seção 4) sintetiza os elementos comuns aos três, sem inventar
cláusulas que não apareçam nos modelos reais.

## 1) Novos campos em `agreements`

Migration `ALTER TABLE agreements ADD COLUMN ...` — todos opcionais/com
default, não quebra acordos existentes:

| Campo | Tipo | Descrição |
|---|---|---|
| `is_extrajudicial` | BOOLEAN DEFAULT 0 | Marca o acordo como extrajudicial (sem processo por trás). Filtrável na lista. |
| `opposing_cnpj` | VARCHAR(20) NULL | CNPJ da empresa (parte contrária). |
| `opposing_address` | VARCHAR(500) NULL | Endereço completo da empresa. |
| `opposing_legal_rep_name` | VARCHAR(255) NULL | Nome de quem assina pela empresa. |
| `opposing_legal_rep_cpf` | VARCHAR(20) NULL | CPF do representante legal. |
| `opposing_lawyer_name` | VARCHAR(255) NULL | Advogado da parte contrária. |
| `opposing_lawyer_oab` | VARCHAR(30) NULL | OAB do advogado da parte contrária. |
| `payment_method` | VARCHAR(30) NULL | PIX / TED / boleto / cheque / dinheiro / outro — um valor pro acordo inteiro. |
| `payment_flow` | ENUM('direto_cliente','via_escritorio') DEFAULT 'direto_cliente' | Pra onde a empresa paga primeiro. |
| `agreement_object` | TEXT NULL | Descrição do que está sendo acordado (objeto), pro termo gerado. |
| `penalty_percentage` | DECIMAL(5,2) NULL | Cláusula penal por descumprimento (%), presente nos 3 modelos pesquisados. |
| `jurisdiction_forum` | VARCHAR(255) NULL | Foro de eleição pro termo. |

## 2) Repasse ao cliente — nova tabela `agreement_client_payouts`

Só relevante quando `payment_flow = 'via_escritorio'`. Deliberadamente
**separada** de `repasses` (que hoje é só para parceiros e é somada como
despesa do escritório no DRE — misturar dinheiro de cliente ali reproduziria
o mesmo tipo de erro corrigido na auditoria financeira de hoje: dinheiro de
terceiro contado como receita/despesa do escritório).

```sql
CREATE TABLE agreement_client_payouts (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agreement_id      INT UNSIGNED NOT NULL,
  tranche_label     VARCHAR(60)  NOT NULL,   -- "Entrada", "1ª parcela", ...
  valor_bruto       DECIMAL(14,2) NOT NULL,  -- valor recebido do acordo nessa tranche
  valor_honorarios  DECIMAL(14,2) NOT NULL DEFAULT 0, -- retido pelo escritório
  valor_liquido     DECIMAL(14,2) NOT NULL,  -- a repassar ao cliente
  status            ENUM('pendente','repassado') NOT NULL DEFAULT 'pendente',
  data_prevista     DATE NULL,
  data_repasse      DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payout_agreement FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE
);
```

Gerada automaticamente (idempotente, mesmo padrão de
`syncAgreementFinanceLaunches`) quando `payment_flow = 'via_escritorio'`: uma
linha por tranche do cronograma (`montarCronogramaAcordo`), com
`valor_honorarios` = a fatia de honorário já lançada naquela tranche e
`valor_liquido` = `valor_bruto - valor_honorarios`.

**Importante**: essas linhas NÃO entram em nenhum relatório financeiro do
escritório (DRE, Visão Geral, Pulso do escritório) — são só um checklist de
"recebi X do acordo, retive meus honorários, falta repassar Y ao cliente".
Não é receita nem despesa do escritório.

## 3) Termo de Acordo Extrajudicial — documento gerado

Novo registro em `document_templates` (categoria `acordos`), com
`{{placeholders}}` seguindo o padrão já usado por Procuração/Contrato de
Honorários. Endpoint dedicado `POST /api/acordos/:id/gerar-termo` (paralelo a
`/api/documents/generate`, mas com o mapa de placeholders estendido pros
campos novos de empresa/advogado/pagamento):

Placeholders novos, além dos já existentes (`cliente_nome`, `cliente_cpf`,
`advogada_nome`, `advogada_oab`, `data_extenso`, ...):

- `empresa_nome`, `empresa_cnpj`, `empresa_endereco`
- `empresa_representante_nome`, `empresa_representante_cpf`
- `empresa_advogado_nome`, `empresa_advogado_oab`
- `acordo_objeto`, `acordo_valor_total`, `acordo_forma_pagamento`
- `acordo_cronograma` (lista formatada: entrada + parcelas, de
  `montarCronogramaAcordo`)
- `acordo_clausula_penal` (texto pronto, ex.: "20% (vinte por cento) sobre o
  valor da parcela vencida e não paga" — só aparece se `penalty_percentage`
  preenchido)
- `acordo_foro`

Estrutura do termo (clausulado, baseado nos 3 modelos reais):
1. Qualificação das partes (Primeiro Acordante = empresa, Segundo Acordante
   = cliente — ou o inverso conforme o caso)
2. Do objeto do acordo
3. Do valor e forma de pagamento (+ cronograma se parcelado)
4. Da quitação (cláusula de quitação geral, renúncia a ações futuras —
   linguagem dos modelos trabalhista/civil)
5. Da cláusula penal (condicional — só entra se preenchida)
6. Do foro
7. Assinaturas + 2 testemunhas

Resultado: uma linha em `documents` (igual ao fluxo existente), abrível via
`printBranded` em papel timbrado, pronta pra imprimir/assinar.

## 4) Tela (Acordos)

No formulário "Novo acordo" / "Editar acordo" (`public/app.js`,
`finAcordos`):
- Toggle "Extrajudicial" (`is_extrajudicial`)
- Seção "Empresa" (sempre visível, preenchimento opcional): CNPJ, endereço,
  nome e CPF do representante legal
- Seção "Advogado da parte contrária": nome, OAB
- Select "Forma de pagamento": PIX / TED / boleto / cheque / dinheiro / outro
- Select "Fluxo do dinheiro": direto ao cliente / via escritório (com
  repasse)
- Campo "Objeto do acordo" (textarea)
- Campo "Cláusula penal (%)" (opcional)
- Campo "Foro de eleição"

No detalhe do acordo:
- Se `payment_flow = 'via_escritorio'`: painel novo "Repasses ao cliente"
  listando as tranches (`agreement_client_payouts`), com botão "Marcar como
  repassado" por linha.
- Botão "Gerar termo" (ao lado de "Assinar"/"Encerrar"/"Cancelar"), que
  chama `POST /api/acordos/:id/gerar-termo` e abre o resultado em
  `printBranded`, mesmo padrão do "Relatório do contador".

## Fora de escopo (YAGNI, não pedido)

- Forma de pagamento por parcela (confirmado: um campo só pro acordo
  inteiro).
- IA para redigir cláusulas customizadas — o termo usa texto fixo com
  placeholders, igual Procuração/Contrato de Honorários.
- Assinatura eletrônica integrada — o termo só é gerado em PDF pra
  assinatura manual (fora de escopo desta spec).
- Pipeline "cérebro jurídico" (IA lendo o cofre Obsidian pra redigir peças
  novas) — roadmap futuro separado, não faz parte desta spec.
