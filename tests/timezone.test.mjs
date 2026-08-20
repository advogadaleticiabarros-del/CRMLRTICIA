// tests/timezone.test.mjs — conversão de horário local (Brasília) → UTC para gravar no MySQL.
//
// Bug real: POST /api/calendar/events gravava start_datetime/end_datetime DIRETO
// do body (ex.: "2026-08-25T14:00", vindo de um <input type="datetime-local">,
// hora de Brasília, sem timezone) sem converter pra UTC. Como a conexão MySQL usa
// timezone: 'Z' (src/config/database.ts), "14:00" digitado era gravado como
// "14:00 UTC" — e ao formatar de volta em America/Sao_Paulo aparecia 11:00,
// 3h a menos do que a usuária digitou. O mesmo bug existia em
// automationService.ts (linha do prazo agendado na agenda, usando "09:00:00"
// literal como se já fosse UTC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

if (!existsSync(new URL('../dist/utils/timezone.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { localParaUtcMysql } = await import('../dist/utils/timezone.js');

const raiz = path.resolve('.');

// Prova de que o INSERT em POST /api/calendar/events realmente converte
// start_datetime/end_datetime antes de gravar (e não manda o valor cru do
// body direto pro banco, que era o bug original).
test('rota POST /api/calendar/events converte start_datetime/end_datetime antes do INSERT', () => {
  const src = readFileSync(path.join(raiz, 'src/routes/calendar.ts'), 'utf8');
  const insertBlock = src.slice(src.indexOf("router.post('/events'"), src.indexOf("const eventId = result.insertId"));
  assert.match(insertBlock, /localParaUtcMysql\(\s*start_datetime\s*\)/,
    'INSERT de calendar_events deve gravar start_datetime já convertido pra UTC');
  assert.match(insertBlock, /localParaUtcMysql\(\s*end_datetime\s*\)/,
    'INSERT de calendar_events deve gravar end_datetime já convertido pra UTC');
});

// Prova de que o lembrete automático de prazo (automationService) também
// converte o horário local (09:00 Brasília) antes de gravar, em vez do
// literal "09:00:00" que era tratado como se já fosse UTC.
test('automationService: evento de prazo na agenda converte 09:00 Brasília pra UTC', () => {
  const src = readFileSync(path.join(raiz, 'src/services/automationService.ts'), 'utf8');
  assert.doesNotMatch(src, /const inicio = `\$\{ctx\.dueDate\} 09:00:00`;/,
    'literal "09:00:00" gravado direto é o bug: é tratado como UTC pela conexão (timezone: "Z")');
  assert.match(src, /localParaUtcMysql\(`\$\{ctx\.dueDate\}T09:00`\)/,
    'deve converter 09:00 Brasília pra UTC antes de gravar em calendar_events.start_datetime');
});

// Simula o que o navegador formata de volta ao ler um DATETIME do banco
// (o banco guarda em UTC — conexão com timezone: 'Z' — e o front formata em
// America/Sao_Paulo, que não observa horário de verão desde 2019: UTC-3 fixo).
function formatarComoBrasilia(mysqlDatetimeUtc) {
  // mysqlDatetimeUtc no formato "YYYY-MM-DD HH:mm:ss", tratado como UTC.
  const d = new Date(mysqlDatetimeUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

test('14:00 digitado (datetime-local) vira 17:00 em UTC no banco', () => {
  const gravado = localParaUtcMysql('2026-08-25T14:00');
  assert.equal(gravado, '2026-08-25 17:00:00');
});

test('round-trip: o que a usuária digita (14:00) é o que ela vê de volta (14:00), não 11:00', () => {
  const gravado = localParaUtcMysql('2026-08-25T14:00');
  const exibido = formatarComoBrasilia(gravado);
  assert.equal(exibido, '14:00', `esperado 14:00, obtido ${exibido} (bug: gravar sem converter dá 11:00)`);
});

test('09:00 do lembrete automático de prazo também bate (regressão do automationService)', () => {
  const gravado = localParaUtcMysql('2026-09-01T09:00');
  assert.equal(gravado, '2026-09-01 12:00:00'); // 09:00 Brasília = 12:00 UTC
  assert.equal(formatarComoBrasilia(gravado), '09:00');
});
