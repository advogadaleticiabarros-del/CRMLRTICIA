import { db } from '../config/database';
import { getReceitasRecebidasNoMes } from './monthlyFinance';

/**
 * Metas comerciais mensais. Prática padrão de gestão financeira para
 * escritórios de advocacia solo/pequenos: meta de faturamento RECEBIDO
 * (regime de caixa, não "vendido"), revisada mensalmente, com aumento
 * progressivo quando a meta anterior é batida — mantém o alvo desafiador
 * sem virar frustração quando um mês for mais fraco.
 */

const DEFAULT_TARGET = 15000; // usado só se nunca houve meta nem histórico de receita
const INCREMENTO_AO_BATER = 0.10; // +10% no mês seguinte quando a meta anterior foi atingida

function currentMonth(d = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}
function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Mantém office_settings.meta_faturamento_mes sincronizado (usado pela Visão Geral do Financeiro). */
async function syncOfficeSetting(target: number): Promise<void> {
  await db.query(
    "INSERT INTO office_settings (setting_key, setting_value) VALUES ('meta_faturamento_mes', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [String(target)]
  ).catch(() => {});
}

/** Garante que o mês atual tem uma meta — cria automaticamente se faltar. */
export async function ensureGoalForMonth(month: string): Promise<number> {
  const [[existing]] = await db.query('SELECT target_value FROM monthly_goals WHERE month = ?', [month]) as any;
  if (existing) return Number(existing.target_value);

  const anterior = prevMonth(month);
  const [[goalAnterior]] = await db.query('SELECT target_value FROM monthly_goals WHERE month = ?', [anterior]) as any;
  const [[manualExistente]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'meta_faturamento_mes'"
  ) as any;
  const metaManual = Number(manualExistente?.setting_value) || 0;

  let target: number;
  if (goalAnterior) {
    const receitaAnterior = await getReceitasRecebidasNoMes(anterior);
    const bateu = receitaAnterior.total >= Number(goalAnterior.target_value);
    target = bateu ? Math.round(Number(goalAnterior.target_value) * (1 + INCREMENTO_AO_BATER) / 100) * 100 : Number(goalAnterior.target_value);
  } else if (metaManual > 0) {
    // Primeira vez que o módulo roda — respeita a meta já cadastrada em Configurações.
    target = metaManual;
  } else {
    // Sem histórico nenhum — usa a receita do mês anterior como ponto de partida (ou o padrão, se não houver nada).
    const receitaAnterior = await getReceitasRecebidasNoMes(anterior).catch(() => ({ total: 0 } as any));
    target = receitaAnterior.total > 0 ? Math.round(receitaAnterior.total / 100) * 100 : DEFAULT_TARGET;
  }

  await db.query(
    'INSERT INTO monthly_goals (month, target_value, source) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE target_value = target_value',
    [month, target, 'auto']
  );
  await syncOfficeSetting(target);
  return target;
}

export interface GoalProgress {
  month: string;
  target: number;
  current: number;
  percent: number;
  faltam: number;
  contratos_fechados_mes: number;
}

/** Progresso da meta do mês atual + contratos fechados no mês (protocolados). */
export async function getGoalProgress(): Promise<GoalProgress> {
  const month = currentMonth();
  const target = await ensureGoalForMonth(month);
  const receita = await getReceitasRecebidasNoMes(month);
  const current = receita.total;
  const [[cf]] = await db.query(
    `SELECT COUNT(*) AS n FROM cases WHERE DATE_FORMAT(protocoled_at, '%Y-%m') = ?`, [month]
  ) as any;
  return {
    month, target, current,
    percent: target > 0 ? Math.round((current / target) * 1000) / 10 : 0,
    faltam: Math.max(0, Math.round((target - current) * 100) / 100),
    contratos_fechados_mes: Number(cf.n) || 0,
  };
}

/** Ajuste manual da meta do mês atual (a advogada pode sobrescrever a qualquer momento). */
export async function setGoalForMonth(month: string, target: number): Promise<void> {
  await db.query(
    'INSERT INTO monthly_goals (month, target_value, source) VALUES (?, ?, \'manual\') ON DUPLICATE KEY UPDATE target_value = VALUES(target_value), source = \'manual\'',
    [month, target]
  );
  if (month === currentMonth()) await syncOfficeSetting(target);
}

export { currentMonth };
