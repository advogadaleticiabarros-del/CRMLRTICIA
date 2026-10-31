import { db } from '../config/database';
import { planoDeLimpeza, type DocParaDedup } from './documentosDuplicados';

/**
 * Banco dos documentos repetidos do cliente (regras em documentosDuplicados.ts).
 * O md5 vem do Drive (drive_md5, gravado na leitura da pasta) ou do arquivo guardado no CRM.
 */

const comoLike = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Marca os repetidos do cliente e passa ao cliente o arquivo que está em mais de uma ação. Não apaga nada. */
export async function organizarDuplicados(clientId: number): Promise<{ marcados: number; paraOCliente: number }> {
  const [rows] = await db.query(
    `SELECT id, case_id, name, type, file_url, COALESCE(drive_md5, IF(data IS NULL, NULL, MD5(data))) AS md5,
            (content IS NOT NULL AND content <> '') AS tem_texto, duplicado_de
       FROM documents WHERE client_id = ?`, [clientId]) as any;
  const plano = planoDeLimpeza(rows as DocParaDedup[]);
  for (const x of plano.duplicados) await db.query('UPDATE documents SET duplicado_de = ? WHERE id = ? AND client_id = ?', [x.de, x.id, clientId]);
  if (plano.paraOCliente.length) await db.query('UPDATE documents SET case_id = NULL WHERE id IN (?) AND client_id = ?', [plano.paraOCliente, clientId]);
  return { marcados: plano.duplicados.length, paraOCliente: plano.paraOCliente.length };
}

/** Guarda o md5 que o Drive informou nos documentos que vieram desses arquivos (os antigos não tinham). */
export async function registrarMd5DoDrive(clientId: number | null, caseId: number, arquivos: Array<{ id: string; md5Checksum?: string | null }>): Promise<void> {
  for (const f of arquivos) {
    if (!f.md5Checksum) continue;
    await db.query(
      `UPDATE documents SET drive_md5 = ? WHERE drive_md5 IS NULL AND file_url LIKE ? AND ${clientId ? 'client_id = ?' : 'case_id = ?'}`,
      [f.md5Checksum, comoLike(f.id), clientId || caseId]);
  }
}

/**
 * O cliente já tem este arquivo? Mesmo arquivo do Drive (ID) ou mesmo conteúdo (md5) em
 * qualquer ação dele; mesmo nome (ou nome de chegada) só na própria ação ou no cliente,
 * porque nomes iguais em pastas de bancos diferentes podem ser arquivos diferentes.
 * Achado em outra ação: passa a ser do cliente (vale para todas as ações).
 */
export async function clienteJaTem(clientId: number | null, caseId: number, f: { id: string; name: string; md5Checksum?: string | null }): Promise<boolean> {
  const dono = clientId ? 'client_id = ?' : 'case_id = ?';
  const [[r]] = await db.query(
    `SELECT id, case_id FROM documents
      WHERE ${dono} AND (file_url LIKE ? OR (? IS NOT NULL AND drive_md5 = ?)
            OR ((case_id = ? OR case_id IS NULL) AND (name = ? OR nome_original = ?)))
      ORDER BY (duplicado_de IS NULL) DESC, id LIMIT 1`,
    [clientId || caseId, comoLike(f.id), f.md5Checksum || null, f.md5Checksum || null, caseId, f.name, f.name]) as any;
  if (!r) return false;
  if (clientId && r.case_id != null && Number(r.case_id) !== caseId) {
    await db.query('UPDATE documents SET case_id = NULL WHERE id = ? AND client_id = ?', [r.id, clientId]).catch(() => {});
  }
  return true;
}
