/**
 * Código do autenticador (TOTP, RFC 6238: HMAC-SHA1, 6 dígitos, 30 s) — 18/11/2026.
 *
 * O login nacional do PJe (TRT17) pede o código do aplicativo autenticador. A
 * Dra. escolheu deixar o CRM gerar o código sozinho: ela cadastra a "chave"
 * do autenticador (a mesma do QR code), guardada criptografada como a senha.
 * Risco aceito por ela: o CRM passa a ter a senha e o segundo fator.
 */
import { createHmac } from 'crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizarChaveTotp(chave: string): string {
  return String(chave || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
}

export function chaveTotpValida(chave: string): boolean {
  const c = normalizarChaveTotp(chave);
  return c.length >= 16 && [...c].every((ch) => ALFABETO.includes(ch));
}

function base32(chave: string): Buffer {
  let bits = '';
  for (const ch of normalizarChaveTotp(chave)) {
    const v = ALFABETO.indexOf(ch);
    if (v < 0) throw new Error('Chave do autenticador inválida.');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Código de 6 dígitos no instante `agoraMs`. */
export function codigoTotp(chave: string, agoraMs: number = Date.now()): string {
  const contador = Math.floor(agoraMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac('sha1', base32(chave)).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
