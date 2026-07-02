import { db, closeDatabase } from '../config/database';

/**
 * Reconciliação one-shot (idempotente) da ENTRADA da parceria, aplicando a
 * regra POR CLIENTE: 1 caso = R$100; 2+ casos = R$130 no total.
 *
 * Corrige lançamentos antigos (ex.: cliente cadastrado em 2 vezes que ficou
 * com 2×R$100 = R$200 em vez de R$130). Só mexe em receitas PENDENTES cuja
 * descrição começa com "Entrada parceria"; nunca toca em valores já pagos.
 * Converge: depois de correto, rodar de novo é no-op.
 */
async function main() {
  const PREFIX = 'Entrada parceria%';
  // Clientes que têm casos de parceria E ao menos uma entrada lançada.
  const [clients] = await db.query(
    `SELECT DISTINCT c.client_id AS id
       FROM cases c
      WHERE c.partner_id IS NOT NULL AND c.client_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM financial_records fr
                     WHERE fr.client_id = c.client_id AND fr.tipo = 'receita' AND fr.description LIKE ?)`,
    [PREFIX]
  ) as any;

  let ajustados = 0;
  for (const cl of clients) {
    const clientId = cl.id;
    const [[cc]] = await db.query(
      'SELECT COUNT(*) AS n FROM cases WHERE client_id = ? AND partner_id IS NOT NULL', [clientId]
    ) as any;
    const totalCasos = Number(cc?.n) || 0;
    if (totalCasos === 0) continue;
    const owed = totalCasos >= 2 ? 130 : 100;

    // Entradas pagas (não tocar) e pendentes (ajustáveis).
    const [[paidRow]] = await db.query(
      `SELECT COALESCE(SUM(valor),0) AS s FROM financial_records
        WHERE client_id = ? AND tipo = 'receita' AND description LIKE ? AND status <> 'pendente'`,
      [clientId, PREFIX]
    ) as any;
    const paid = Number(paidRow?.s) || 0;

    const [pend] = await db.query(
      `SELECT id, valor FROM financial_records
        WHERE client_id = ? AND tipo = 'receita' AND description LIKE ? AND status = 'pendente'
        ORDER BY id ASC`,
      [clientId, PREFIX]
    ) as any;
    const pendSum = pend.reduce((a: number, r: any) => a + Number(r.valor), 0);
    const target = Math.max(0, Math.round((owed - paid) * 100) / 100);

    // Já correto (um único pendente com o valor certo, ou zero) → pula.
    if (pend.length <= 1 && Math.round(pendSum * 100) / 100 === target) continue;

    if (pend.length === 0) {
      if (target > 0) {
        await db.query(
          `INSERT INTO financial_records (client_id, tipo, description, valor, status, due_date)
           VALUES (?, 'receita', ?, ?, 'pendente', DATE_ADD(CURDATE(), INTERVAL 7 DAY))`,
          [clientId, `Entrada parceria — reconciliação (${totalCasos} caso${totalCasos > 1 ? 's' : ''})`, target]
        );
        ajustados++;
      }
      continue;
    }

    // Consolida: o 1º pendente recebe o valor-alvo; os demais são removidos.
    const keep = pend[0];
    await db.query('UPDATE financial_records SET valor = ? WHERE id = ?', [target, keep.id]);
    if (pend.length > 1) {
      const extras = pend.slice(1).map((r: any) => r.id);
      await db.query(`DELETE FROM financial_records WHERE id IN (${extras.map(() => '?').join(',')})`, extras);
    }
    console.log(`  cliente ${clientId}: ${totalCasos} caso(s), pago ${paid}, pendente ${pendSum} → ajustado para ${target}`);
    ajustados++;
  }

  console.log(`✅ Reconciliação da entrada da parceria: ${ajustados} cliente(s) ajustado(s) de ${clients.length} verificado(s).`);
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch((e) => { console.error('Erro na reconciliação:', e.message); return closeDatabase().finally(() => process.exit(0)); });
