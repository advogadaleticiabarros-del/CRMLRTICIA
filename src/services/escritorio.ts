import { db } from '../config/database';
import { ADVOGADA, ContratadaInfo } from './contractTemplates';

/**
 * Dados da advogada/escritório para os documentos (CONTRATADA/OUTORGADA),
 * lidos do CADASTRO de advogados. Usa o primeiro advogado ativo com OAB e
 * endereço preenchidos; cai no default fixo (ADVOGADA) se não houver.
 */
export async function getEscritorio(): Promise<ContratadaInfo> {
  try {
    const [rows] = await db.query(
      `SELECT name, oab_number, oab_uf, address, email FROM lawyers
        WHERE active = 1 AND oab_number IS NOT NULL AND oab_number <> ''
        ORDER BY id LIMIT 1`
    ) as any;
    const l = rows[0];
    if (l && l.address && String(l.address).trim()) {
      // Formata o número da OAB só para exibição (39948 → 39.948); o banco mantém os dígitos (DJEN).
      const oabNum = /^\d+$/.test(String(l.oab_number)) ? Number(l.oab_number).toLocaleString('pt-BR') : l.oab_number;
      const oab = l.oab_number ? `OAB/${l.oab_uf || 'ES'} sob o nº ${oabNum}` : ADVOGADA.oab;
      return {
        nome: String(l.name || ADVOGADA.nome).toUpperCase(),
        oab,
        endereco: l.address,
        email: l.email || undefined,
      };
    }
  } catch { /* fallback abaixo */ }
  return ADVOGADA;
}
