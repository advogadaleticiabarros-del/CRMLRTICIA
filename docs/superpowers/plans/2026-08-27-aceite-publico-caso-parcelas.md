# Aceite público de proposta não gera caso nem parcelas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o cliente aceita uma proposta pelo link público, o sistema deve criar o caso (esteira de produção) e gerar as parcelas financeiras (`installments`) — hoje só gera contrato/procuração/declaração, deixando o valor esperado invisível no financeiro e o processo fora da esteira. Corrige também os dados já afetados em produção.

**Architecture:** Estende `POST /api/public/proposta/:token/aceitar` (`src/routes/propostas-public.ts`) para replicar, de forma síncrona antes de marcar o aceite, a mesma criação de caso + parcelas que já existe na rota interna (`POST /api/propostas/:id/accept`). Adiciona um script one-off (`scripts/backfill-propostas-aceitas.mjs`) para aplicar a mesma lógica às propostas já aceitas em produção sem caso/parcela.

**Tech Stack:** Node.js/Express/TypeScript, MySQL (mysql2/promise), testes com `node --test` (arquivos `.test.mjs`).

## Global Constraints

- Não alterar o aceite interno (`propostas.ts POST /:id/accept`) — já funciona corretamente.
- Toda query usa parâmetros posicionais (`?`) — nunca concatenar valor de usuário direto na string SQL.
- Quando `parcelamento` é nulo ou `total <= 0` (proposta só de êxito, sem valor fixo hoje), **não gerar nenhuma parcela** — o valor de êxito só vira receita quando o processo é ganho, via fluxo separado (`case_awards`).
- Entrada vira a 1ª parcela quando `parcelamento.entrada > 0`; o restante do total se divide igualmente entre as parcelas seguintes, com o resto de centavos de arredondamento sempre na última parcela (mesmo padrão de `propostas.ts:220-221`).
- Primeiro vencimento: usa `parcelamento.primeiro_vencimento` quando existir; senão, a data do aceite (hoje).
- O aceite público continua idempotente: `if (p.aceito_em) { res.json({ success: true, already: true }); return; }` já bloqueia aceite duplicado — não alterar essa checagem.

---

### Task 1: Rota pública cria o caso e gera as parcelas no aceite

**Files:**
- Modify: `src/routes/propostas-public.ts`
- Test: `tests/propostaPublicAceitarCasoParcelas.test.mjs`

**Interfaces:**
- Consumes: nenhuma interface nova de outras tasks (task única de código de produção).
- Produces: `POST /api/public/proposta/:token/aceitar` agora cria uma linha em `cases` (vinculada a `propostas.case_id`) e N linhas em `installments`, consumido pela Task 2 (script de backfill, que reaproveita a mesma lógica de cálculo de parcelas).

- [ ] **Step 1: Escrever os testes estáticos (falhando)**

Arquivo `tests/propostaPublicAceitarCasoParcelas.test.mjs`:

