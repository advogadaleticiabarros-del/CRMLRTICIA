import { db } from '../config/database';
import { encrypt, isEncrypted, podeDecifrar, chaveLegada, decryptComChave } from '../utils/crypto';

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

export interface ResultadoCifragem {
  cifrados: number;      // estavam em texto puro → agora cifrados
  jaCifrados: number;    // já estavam cifrados e legíveis
  recifrados: number;    // estavam com a CHAVE ANTIGA → migrados para a nova
  ilegiveis: number;     // não abrem com nenhuma chave → precisa reconectar a conta
  erros: string[];
}

/**
 * Garante que todo token esteja cifrado E LEGÍVEL com a chave ATUAL.
 *
 * Trata três casos, e o terceiro é o que salva a pele:
 *   1. texto puro          → cifra
 *   2. cifrado e legível   → não mexe
 *   3. cifrado com a CHAVE ANTIGA (derivada do JWT_SECRET, usada antes de existir
 *      a ENCRYPTION_KEY) → decifra com a antiga e RE-CIFRA com a nova.
 *
 * Sem o caso 3, definir a ENCRYPTION_KEY depois de o sistema já ter rodado
 * QUEBRARIA Gmail, Drive e Agenda — os tokens ficariam ilegíveis e seria preciso
 * reconectar tudo na mão. Aqui o sistema se cura sozinho, no boot.
 */
export async function cifrarTokensEmRepouso(): Promise<ResultadoCifragem> {
  let cifrados = 0, jaCifrados = 0, recifrados = 0, ilegiveis = 0;
  const erros: string[] = [];
  const legada = chaveLegada();

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

          // 1. Texto puro → cifra
          if (!isEncrypted(v)) {
            sets.push(`${c} = ?`);
            params.push(encrypt(String(v)));
            cifrados++;
            continue;
          }

          // 2. Cifrado e legível com a chave atual → nada a fazer
          if (podeDecifrar(String(v))) { jaCifrados++; continue; }

          // 3. Cifrado, mas NÃO abre com a chave atual → tenta a chave LEGADA
          const claro = legada ? decryptComChave(String(v), legada) : null;
          if (claro !== null) {
            sets.push(`${c} = ?`);
            params.push(encrypt(claro));   // re-cifra com a chave NOVA
            recifrados++;
          } else {
            // Não abre com nenhuma chave — só reconectando a conta.
            ilegiveis++;
          }
        }

        if (!sets.length) continue;
        params.push(r[a.chave]);
        await db.query(`UPDATE ${a.tabela} SET ${sets.join(', ')} WHERE ${a.chave} = ?`, params);
      }
    } catch (e: any) {
      // Tabela pode não existir (migration ainda não rodou) — não derruba o boot.
      erros.push(`${a.tabela}: ${e?.message || e}`);
    }
  }

  return { cifrados, jaCifrados, recifrados, ilegiveis, erros };
}
