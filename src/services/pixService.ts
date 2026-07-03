import QRCode from 'qrcode';

/**
 * Pix "copia e cola" (BR Code EMV estático) do escritório — sem gateway.
 * Referência: Manual de Padrões para Iniciação do Pix (BACEN), formato EMV QRCPS-MPM.
 */

/** Campo EMV: id + tamanho (2 dígitos) + valor. */
function emv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC16-CCITT (init 0xFFFF, polinômio 0x1021) exigido pelo BR Code (campo 63). */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (const ch of payload) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos/caracteres fora do ASCII imprimível (exigência do payload). */
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();

/** Monta o payload Pix copia-e-cola (estático). `amount` opcional trava o valor. */
export function buildPixPayload(opts: { key: string; name: string; city: string; amount?: number; txid?: string }): string {
  const name = ascii(opts.name).slice(0, 25) || 'RECEBEDOR';
  const city = ascii(opts.city).slice(0, 15) || 'BRASIL';
  const mai = emv('00', 'br.gov.bcb.pix') + emv('01', opts.key.trim());
  let p = emv('00', '01') + emv('26', mai) + emv('52', '0000') + emv('53', '986');
  if (opts.amount && opts.amount > 0) p += emv('54', opts.amount.toFixed(2));
  p += emv('58', 'BR') + emv('59', name) + emv('60', city);
  p += emv('62', emv('05', (opts.txid || '***').slice(0, 25)));
  p += '6304';
  return p + crc16(p);
}

/** Gera o QR do payload como PNG data-URI (para <img src=...> no portal). */
export async function pixQrDataUri(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { margin: 1, width: 280 });
}
