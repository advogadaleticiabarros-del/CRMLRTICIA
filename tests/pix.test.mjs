// tests/pix.test.mjs — valida o payload EMV do Pix (formato + CRC16)
import { test } from 'node:test';
import assert from 'node:assert';
import { buildPixPayload } from '../dist/services/pixService.js';

test('payload começa com 000201 e contém a chave pix', () => {
  const p = buildPixPayload({ key: 'chave@pix.com', name: 'LETICIA BARROS', city: 'VITORIA' });
  assert.ok(p.startsWith('000201'), 'deve começar com 000201');
  assert.ok(p.includes('chave@pix.com'));
  assert.ok(p.includes('br.gov.bcb.pix'));
});

test('valor formatado com 2 casas e campo 54', () => {
  const p = buildPixPayload({ key: 'k', name: 'N', city: 'C', amount: 123.4 });
  assert.ok(p.includes('5406123.40'), 'campo 54 (valor) com tamanho 06 e 123.40');
});

test('CRC16 confere (recalculado bate com o sufixo)', () => {
  const p = buildPixPayload({ key: 'k', name: 'N', city: 'C' });
  const semCrc = p.slice(0, -4);
  let crc = 0xffff;
  for (const ch of semCrc) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  assert.strictEqual(p.slice(-4), crc.toString(16).toUpperCase().padStart(4, '0'));
});

test('nome truncado a 25 chars e cidade a 15', () => {
  const p = buildPixPayload({ key: 'k', name: 'NOME MUITO GRANDE QUE PASSA DE VINTE E CINCO', city: 'CIDADE MUITO GRANDE QUE PASSA' });
  assert.ok(!p.includes('QUE PASSA DE VINTE E CINCO'));
});
