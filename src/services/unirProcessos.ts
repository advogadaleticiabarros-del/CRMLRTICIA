/**
 * Une processos duplicados (mesmo número em formatos diferentes) num só.
 * Tudo numa transação: move movimentações, prazos detectados, logs, avisos,
 * e-mails do tribunal, dativos e acordos detectados para o cadastro mantido;
 * remove movimentações repetidas (mesma data + título + início do texto) e
 * apaga as cópias. Regras de escolha em `unirProcessosRegras.ts`.
 */
import { db } from '../config/database';
import { planoUniao, escolhaValida, type CopiaProcesso } from './unirProcessosRegras';

export async function listarDuplicados() {
  const [rows] = await db.query(
    `SELECT lp.id, lp.process_number, lp.client_id, lp.case_id, cl.name AS client_name, c.title AS case_title,
            REGEXP_REPLACE(lp.process_number, '[^0-9]', '') AS digitos,
            (SELECT COUNT(*) FROM process_movements pm WHERE pm.process_id = lp.id) AS movimentacoes
       FROM legal_processes lp
       LEFT JOIN clients cl ON cl.id = lp.client_id
       LEFT JOIN cases c ON c.id = lp.case_id
      WHERE REGEXP_REPLACE(lp.process_number, '[^0-9]', '') IN (
        SELECT d FROM (SELECT REGEXP_REPLACE(process_number, '[^0-9]', '') AS d FROM legal_processes GROUP BY d HAVING COUNT(*) > 1) x)
      ORDER BY digitos, lp.id`) as any;
  const grupos = new Map<string, any[]>();
  for (const r of rows) grupos.set(r.digitos, [...(grupos.get(r.digitos) || []), r]);
  return [...grupos.values()].map((copias) => {
    const plano = planoUniao(copias);
    const nomeCli = (id: number) => copias.find((c) => c.client_id === id)?.client_name || `#${id}`;
    const nomeCaso = (id: number) => copias.find((c) => c.case_id === id)?.case_title || `#${id}`;
    return {
      process_number: copias[0].process_number, copias, ...plano,
      clientes_nomes: plano.clientes.map((id) => ({ id, nome: nomeCli(id) })),
      casos_nomes: plano.casos.map((id) => ({ id, titulo: nomeCaso(id) })),
    };
  });
}

const TABELAS = ['process_movements', 'detected_deadlines', 'monitoring_logs', 'movement_alerts', 'marco_processual_avisos', 'court_email_messages', 'acordos_detectados'];

export async function unirGrupo(digitos: string, escolha: { client_id?: number | null; case_id?: number | null } = {}): Promise<{ manter: number; removidos: number[] }> {
  const d = String(digitos || '').replace(/\D/g, '');
  const [copias] = await db.query(
    "SELECT id, client_id, case_id FROM legal_processes WHERE REGEXP_REPLACE(process_number, '[^0-9]', '') = ? ORDER BY id", [d]) as any;
  if (copias.length < 2) throw new Error('Não há duplicados para este número');
  const plano = planoUniao(copias as CopiaProcesso[]);
  let clientId: number | null = plano.client_id, caseId: number | null = plano.case_id;
  if (plano.conflito) {
    clientId = escolha.client_id ?? null; caseId = escolha.case_id ?? null;
    if (!escolhaValida(copias, clientId, caseId)) throw new Error('Escolha o cliente e o processo/caso corretos entre os do grupo');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const rem of plano.remover) {
      for (const t of TABELAS) await conn.query(`UPDATE IGNORE ${t} SET process_id = ? WHERE process_id = ?`, [plano.manter, rem]);
      await conn.query('UPDATE dative_cases SET legal_process_id = ? WHERE legal_process_id = ?', [plano.manter, rem]);
      // O que sobrou (conflito de chave única = já existe no mantido) é cópia: sai.
      for (const t of ['marco_processual_avisos', 'acordos_detectados']) await conn.query(`DELETE FROM ${t} WHERE process_id = ?`, [rem]);
      await conn.query('DELETE FROM legal_processes WHERE id = ?', [rem]);
    }
    // Movimentações repetidas (a mesma publicação gravada nas duas cópias).
    await conn.query(
      `DELETE pm FROM process_movements pm JOIN process_movements keep
          ON keep.process_id = pm.process_id AND keep.id < pm.id
         AND keep.movement_date <=> pm.movement_date AND keep.title <=> pm.title
         AND LEFT(COALESCE(keep.description, ''), 200) = LEFT(COALESCE(pm.description, ''), 200)
       WHERE pm.process_id = ?`, [plano.manter]);
    await conn.query(
      `UPDATE legal_processes SET client_id = ?, case_id = ?,
              last_movement_at = (SELECT MAX(movement_date) FROM process_movements WHERE process_id = ?)
        WHERE id = ?`, [clientId, caseId, plano.manter, plano.manter]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { manter: plano.manter, removidos: plano.remover };
}
