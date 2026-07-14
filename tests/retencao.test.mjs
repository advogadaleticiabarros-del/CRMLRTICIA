import { test } from 'node:test';
import assert from 'node:assert/strict';

const { POLITICAS, INTOCADAS } = await import('../dist/services/retentionService.js');

// A garantia mais importante deste sistema: o expurgo NUNCA pode apagar algo que
// o escritório tem dever de guardar, ou que possa ser PROVA num processo.
test('NENHUMA política toca em tabela protegida (dever de guarda / prova)', () => {
  for (const p of POLITICAS) {
    assert.ok(
      !INTOCADAS.includes(p.tabela),
      `A política "${p.nome}" mexe em "${p.tabela}", que é PROTEGIDA. Isso apagaria prova de cliente.`
    );
  }
});

test('nenhum SQL menciona as tabelas protegidas (nem em JOIN ou subquery)', () => {
  for (const p of POLITICAS) {
    const sql = (p.contar + ' ' + p.executar).toLowerCase();
    for (const t of INTOCADAS) {
      // procura a tabela como palavra inteira (evita falso positivo em 'clients' vs 'client_id')
      const re = new RegExp(`(from|join|update|into)\\s+${t}\\b`);
      assert.ok(!re.test(sql), `"${p.nome}" referencia a tabela protegida "${t}" no SQL.`);
    }
  }
});

test('todo DELETE/UPDATE tem cláusula WHERE (nunca varre a tabela inteira)', () => {
  for (const p of POLITICAS) {
    assert.match(p.executar.toLowerCase(), /\bwhere\b/,
      `"${p.nome}" não tem WHERE — apagaria a tabela inteira!`);
  }
});

test('todo expurgo tem recorte de TEMPO (nada é apagado imediatamente)', () => {
  for (const p of POLITICAS) {
    assert.match(p.executar.toLowerCase(), /interval\s+\d+\s+day/,
      `"${p.nome}" não tem recorte de tempo.`);
  }
});

test('lead perdido é ANONIMIZADO, não apagado (mantém a estatística)', () => {
  const lead = POLITICAS.find((p) => p.tabela === 'leads');
  assert.ok(lead, 'deve existir política para leads');
  assert.equal(lead.acao, 'anonimizado');
  assert.match(lead.executar.toLowerCase(), /^\s*update/, 'deve ser UPDATE, nunca DELETE');
  assert.match(lead.executar, /name\s*=\s*'\[anonimizado\]'/);
});

test('mídia do WhatsApp: só apaga a ÓRFÃ (sem cliente) — a de cliente pode ser prova', () => {
  const midia = POLITICAS.find((p) => p.tabela === 'whatsapp_media');
  assert.ok(midia, 'deve existir política para whatsapp_media');
  assert.match(midia.executar.toLowerCase(), /client_id is null/,
    'sem esta trava, apagaria a foto da CTPS/laudo do cliente');
});

test('e-mail de parceria: só apaga o DESCARTADO (o confirmado virou caso)', () => {
  const em = POLITICAS.find((p) => p.tabela === 'email_imports');
  assert.ok(em, 'deve existir política para email_imports');
  assert.match(em.executar.toLowerCase(), /status\s*=\s*'descartado'/,
    'sem esta trava, apagaria o e-mail que originou um caso ativo');
});

test('cada política explica POR QUE é segura (auditoria/LGPD)', () => {
  for (const p of POLITICAS) {
    assert.ok(p.porque && p.porque.length > 30, `"${p.nome}" precisa justificar o expurgo.`);
    assert.ok(p.criterio && p.criterio.length > 5, `"${p.nome}" precisa declarar o critério.`);
  }
});
