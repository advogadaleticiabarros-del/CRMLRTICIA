import { db } from '../config/database';
import { encrypt, isEncrypted } from '../utils/crypto';

/**
 * Cifra, EM REPOUSO, os tokens de OAuth que ainda estão em texto puro no banco.
 *
 * Roda sozinho no boot. É idempotente e barato: se já está tudo cifrado, faz
 * três SELECTs e sai. Rodar automaticamente evita pedir à advogada que execute
 * um script contra o banco de produção — passo arriscado e desnecessário.
 *
 * O sistema funciona com ou sem isto (a leitura é retrocompatível), mas o RISCO
 * só fecha de verdade quando não sobra nenhum token em claro no banco.
 */

const ALVOS: { tabela: string; chave: string; campos: string[] }[] = [
  { tabela: 'google_accounts',   chave: 'user_id', campos: ['access_token', 'refresh_token'] },
  { tabela: 'email_integration', chave: 'id',      campos: ['access_token', 'refresh_token'] },
  { tabela: 'whatsapp_settings', chave: 'user_id', campos: ['access_token'] },
];

export interface ResultadoCifragem { cifrados: number; jaCifrados: number; erros: string[] }

export async function cifrarTokensEmRepouso(): Promise<ResultadoCifragem> {
  let cifrados = 0, jaCifrados = 0;
  const erros: string[] = [];

  for (const a of ALVOS) {
    try {
      const [rows] = await db.query(
        `SELECT ${a.chave}, ${a.campos.join(', ')} FROM ${a.tabela}`
      ) as any;

      for (const r of rows) {
        const sets: string[] = []; const params: any[] = [];
        for (const c of a.campos) {
          const v = r[c];
          if (v == null || v === '') continue;
          if (isEncrypted(v)) { jaCifrados++; continue; }
          sets.push(`${c} = ?`);
          params.push(encrypt(String(v)));
        }
        if (!sets.length) continue;
        params.push(r[a.chave]);
        await db.query(`UPDATE ${a.tabela} SET ${sets.join(', ')} WHERE ${a.chave} = ?`, params);
        cifrados++;
      }
    } catch (e: any) {
      // Tabela pode não existir (migration ainda não rodou) — não derruba o boot.
      erros.push(`${a.tabela}: ${e?.message || e}`);
    }
  }

  return { cifrados, jaCifrados, erros };
}