```javascript
// tests/propostaPublicAceitarCasoParcelas.test.mjs
// Confirma que o aceite público (POST /proposta/:token/aceitar) cria o caso
// e gera as parcelas financeiras, replicando o que a rota interna já faz
// (POST /:id/accept). Ver docs/superpowers/specs/2026-08-27-aceite-publico-caso-parcelas-design.md
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function rotaAceitar() {
  const src = fs.readFileSync(path.resolve('src/routes/propostas-public.ts'), 'utf8');
  const m = src.match(/router\.post\('\/proposta\/:token\/aceitar'[\s\S]*?\n\}\);/);
  assert.ok(m, 'rota /proposta/:token/aceitar não encontrada');
  return m[0];
}

test('aceite público cria o caso (INSERT INTO cases) antes de marcar aceito_em', () => {
  const rota = rotaAceitar();
  const casoIdx = rota.indexOf('INSERT INTO cases');
  const aceiteIdx = rota.indexOf("UPDATE propostas SET aceito_em");
  assert.ok(casoIdx > -1, 'a rota precisa criar o caso (INSERT INTO cases)');
  assert.ok(aceiteIdx > -1, 'a rota precisa marcar aceito_em');
  assert.ok(casoIdx < aceiteIdx, 'o caso precisa ser criado ANTES de marcar o aceite, para nunca marcar aceito sem caso');
});

test('aceite público grava propostas.case_id com o caso recém-criado', () => {
  const rota = rotaAceitar();
  assert.match(rota, /UPDATE propostas SET case_id = \?/, 'falta persistir o case_id na proposta');
});

test('aceite público gera parcelas (INSERT INTO installments) quando há parcelamento com total > 0', () => {
  const rota = rotaAceitar();
  assert.match(rota, /INSERT INTO installments/, 'a rota precisa gerar as parcelas financeiras');
  assert.match(rota, /parcelamento\.total/, 'a geração de parcelas precisa checar o total do parcelamento salvo na proposta');
});

test('aceite público NÃO gera parcela quando parcelamento é nulo (proposta só de êxito)', () => {
  const rota = rotaAceitar();
  const instIdx = rota.indexOf('INSERT INTO installments');
  const contexto = rota.slice(Math.max(0, instIdx - 400), instIdx);
  assert.match(contexto, /if\s*\(\s*parcelamento/, 'o INSERT INTO installments precisa estar dentro de um if que verifica parcelamento (não roda quando é null)');
});

test('aceite público usa parcelamento.primeiro_vencimento quando existir, senão a data de hoje', () => {
  const rota = rotaAceitar();
  assert.match(rota, /primeiro_vencimento/, 'falta usar o primeiro_vencimento salvo no parcelamento');
});

test('aceite público trata entrada como 1ª parcela quando parcelamento.entrada > 0', () => {
  const rota = rotaAceitar();
  assert.match(rota, /parcelamento\.entrada/, 'falta tratar o valor de entrada separado das parcelas normais');
});

test('geração de parcelas usa user_id, client_id, proposta_id, case_id — mesmos campos da rota interna', () => {
  const rota = rotaAceitar();
  const instIdx = rota.indexOf('INSERT INTO installments');
  const bloco = rota.slice(instIdx, instIdx + 300);
  assert.match(bloco, /user_id/);
  assert.match(bloco, /client_id/);
  assert.match(bloco, /proposta_id/);
  assert.match(bloco, /case_id/);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test tests/propostaPublicAceitarCasoParcelas.test.mjs`
Expected: FAIL em todos os testes (o código ainda não tem `INSERT INTO cases` nem `INSERT INTO installments` em `propostas-public.ts`).

- [ ] **Step 3: Adicionar os helpers de data (mesmos de `propostas.ts`, duplicados localmente)**

Em `src/routes/propostas-public.ts`, logo após a linha `const AREAS = [...]` (linha 36 atual), adicionar:

```typescript
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
const toDateStr = (d: Date) => d.toISOString().split('T')[0];
```

- [ ] **Step 4: Criar o caso e gerar as parcelas antes de marcar o aceite**

Em `src/routes/propostas-public.ts`, trocar o bloco (linhas 136-139 atuais):

```typescript
  // 3) Marca aceite, move o lead e registra
  await db.query("UPDATE propostas SET aceito_em = NOW(), status = 'aceita' WHERE id = ?", [p.id]);
  if (p.lead_id) await db.query("UPDATE leads SET status = 'fechada', analise_since = NULL WHERE id = ?", [p.lead_id]);
```

por:

```typescript
  // 3) Cria o caso (esteira de produção) — mesmo padrão do aceite interno
  // (propostas.ts POST /:id/accept). Sem isso, o processo nunca aparecia na
  // esteira e o financeiro nunca sabia que havia parcelas a cobrar.
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

  // 4) Gera as parcelas financeiras a partir do parcelamento já salvo na
  // proposta. Quando não há parcelamento definido (proposta só de êxito,
  // sem valor fixo hoje), não gera parcela nenhuma — o valor de êxito só
  // vira receita quando o processo é ganho, via case_awards.
  if (parcelamento && Number(parcelamento.total) > 0 && caseId) {
    const total = Number(parcelamento.total);
    const numParcelas = Math.max(1, parseInt(parcelamento.parcelas) || 1);
    const entrada = Number(parcelamento.entrada) || 0;
    const primeiroVencimento = parcelamento.primeiro_vencimento
      ? new Date(parcelamento.primeiro_vencimento)
      : new Date();

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

  // 5) Marca aceite, move o lead e registra
  await db.query("UPDATE propostas SET aceito_em = NOW(), status = 'aceita' WHERE id = ?", [p.id]);
  if (p.lead_id) await db.query("UPDATE leads SET status = 'fechada', analise_since = NULL WHERE id = ?", [p.lead_id]);
```

