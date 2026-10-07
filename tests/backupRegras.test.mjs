// tests/backupRegras.test.mjs — retenção (30 diários + 12 mensais), backups perdidos e relatório diário
import { test } from 'node:test';
import assert from 'node:assert';
import { planoRetencao, slotsPerdidos, dataDoArquivo, textoRelatorioDiario } from '../dist/services/backupRegras.js';

const nome = (iso) => `crm-backup-${iso.replace(/:/g, '-').slice(0, 19)}.sql.gz.enc`;
// horários reais dos backups em UTC: 05h, 12h e 22h (= 02h, 09h e 19h em Brasília)
function serie(dias, fim = '2026-10-07') {
  const out = []; const f = new Date(fim + 'T00:00:00Z');
  for (let d = 0; d < dias; d++) {
    const dia = new Date(f.getTime() - d * 86400000).toISOString().slice(0, 10);
    for (const h of ['05', '12', '22']) out.push(nome(`${dia}T${h}:00:00`));
  }
  return out;
}

test('dataDoArquivo lê o carimbo do nome (UTC)', () => {
  assert.strictEqual(dataDoArquivo('crm-backup-2026-10-07T12-00-00.sql.gz.enc').toISOString(), '2026-10-07T12:00:00.000Z');
  assert.strictEqual(dataDoArquivo('outro-arquivo.txt'), null);
});

test('retenção: últimos 3 dias inteiros, 1 por dia até 30 dias, 1 por mês até 12 meses', () => {
  const agora = new Date('2026-10-07T23:00:00Z');
  const { manter, apagar } = planoRetencao(serie(400), agora);
  // 3 dias inteiros (hoje, 06, 05) = 9 arquivos
  for (const d of ['2026-10-07', '2026-10-06', '2026-10-05'])
    assert.strictEqual(manter.filter((n) => n.includes(d)).length, 3, d);
  // dia 20/09 (dentro dos 30 dias): só 1 arquivo, o último do dia em Brasília (22h UTC = 19h)
  assert.deepStrictEqual(manter.filter((n) => n.includes('2026-09-20')), [nome('2026-09-20T22:00:00')]);
  // meses antigos: 1 por mês
  assert.strictEqual(manter.filter((n) => n.includes('2026-03-')).length, 1);
  assert.strictEqual(manter.filter((n) => n.includes('2025-11-')).length, 1);
  // mais de 12 meses: nada
  assert.strictEqual(manter.filter((n) => n.includes('2025-09-')).length, 0);
  assert.strictEqual(manter.length + apagar.length, 1200);
  assert.ok(manter.length <= 9 + 27 + 12, `mantém ${manter.length}`);
});

test('retenção: o dia é contado no horário de Brasília (22h UTC do dia 4 = 19h do dia 4)', () => {
  const agora = new Date('2026-10-07T23:00:00Z');
  const arquivos = [nome('2026-09-20T05:00:00'), nome('2026-09-20T12:00:00'), nome('2026-09-21T02:00:00')];
  // 21/09 02h UTC = 20/09 23h em Brasília → é o último do dia 20
  assert.deepStrictEqual(planoRetencao(arquivos, agora).manter, [nome('2026-09-21T02:00:00')]);
});

test('retenção: nunca apaga tudo — sempre mantém ao menos o mais recente', () => {
  const agora = new Date('2028-01-01T00:00:00Z');
  const { manter } = planoRetencao([nome('2026-10-07T12:00:00')], agora);
  assert.strictEqual(manter.length, 1);
});

test('retenção: arquivos que não são backup ficam fora (nem mantém nem apaga)', () => {
  const r = planoRetencao(['leia-me.txt', nome('2026-10-07T12:00:00')], new Date('2026-10-07T23:00:00Z'));
  assert.deepStrictEqual(r.apagar, []);
  assert.deepStrictEqual(r.manter, [nome('2026-10-07T12:00:00')]);
});

test('slotsPerdidos: horário passou da tolerância sem backup ok → perdido', () => {
  // 07/10, 13:00 UTC (10h Brasília). Backup das 02h ok (05:03 UTC); o das 09h não veio.
  const oks = [new Date('2026-10-07T05:03:00Z')];
  assert.deepStrictEqual(slotsPerdidos(new Date('2026-10-07T13:00:00Z'), oks, 40), [9]);
  // às 12:20 UTC (09h20) ainda está dentro da tolerância de 40 min
  assert.deepStrictEqual(slotsPerdidos(new Date('2026-10-07T12:20:00Z'), oks, 40), []);
  // com o das 09h ok, nada perdido
  assert.deepStrictEqual(slotsPerdidos(new Date('2026-10-07T13:00:00Z'), [...oks, new Date('2026-10-07T12:04:00Z')], 40), []);
});

test('slotsPerdidos: backup feito por nova tentativa (fora do minuto exato) conta', () => {
  const oks = [new Date('2026-10-07T05:03:00Z'), new Date('2026-10-07T12:47:00Z')];
  assert.deepStrictEqual(slotsPerdidos(new Date('2026-10-07T23:30:00Z'), oks, 40), [19]);
});

test('textoRelatorioDiario: tudo certo', () => {
  const t = textoRelatorioDiario({
    dia: '07/10/2026', esperados: [2, 9, 19],
    feitos: [{ hora: 2, mega: true, local: true, verificado: true, mb: 270 }, { hora: 9, mega: true, local: true, verificado: true, mb: 271 }, { hora: 19, mega: true, local: true, verificado: true, mb: 272 }],
    copiasMega: 48, maisAntigaMega: '15/10/2025', megaUsoPct: 62, ultimaProva: { data: '01/10/2026', ok: true },
  });
  assert.match(t, /✅/);
  assert.match(t, /3 de 3/);
  assert.match(t, /48 cópias/);
  assert.doesNotMatch(t, /⚠️/);
});

test('textoRelatorioDiario: falta um horário e o MEGA está cheio → alerta', () => {
  const t = textoRelatorioDiario({
    dia: '07/10/2026', esperados: [2, 9, 19],
    feitos: [{ hora: 2, mega: true, local: true, verificado: true, mb: 270 }, { hora: 19, mega: false, local: true, verificado: true, mb: 272 }],
    copiasMega: 40, maisAntigaMega: '15/10/2025', megaUsoPct: 91, ultimaProva: { data: '01/10/2026', ok: true },
  });
  assert.match(t, /⚠️/);
  assert.match(t, /1 de 3/); // 19h foi feito, mas sem o MEGA não conta como completo
  assert.match(t, /09h/);
  assert.match(t, /MEGA/);
  assert.match(t, /91%/);
});
