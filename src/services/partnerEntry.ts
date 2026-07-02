import { db } from '../config/database';

/**
 * Regra da ENTRADA da parceria (100% do escritório), calculada POR CLIENTE:
 *  - cliente com 1 caso da parceria     → R$ 100 no total
 *  - cliente com 2+ casos da parceria   → R$ 130 no total (não importa quantos)
 *
 * O valor é sempre o TOTAL DEVIDO pelo cliente; se já houver entrada lançada,
 * lança apenas a diferença (ex.: 1º caso lançou 100, ao entrar o 2º caso lança
 * só +30). Idempotente: chamar de novo no mesmo estado não duplica.
 */
const PREFIXO = 'Entrada parceria';

export function entradaDevida(totalCasos: number, single = 100, double = 130): number {
  if (totalCasos <= 0) return 0;
  return totalCasos === 1 ? single : double;
}

/**
 * Recalcula a entrada devida pelo cliente e lança apenas a diferença que faltar.
 * Retorna o valor lançado agora (0 se nada a lançar).
 */
export async function ajustarEntradaParceria(
  clientId: number, partner: any, caseIdParaRegistro: number | null, actorId: number
): Promise<number> {
  const [[c]] = await db.query(
    'SELECT COUNT(*) AS n FROM cases WHERE client_id = ? AND partner_id IS NOT NULL', [clientId]
  ) as any;
  const totalCasos = Number(c?.n) || 0;
  if (totalCasos === 0) return 0;

  const single = Number(partner?.entry_value_single) || 100;
  const double = Number(partner?.entry_value_double) || 130;
  const devida = entradaDevida(totalCasos, single, double);

  const [[s]] = await db.query(
    `SELECT COALESCE(SUM(valor),0) AS total FROM financial_records
      WHERE client_id = ? AND tipo = 'receita' AND description LIKE ?`,
    [clientId, `${PREFIXO}%`]
  ) as any;
  const jaLancado = Number(s?.total) || 0;

  const diff = Math.round((devida - jaLancado) * 100) / 100;
  if (diff <= 0) return 0;

  const [[cl]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
  await db.query(
    `INSERT INTO financial_records (user_id, client_id, case_id, tipo, description, valor, status, due_date)
     VALUES (?, ?, ?, 'receita', ?, ?, 'pendente', DATE_ADD(CURDATE(), INTERVAL 7 DAY))`,
    [actorId, clientId, caseIdParaRegistro,
     `${PREFIXO} ${partner?.name || ''} — ${cl?.name || ''} (${totalCasos} caso${totalCasos > 1 ? 's' : ''})`, diff]
  );
  return diff;
}
