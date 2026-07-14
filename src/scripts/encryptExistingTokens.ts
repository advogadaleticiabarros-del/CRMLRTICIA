import { db, closeDatabase } from '../config/database';
import { encrypt, isEncrypted } from '../utils/crypto';

/**
 * Cifra os tokens de OAuth que já estão no banco EM TEXTO PURO.
 *
 * O sistema é retrocompatível (lê token puro e cifrado), então rodar isto não é
 * obrigatório para funcionar — mas é obrigatório para FECHAR o risco: enquanto
 * houver token puro no banco, um vazamento ainda entrega acesso ao Gmail/Drive.
 *
 * Idempotente: pode rodar quantas vezes quiser (não cifra o que já está cifrado).
 * Uso:  npx tsx src/scripts/encryptExistingTokens.ts
 */

type Alvo = { tabela: string; chave: string; campos: string[] };

const ALVOS: Alvo[] = [
  { tabela: 'google_accounts',    chave: 'user_id', campos: ['access_token', 'refresh_token'] },
  { tabela: 'email_integration',  chave: 'id',      campos: ['access_token', 'refresh_token'] },
  { tabela: 'whatsapp_settings',  chave: 'user_id', campos: ['access_token'] },
];

async function main() {
  console.log('🔐 Cifrando tokens em repouso (LGPD)\n');
  let totalCifrados = 0, totalJa = 0;

  for (const a of ALVOS) {
    try {
      const [rows] = await db.query(
        `SELECT ${a.chave}, ${a.campos.join(', ')} FROM ${a.tabela}`
      ) as any;

      let cifrados = 0, jaCifrados = 0;
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
      console.log(`  ${a.tabela.padEnd(20)} ${rows.length} linha(s) · ${cifrados} cifrada(s) · ${jaCifrados} já cifrado(s)`);
      totalCifrados += cifrados; totalJa += jaCifrados;
    } catch (e: any) {
      console.log(`  ${a.tabela.padEnd(20)} ⚠️  ${e?.message || e}`);
    }
  }

  console.log(`\n✅ Concluído — ${totalCifrados} linha(s) cifrada(s), ${totalJa} campo(s) já estavam cifrados.`);
  if (totalCifrados > 0) {
    console.log('   Os tokens antigos em texto puro foram substituídos pelos cifrados.');
  }
  await closeDatabase();
}

main().catch(async (e) => { console.error('❌', e); await closeDatabase(); process.exit(1); });
