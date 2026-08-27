# Aceite público de proposta não gera caso nem parcelas — design

## Contexto

O CRM tem dois caminhos para uma proposta virar "aceita":

1. **Aceite interno** (`POST /api/propostas/:id/accept`, `src/routes/propostas.ts:205`)
   — a advogada abre a proposta na tela, escolhe número de parcelas e 1º
   vencimento, clica "Aceitar proposta". Isso cria o `case` (se ainda não
   existir) e gera as `installments` (parcelas financeiras), numa transação.
2. **Aceite público** (`POST /api/public/proposta/:token/aceitar`,
   `src/routes/propostas-public.ts:57`) — o cliente clica direto no link que
   recebeu. Essa rota cria o cliente (se preciso), gera contrato/procuração/
   declaração de hipossuficiência, marca `aceito_em`/`status='aceita'` e move
   o lead para "fechada" — mas **nunca cria o caso nem as parcelas**.

Investigação em produção (2026-08-27) confirmou o problema com dados reais:
das 8 propostas com `status='aceita'`, **nenhuma tem `case_id` preenchido** e
**zero linhas existem na tabela `installments`** — mesmo para propostas com
parcelamento definido (ex.: proposta 1, R$4.000 em 4x de R$800, aceita em
23/06/2026, sem nenhuma parcela lançada até hoje).

Consequência: depois que o cliente aceita pelo link, a proposta trava nesse
estado permanentemente — a tela interna esconde o formulário de aceite
quando `status === 'aceita'` (`public/app.js:6246`), então não há mais
nenhum caminho na UI para gerar o caso ou as parcelas que faltaram. O
processo nunca aparece na esteira de produção, e o valor esperado nunca
aparece no financeiro (dashboard, DRE, fluxo de caixa) — a advogada só
descobre porque paga mais do que o sistema mostra ou porque o financeiro
"não bate".

## 1) Correção do fluxo — `src/routes/propostas-public.ts`

Dentro de `POST /proposta/:token/aceitar`, antes da linha que marca o
aceite (`UPDATE propostas SET aceito_em = NOW(), status = 'aceita' ...`,
hoje na linha 138), inserir dois passos novos, replicando o que a rota
interna já faz:

### 1a. Criar o caso

Mesmo padrão de `propostas.ts:239-247`:

```typescript
let caseId: number | null = null;
if (clientId) {
  const [cr] = await db.query(
    `INSERT INTO cases (user_id, client_id, title, legal_area, status)
     VALUES (?, ?, ?, ?, 'ativo')`,
    [p.user_id, clientId, p.title || 'Caso (proposta aceita)', area]
  ) as any;
  caseId = cr.insertId;
  await db.query('UPDATE propostas SET case_id = ? WHERE id = ?', [caseId, p.id]);
}
```

`clientId` e `area` já existem nesse ponto da função (linhas 96-117 e 117
do arquivo atual). Não recriar o cliente — a rota já garante isso antes.

### 1b. Gerar as parcelas, a partir do `parcelamento` já salvo na proposta

A variável `parcelamento` já é extraída em `propostas-public.ts:69-73` (via
`honorarios.parcelamento`, só quando `total > 0`). Adicionar a geração de
`installments` só quando `parcelamento` existir:

```typescript
if (parcelamento && Number(parcelamento.total) > 0 && caseId) {
  const total = Number(parcelamento.total);
  const numParcelas = Math.max(1, parseInt(parcelamento.parcelas) || 1);
  const entrada = Number(parcelamento.entrada) || 0;
  const primeiroVencimento = parcelamento.primeiro_vencimento
    ? new Date(parcelamento.primeiro_vencimento)
    : new Date();

  // Entrada vira a 1ª parcela quando seu valor difere das parcelas normais;
  // o restante do total se divide igualmente entre as parcelas seguintes
  // (arredondamento: resto de centavos vai na última, mesmo padrão já usado
  // em propostas.ts:220-221).
  const restante = entrada > 0 ? total - entrada : total;
  const parcelasRestantes = entrada > 0 ? Math.max(1, numParcelas - 1) : numParcelas;
  const base = Math.floor((restante / parcelasRestantes) * 100) / 100;
  const last = Math.round((restante - base * (parcelasRestantes - 1)) * 100) / 100;

  const valores: number[] = entrada > 0 ? [entrada] : [];
  for (let i = 0; i < parcelasRestantes; i++) {
    valores.push(i === parcelasRestantes - 1 ? last : base);
  }

  for (let i = 0; i < valores.length; i++) {
    const dueDate = toDateStr(addMonths(primeiroVencimento, i));
    await db.query(
      `INSERT INTO installments (user_id, client_id, proposta_id, case_id, numero, valor, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente')`,
      [p.user_id, clientId, p.id, caseId, i + 1, valores[i], dueDate]
    );
  }
}
```

`toDateStr`/`addMonths` já são importados em `propostas.ts` — importar os
mesmos helpers em `propostas-public.ts` (mesmo arquivo de utilitários).

Quando `parcelamento` é `null` (proposta só de êxito, ou sem valor fixo
definido — casos `apenas_exito: true` ou `parcelamento.total: 0`), **não
gerar nenhuma parcela**. O valor de êxito só se torna receita quando o
processo é ganho, via fluxo separado (`case_awards`), não é uma cobrança
agendável hoje.

## 2) Correção retroativa — script único, execução manual

As 8 propostas já aceitas em produção (ids 1, 3, 4, 5, 6, 9, 10, 11) ficaram
sem caso e (quando aplicável) sem parcela. Não dá para "re-disparar" o
aceite (a rota já teria efeitos colaterais duplicados como reenviar
notificação). Em vez disso, um script one-off aplica a mesma lógica da
seção 1 diretamente:

- Para cada proposta com `status='aceita'` AND `case_id IS NULL`: cria o
  caso.
- Para cada uma que também tenha `parcelamento.total > 0` E nenhuma
  linha em `installments` para aquele `proposta_id`: gera as parcelas.
- Propostas só de êxito ou sem parcelamento definido (3, 4, 6, 10, 11):
  recebem apenas o caso, sem parcela — mesma regra da seção 1b.

Script roda uma vez em produção, via SSH, lendo/gravando direto no MySQL
(mesmo acesso usado na investigação). Não é parte do código do app — vive
em `scripts/` como utilitário one-off, documentado como já executado após
rodar.

## Fora de escopo

- Não altera o aceite **interno** (`propostas.ts POST /:id/accept`) — já
  funciona corretamente.
- Não resolve a divergência de "Despesa Paga" (filtro pessoal/empresa no
  dashboard) — tratado como item separado, spec própria.
- Não adiciona idempotência nova além da que já existe (`if (p.aceito_em)
  { res.json({ success: true, already: true }); return; }`, linha 65) —
  aceite duplicado continua bloqueado do mesmo jeito.
