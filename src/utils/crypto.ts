import crypto from 'crypto';

/**
 * Cifragem de dados sensíveis EM REPOUSO (LGPD).
 *
 * PROBLEMA QUE RESOLVE: os tokens de OAuth (Gmail, Drive, Agenda, WhatsApp)
 * estavam em TEXTO PURO no banco. Um vazamento do banco — dump, backup exposto,
 * brecha no provedor — daria a quem o obtivesse acesso à conta Google inteira do
 * escritório: e-mails de clientes, laudos médicos, CPF, procurações. Dado
 * sensível de saúde é a categoria mais protegida pela LGPD (art. 11).
 *
 * Cifrar em repouso não protege contra o servidor comprometido (a chave está
 * nele), mas protege contra o cenário REALISTA: o banco ou o backup vazarem
 * sozinhos. Sem a chave, os tokens viram lixo.
 *
 * Algoritmo: AES-256-GCM (cifra + autentica — detecta adulteração).
 * Formato:   enc:v1:<iv-b64>:<tag-b64>:<cifra-b64>
 *
 * COMPATIBILIDADE: `decrypt` devolve o valor intacto se ele NÃO estiver cifrado.
 * Assim o sistema continua funcionando com os tokens antigos (texto puro) e vai
 * cifrando conforme eles são regravados. Nada quebra no deploy.
 */

const PREFIXO = 'enc:v1:';

let chaveCache: Buffer | null | undefined;

/** Deriva a chave de 32 bytes de ENCRYPTION_KEY (ou, na falta, do JWT_SECRET). */
function chave(): Buffer | null {
  if (chaveCache !== undefined) return chaveCache;

  const bruta = process.env.ENCRYPTION_KEY || '';
  if (bruta) {
    // aceita hex (64 chars), base64 ou texto — sempre normaliza para 32 bytes
    let b: Buffer;
    if (/^[0-9a-f]{64}$/i.test(bruta)) b = Buffer.from(bruta, 'hex');
    else b = crypto.createHash('sha256').update(bruta).digest();
    chaveCache = b;
    return chaveCache;
  }

  // Sem ENCRYPTION_KEY: deriva do JWT_SECRET para já proteger o banco hoje.
  // Não é o ideal (rotacionar o JWT_SECRET invalidaria os tokens cifrados),
  // por isso avisamos alto e claro.
  const jwt = process.env.JWT_SECRET;
  if (jwt) {
    console.warn(
      '⚠️  [crypto] ENCRYPTION_KEY não definida — derivando do JWT_SECRET.\n' +
      '    Defina ENCRYPTION_KEY (32 bytes) no Railway e NUNCA a perca:\n' +
      '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    chaveCache = crypto.createHash('sha256').update('crm-enc:' + jwt).digest();
    return chaveCache;
  }

  console.error('❌ [crypto] Sem ENCRYPTION_KEY nem JWT_SECRET — dados sensíveis NÃO serão cifrados.');
  chaveCache = null;
  return null;
}

/** Já está cifrado? */
export function isEncrypted(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(PREFIXO);
}

/** Cifra um valor. Devolve null/'' inalterados. Idempotente (não cifra 2x). */
export function encrypt(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return (valor ?? null) as null;
  if (isEncrypted(valor)) return valor; // não cifra de novo
  const k = chave();
  if (!k) return valor; // sem chave: melhor funcionar do que travar o CRM

  const iv = crypto.randomBytes(12); // GCM: 96 bits
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const cifra = Buffer.concat([c.update(String(valor), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIXO + iv.toString('base64') + ':' + tag.toString('base64') + ':' + cifra.toString('base64');
}

/** Decifra. Se o valor NÃO estiver cifrado, devolve como está (retrocompatível). */
export function decrypt(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return (valor ?? null) as null;
  if (!isEncrypted(valor)) return String(valor); // token antigo, em texto puro
  const k = chave();
  if (!k) {
    console.error('❌ [crypto] Valor cifrado, mas sem chave para decifrar.');
    return null;
  }
  try {
    const [, , ivB64, tagB64, cifraB64] = String(valor).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(cifraB64, 'base64')), d.final()]).toString('utf8');
  } catch (e: any) {
    // Chave trocada ou dado adulterado — não derruba o app, mas grita.
    console.error('❌ [crypto] Falha ao decifrar (chave errada ou dado corrompido):', e?.message);
    return null;
  }
}

// ── Arquivos binários (backup) ──────────────────────────────────────────────
// O dump do banco contém TUDO: CPF, laudos médicos, conversas do WhatsApp.
// Ele sobe para o MEGA — e quem tiver as credenciais do MEGA baixaria o dump em
// claro. Cifrar o arquivo antes do upload faz o backup vazado virar lixo.
//
// Formato: [ CRMENC1\0 (8B) | iv (12B) | tag (16B) | cifra ]
const MAGIC = Buffer.from('CRMENC1\0', 'utf8');

/** O buffer está cifrado por nós? */
export function isEncryptedBuffer(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Cifra um arquivo/buffer. Sem chave, devolve o original (não trava o backup). */
export function encryptBuffer(buf: Buffer): Buffer {
  const k = chave();
  if (!k) {
    console.warn('⚠️  [crypto] Backup será enviado SEM cifragem (sem chave definida).');
    return buf;
  }
  if (isEncryptedBuffer(buf)) return buf;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const cifra = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), cifra]);
}

/**
 * Decifra um arquivo/buffer. Se NÃO estiver cifrado (backups antigos, feitos
 * antes desta mudança), devolve o buffer intacto — a restauração segue funcionando.
 */
export function decryptBuffer(buf: Buffer): Buffer {
  if (!isEncryptedBuffer(buf)) return buf; // backup antigo, em claro
  const k = chave();
  if (!k) throw new Error('Backup cifrado, mas ENCRYPTION_KEY não está definida — impossível restaurar.');
  const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const cifra = buf.subarray(MAGIC.length + 28);
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(cifra), d.final()]);
}

/** Cifra os campos indicados de um objeto (para INSERT/UPDATE). */
export function encryptFields<T extends Record<string, any>>(obj: T, campos: (keyof T)[]): T {
  const out: any = { ...obj };
  for (const c of campos) if (out[c] != null) out[c] = encrypt(String(out[c]));
  return out;
}

/** Decifra os campos indicados de uma linha do banco (para leitura). */
export function decryptFields<T extends Record<string, any>>(row: T | null, campos: (keyof T)[]): T | null {
  if (!row) return row;
  const out: any = { ...row };
  for (const c of campos) if (out[c] != null) out[c] = decrypt(String(out[c]));
  return out;
}