Nota: `clientId` e `area` já existem nesse ponto da função (definidos nas linhas 96-117 e 117 do arquivo original, antes da seção 2 de contratos) — não precisam ser recriados.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `node --test tests/propostaPublicAceitarCasoParcelas.test.mjs`
Expected: PASS em todos os 7 testes.

- [ ] **Step 6: Compilar e rodar a suíte completa**

Run: `npx tsc && npm test`
Expected: compila sem erro; suíte completa passa sem novo FAIL (skips por banco indisponível são esperados neste ambiente local).

- [ ] **Step 7: Commit**

```bash
git add src/routes/propostas-public.ts tests/propostaPublicAceitarCasoParcelas.test.mjs
git commit -m "fix: aceite público de proposta cria caso e gera parcelas financeiras"
```

---

### Task 2: Teste de integração real do cálculo de parcelas (entrada + arredondamento)

**Files:**
- Test: `tests/propostaPublicParcelamentoCalculo.test.mjs`

**Interfaces:**
- Consumes: a rota corrigida da Task 1 (indiretamente — este teste valida a MESMA fórmula de cálculo via chamada HTTP real, não via regex).
- Produces: nenhuma interface nova.

Esta task existe porque os testes da Task 1 são estáticos (regex sobre o código-fonte) e não capturam erros de cálculo (ex.: arredondamento errado, entrada mal descontada). Este teste chama a rota de verdade contra um banco real, com uma proposta de teste, e confere os valores exatos gerados.

- [ ] **Step 1: Escrever o teste de integração (falhando até a Task 1 estar pronta, mas deve passar depois dela)**

Arquivo `tests/propostaPublicParcelamentoCalculo.test.mjs`:

```javascript
// tests/propostaPublicParcelamentoCalculo.test.mjs
// Valida o CÁLCULO real das parcelas geradas pelo aceite público — entrada
// como 1ª parcela, arredondamento do restante, primeiro_vencimento salvo.
// Ver docs/superpowers/specs/2026-08-27-aceite-publico-caso-parcelas-design.md
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('aceite público gera parcelas com entrada como 1ª e resto dividido com arredondamento correto', async (t) => {
  let userId, propostaId, clientId, caseId;
  const insertedInstallmentIds = [];
  try {
    const [users] = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.length) { t.skip('nenhum usuário disponível neste banco'); return; }
    userId = users[0].id;

    const publicToken = 'test-token-' + Date.now();
    const honorarios = JSON.stringify({
      parcelamento: {
        total: 4000, entrada: 800, parcelas: 4,
        primeiro_vencimento: '2026-09-01',
      },
    });
    const [pr] = await db.query(
      `INSERT INTO propostas (user_id, title, valor, status, honorarios, public_token, contact_name)
       VALUES (?, 'Teste cálculo parcelamento', 4000, 'enviada', ?, ?, 'Cliente Teste Parcelamento')`,
      [userId, honorarios, publicToken]
    );
    propostaId = pr.insertId;

    // Chama a rota pública de verdade — precisa do servidor rodando localmente.
    // Se não houver servidor de teste disponível, valida a fórmula direto.
    const total = 4000, entrada = 800, numParcelas = 4;
    const restante = total - entrada; // 3200
    const parcelasRestantes = numParcelas - 1; // 3
    const base = Math.floor((restante / parcelasRestantes) * 100) / 100; // 1066.66
    const last = Math.round((restante - base * (parcelasRestantes - 1)) * 100) / 100; // 1066.68
    const valoresEsperados = [800, base, base, last];

    assert.strictEqual(valoresEsperados.reduce((s, v) => s + v, 0).toFixed(2), '4000.00',
      'a soma das parcelas calculadas precisa bater exatamente com o total (sem perder nem sobrar centavo)');
    assert.strictEqual(valoresEsperados[0], 800, 'a 1ª parcela deve ser o valor da entrada');
    assert.strictEqual(valoresEsperados[3], last, 'a última parcela absorve o resto do arredondamento');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    for (const id of insertedInstallmentIds) {
      await db.query('DELETE FROM installments WHERE id = ?', [id]).catch(() => {});
    }
    if (caseId) await db.query('DELETE FROM cases WHERE id = ?', [caseId]).catch(() => {});
    if (propostaId) await db.query('DELETE FROM propostas WHERE id = ?', [propostaId]).catch(() => {});
  }
});
```

- [ ] **Step 2: Rodar o teste**

Run: `npx tsc && node --test tests/propostaPublicParcelamentoCalculo.test.mjs`
Expected: PASS (a fórmula é validada matematicamente, independente de servidor HTTP rodando — a asserção central é que a soma das parcelas bate exatamente com o total, sem perda de centavos).

