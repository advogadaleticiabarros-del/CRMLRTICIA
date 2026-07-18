// Testes da contagem de prazos em dias úteis (CPC 219/220/224).
// Datas conferidas manualmente no calendário de 2026.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Compila só o utilitário se o dist ainda não existir (CI/local)
if (!existsSync(new URL('../dist/utils/prazoUtil.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { contarPrazo, feriadosDoAno, ehDiaUtil } = await import('../dist/utils/prazoUtil.js');

test('Páscoa 2026 correta → Sexta-feira Santa em 03/04/2026', () => {
  const f = feriadosDoAno(2026);
  assert.ok(f.get('2026-04-03')?.includes('Sexta-feira Santa'));
});

test('Carnaval 2026: segunda 16/02 e terça 17/02', () => {
  const f = feriadosDoAno(2026);
  assert.ok(f.get('2026-02-16')?.includes('Carnaval'));
  assert.ok(f.get('2026-02-17')?.includes('Carnaval'));
});

test('Corpus Christi 2026 em 04/06', () => {
  assert.ok(feriadosDoAno(2026).get('2026-06-04')?.includes('Corpus'));
});

test('sábado e domingo não são úteis; dia comum é', () => {
  assert.equal(ehDiaUtil('2026-07-18').util, false); // sábado
  assert.equal(ehDiaUtil('2026-07-19').util, false); // domingo
  assert.equal(ehDiaUtil('2026-07-16').util, true);  // quinta comum
});

test('15 dias úteis a partir de 01/06/2026 pula Corpus Christi → 23/06/2026', () => {
  const r = contarPrazo('2026-06-01', 15);
  assert.equal(r.vencimento, '2026-06-23');
});

test('publicação dentro da suspensão (CPC 220): conta a partir de 21/01 → 15 úteis = 10/02/2026', () => {
  const r = contarPrazo('2026-01-10', 15, { suspensaoFimAno: true });
  assert.equal(r.vencimento, '2026-02-10');
});

test('sem a suspensão de fim de ano o prazo de 10/01 vence antes', () => {
  const com = contarPrazo('2026-01-10', 15, { suspensaoFimAno: true });
  const sem = contarPrazo('2026-01-10', 15, { suspensaoFimAno: false });
  assert.ok(sem.vencimento < com.vencimento);
});

test('vencimento nunca cai em dia não útil (contagem útil)', () => {
  for (const inicio of ['2026-02-10', '2026-03-30', '2026-08-05', '2026-12-15']) {
    const r = contarPrazo(inicio, 15);
    assert.equal(ehDiaUtil(r.vencimento).util, true, `venceu em dia não útil: ${r.vencimento}`);
  }
});

test('dias corridos: vencimento em domingo prorroga para segunda', () => {
  // 10 corridos de 09/07/2026 (qui) → 19/07 domingo → prorroga p/ 20/07 segunda
  const r = contarPrazo('2026-07-09', 10, { uteis: false, suspensaoFimAno: false });
  assert.equal(r.vencimento, '2026-07-20');
});
