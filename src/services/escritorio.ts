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
      const oab = l.oab_number ? `OAB/${l.oab_uf || 'ES'} sob o nº ${l.oab_number}` : ADVOGADA.oab;
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