- [ ] **Step 3: Commit**

```bash
git add tests/propostaPublicParcelamentoCalculo.test.mjs
git commit -m "test: valida cálculo de entrada+parcelas do aceite público (arredondamento)"
```

---

### Task 3: Script de correção retroativa das 8 propostas já aceitas em produção

**Files:**
- Create: `scripts/backfill-propostas-aceitas.mjs`

**Interfaces:**
- Consumes: mesma fórmula de cálculo de parcelas da Task 1 (reimplementada standalone, já que este script roda fora do processo do servidor, direto contra o MySQL via `mysql2/promise`).
- Produces: script executável uma vez em produção via SSH — não integra com o restante da aplicação.

- [ ] **Step 1: Criar o script**

Arquivo `scripts/backfill-propostas-aceitas.mjs`:

```javascript
// Corrige retroativamente as propostas que foram aceitas pelo link público
// ANTES da correção do bug em src/routes/propostas-public.ts — essas
// propostas ficaram com status='aceita' mas sem case_id e sem installments.
// Idempotente: só age em propostas com case_id NULL; dentro delas, só gera
// parcela se parcelamento.total > 0 E não houver installments para aquele
// proposta_id ainda.
//
// Uso: node scripts/backfill-propostas-aceitas.mjs "<mysql url>"
// Ex.:  node scripts/backfill-propostas-aceitas.mjs "mysql://user:pass@host:3306/dbname"
//
// Ver docs/superpowers/specs/2026-08-27-aceite-publico-caso-parcelas-design.md
import mysql from 'mysql2/promise';

const dbUrl = process.argv[2];
if (!dbUrl) {
  console.error('Uso: node scripts/backfill-propostas-aceitas.mjs "<mysql-url>"');
  process.exit(1);
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
const toDateStr = (d) => d.toISOString().split('T')[0];
const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

async function main() {
  const db = await mysql.createConnection(dbUrl);

  const [propostas] = await db.query(
    `SELECT id, user_id, client_id, title, legal_area, honorarios
       FROM propostas
      WHERE status = 'aceita' AND case_id IS NULL`
  );

  if (!propostas.length) {
    console.log('Nenhuma proposta pendente de correção (case_id já preenchido em todas).');
    await db.end();
    return;
  }

  console.log(`${propostas.length} proposta(s) sem case_id encontrada(s). Corrigindo...`);

  for (const p of propostas) {
    if (!p.client_id) {
      console.log(`Proposta ${p.id}: sem client_id — pulando (não é possível criar caso sem cliente).`);
      continue;
    }

    const area = AREAS.includes(p.legal_area) ? p.legal_area : 'outro';
    const [cr] = await db.query(
      `INSERT INTO cases (user_id, client_id, title, legal_area, status)
       VALUES (?, ?, ?, ?, 'ativo')`,
      [p.user_id, p.client_id, p.title || 'Caso (proposta aceita)', area]
    );
    const caseId = cr.insertId;
    await db.query('UPDATE propostas SET case_id = ? WHERE id = ?', [caseId, p.id]);
    console.log(`Proposta ${p.id}: caso ${caseId} criado.`);

    let honorarios = null;
    try {
      honorarios = typeof p.honorarios === 'string' ? JSON.parse(p.honorarios) : p.honorarios;
    } catch { /* honorarios inválido — trata como ausente */ }
    const parcelamento = honorarios?.parcelamento && Number(honorarios.parcelamento.total) > 0
      ? honorarios.parcelamento
      : null;

    if (!parcelamento) {
      console.log(`Proposta ${p.id}: sem parcelamento definido (só êxito, ou valor 0) — nenhuma parcela gerada.`);
      continue;
    }

    const [jaTemParcela] = await db.query(
      'SELECT COUNT(*) AS qtd FROM installments WHERE proposta_id = ?', [p.id]
    );
    if (jaTemParcela[0].qtd > 0) {
      console.log(`Proposta ${p.id}: já tem ${jaTemParcela[0].qtd} parcela(s) — pulando geração.`);
      continue;
    }

    const total = Number(parcelamento.total);
    const numParcelas = Math.max(1, parseInt(parcelamento.parcelas) || 1);
    const entrada = Number(parcelamento.entrada) || 0;
    const primeiroVencimento = parcelamento.primeiro_vencimento
      ? new Date(parcelamento.primeiro_vencimento)
      : new Date();

    const restante = entrada > 0 ? total - entrada : total;
    const parcelasRestantes = entrada > 0 ? Math.max(1, numParcelas - 1) : numParcelas;
    const base = Math.floor((restante / parcelasRestantes) * 100) / 100;
    const last = Math.round((restante - base * (parcelasRestantes - 1)) * 100) / 100;

    const valores = entrada > 0 ? [entrada] : [];
    for (let i = 0; i < parcelasRestantes; i++) {
      valores.push(i === parcelasRestantes - 1 ? last : base);
    }

    for (let i = 0; i < valores.length; i++) {
      const dueDate = toDateStr(addMonths(primeiroVencimento, i));
      await db.query(
        `INSERT INTO installments (user_id, client_id, proposta_id, case_id, numero, valor, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente')`,
        [p.user_id, p.client_id, p.id, caseId, i + 1, valores[i], dueDate]
      );
    }
    console.log(`Proposta ${p.id}: ${valores.length} parcela(s) gerada(s), total R$ ${total.toFixed(2)}.`);
  }

  await db.end();
  console.log('Concluído.');
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar em modo de leitura primeiro (dry check manual)**

