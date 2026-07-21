import { db } from '../config/database';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// O driver do MySQL devolve colunas DATE como objetos Date, não como texto.
// Sem essa normalização, `dateObj + 'T00:00:00'` vira concatenação de string
// (o JS chama .toString() no Date), gera uma data inválida e o addMonthsStr
// lança RangeError — que ficava engolido pelo catch() da rota, "lançando"
// silenciosamente 0 registros.
function toDateStr(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).slice(0, 10);
}

function addMonthsStr(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export interface Tranche { label: string; valor: number; data: string }

/**
 * Monta o cronograma de recebimento do ACORDO: entrada (se houver) + N
 * parcelas mensais do restante. Mesma lógica de arredondamento usada nas
 * propostas (a diferença de centavos vai para a última parcela).
 */
export function montarCronogramaAcordo(a: {
  total_agreement_value: number; entrada_value?: number; entrada_date?: string | Date | null;
  installments_count: number; first_due_date: string | Date;
}): Tranche[] {
  const total = Number(a.total_agreement_value) || 0;
  const entrada = Number(a.entrada_value) || 0;
  const entradaData = toDateStr(a.entrada_date);
  const primeiroVenc = toDateStr(a.first_due_date);
  const tranches: Tranche[] = [];
  if (entrada > 0 && entradaData) tranches.push({ label: 'Entrada', valor: round2(entrada), data: entradaData });

  const restante = Math.max(0, total - entrada);
  const n = Math.max(0, Math.floor(a.installments_count) || 0);
  if (restante > 0 && n > 0 && primeiroVenc) {
    const base = Math.floor((restante / n) * 100) / 100;
    for (let i = 0; i < n; i++) {
      const valor = i === n - 1 ? round2(restante - base * (n - 1)) : base;
      tranches.push({ label: `${i + 1}ª parcela`, valor, data: addMonthsStr(primeiroVenc, i) });
    }
  }
  return tranches;
}

/**
 * Lança (ou relança) no Financeiro os honorários CONTRATUAIS — proporcionais
 * a cada tranche do acordo (entrada/parcelas) — e os honorários SUCUMBENCIAIS
 * (lançamento único, na data prevista). Idempotente: apaga só os lançamentos
 * PENDENTES já gerados para este acordo antes de recriar — o que já foi
 * recebido (status 'pago') fica intacto, preservando o histórico.
 */
export async function syncAgreementFinanceLaunches(agreementId: number, userId: number): Promise<{ lancados: number }> {
  const [[a]] = await db.query('SELECT * FROM agreements WHERE id = ?', [agreementId]) as any;
  if (!a) return { lancados: 0 };

  // Remove só os PENDENTES deste acordo — não mexe no que já foi recebido.
  await db.query("DELETE FROM financial_records WHERE agreement_id = ? AND status = 'pendente'", [agreementId]);

  let lancados = 0;
  const total = Number(a.total_agreement_value) || 0;
  const honTotal = Number(a.honorarium_value) || 0;

  if (honTotal > 0) {
    const tranches = montarCronogramaAcordo(a);
    if (tranches.length && total > 0) {
      // Honorário contratual proporcional a cada tranche recebida pelo cliente.
      for (const t of tranches) {
        const honTranche = round2((honTotal * t.valor) / total);
        if (honTranche <= 0) continue;
        await db.query(
          `INSERT INTO financial_records (user_id, client_id, case_id, agreement_id, tipo, description, valor, status, due_date)
           VALUES (?, ?, ?, ?, 'receita', ?, ?, 'pendente', ?)`,
          [userId, a.client_id, a.case_id ?? null, agreementId,
           `Honorários contratuais — acordo (${t.label}) — ${a.opposing_party}`, honTranche, t.data]
        );
        lancados++;
      }
    } else {
      // Sem cronograma definido ainda: lança o honorário total na 1ª data disponível.
      const dataFallback = a.entrada_date || a.first_due_date;
      if (dataFallback) {
        await db.query(
          `INSERT INTO financial_records (user_id, client_id, case_id, agreement_id, tipo, description, valor, status, due_date)
           VALUES (?, ?, ?, ?, 'receita', ?, ?, 'pendente', ?)`,
          [userId, a.client_id, a.case_id ?? null, agreementId,
           `Honorários contratuais — acordo — ${a.opposing_party}`, round2(honTotal), dataFallback]
        );
        lancados++;
      }
    }
  }

  // Honorários sucumbenciais — pertencem exclusivamente ao advogado (art. 23, Lei 8.906/94).
  const sucumbencia = Number(a.sucumbencia_value) || 0;
  if (sucumbencia > 0) {
    await db.query(
      `INSERT INTO financial_records (user_id, client_id, case_id, agreement_id, tipo, description, valor, status, due_date)
       VALUES (?, ?, ?, ?, 'receita', ?, ?, 'pendente', ?)`,
      [userId, a.client_id, a.case_id ?? null, agreementId,
       `Honorários sucumbenciais — acordo — ${a.opposing_party}`, round2(sucumbencia),
       a.sucumbencia_due_date || a.entrada_date || a.first_due_date]
    );
    lancados++;
  }

  return { lancados };
}