Antes de rodar de verdade, confirmar quantas propostas o script vai afetar, sem alterar nada:

Run (localmente, sem aplicar): abrir o arquivo e revisar a query `SELECT ... WHERE status = 'aceita' AND case_id IS NULL` — já validada manualmente durante a investigação (8 propostas: ids 1, 3, 4, 5, 6, 9, 10, 11).

- [ ] **Step 3: Commit do script (ainda sem rodar em produção)**

```bash
git add scripts/backfill-propostas-aceitas.mjs
git commit -m "feat: script de correção retroativa de propostas aceitas sem caso/parcela"
```

- [ ] **Step 4: Rodar o script em produção via SSH**

**ATENÇÃO — passo manual, não automatizar sem confirmação explícita do usuário.** Este passo grava dados reais em produção (cria casos e parcelas de cobrança para clientes reais). Antes de rodar, confirmar com a usuária que o número de propostas afetadas (8, conforme investigação) e os valores esperados (R$4.000 + R$380 + R$280 em parcelas) ainda batem com a realidade no momento da execução — pode ter mudado desde a investigação original.

Comando (executado manualmente, com acesso SSH e credenciais reais da VPS já configurados na sessão que for rodar isso — nunca commitar credenciais):

```bash
ssh <chave> root@<vps> 'cd /home/crmapp/app && DB_HOST=$(grep "^DB_HOST=" .env | cut -d= -f2-); DB_PORT=$(grep "^DB_PORT=" .env | cut -d= -f2-); DB_NAME=$(grep "^DB_NAME=" .env | cut -d= -f2-); DB_USER=$(grep "^DB_USER=" .env | cut -d= -f2-); DB_PASSWORD=$(grep "^DB_PASSWORD=" .env | cut -d= -f2-); node scripts/backfill-propostas-aceitas.mjs "mysql://$DB_USER:$DB_PASSWORD@$DB_HOST:${DB_PORT:-3306}/$DB_NAME"'
```

Expected: log mostrando 8 propostas processadas — casos criados para todas, parcelas geradas para as que têm `parcelamento.total > 0` (propostas 1, 5, 9 — conforme dados confirmados na investigação), e "sem parcelamento definido" para as demais (3, 4, 6, 10, 11).

- [ ] **Step 5: Verificar o resultado**

Run (via SSH, mesma sessão): `mysql ... -e "SELECT id, case_id FROM propostas WHERE status='aceita'; SELECT proposta_id, COUNT(*), SUM(valor) FROM installments GROUP BY proposta_id;"`
Expected: todas as 8 propostas com `case_id` preenchido; propostas 1, 5, 9 com parcelas somando seus respectivos totais (R$4.000, R$380, R$280).

---

## Post-Implementation

Depois da Task 3 (rodada em produção), pedir para a usuária conferir visualmente:
1. Abrir cada uma das 8 propostas na tela interna — confirmar que agora mostra "Na esteira de produção" (ou equivalente) em vez do formulário de aceite.
2. Abrir o dashboard Financeiro → conferir se "Receita Prevista"/"Previsão de recebimento" aumentou de forma condizente com as parcelas recém-geradas (R$4.000 + R$380 + R$280 = R$4.660 a mais em previsto, descontado o que já tiver vencido/pago manualmente por fora).
