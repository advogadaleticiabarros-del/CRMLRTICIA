/**
 * Acordos detectados nas movimentações → fila "Acordos a registrar".
 * Um registro por processo (UNIQUE process_id): novas movimentações do mesmo
 * acordo só atualizam o tipo ('proposto' → 'homologado'). A advogada registra
 * os valores pelo cadastro rápido ou descarta. Regras em `deteccaoAcordo.ts`.
 */
import { db } from '../config/database';
import { notificationService } from './NotificationService';
import { detectarAcordo } from './deteccaoAcordo';

/** Chamado para cada movimentação NOVA. Best-effort. */
export async function registrarSeForAcordo(processId: number, movementId: number | null, texto: string, avisar = true): Promise<boolean> {
  const d = detectarAcordo(texto);
  if (!d) return false;
  const [[existente]] = await db.query('SELECT id, status, tipo FROM acordos_detectados WHERE process_id = ?', [processId]) as any;
  if (existente) {
    if (existente.status === 'pendente' && existente.tipo === 'proposto' && d.tipo === 'homologado') {
      await db.query("UPDATE acordos_detectados SET tipo = 'homologado', movement_id = ?, trecho = ?, valor_sugerido = COALESCE(?, valor_sugerido) WHERE id = ?",
        [movementId, texto.slice(0, 1000), d.valorSugerido, existente.id]);
    }
    return false;
  }
  await db.query(
    `INSERT INTO acordos_detectados (process_id, movement_id, tipo, trecho, valor_sugerido) VALUES (?, ?, ?, ?, ?)`,
    [processId, movementId, d.tipo, texto.slice(0, 1000), d.valorSugerido]);
  if (avisar) {
    const [[lp]] = await db.query(
      'SELECT lp.process_number, cl.name FROM legal_processes lp LEFT JOIN clients cl ON cl.id = lp.client_id WHERE lp.id = ?', [processId]) as any;
    const [equipe] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado') AND active = 1") as any;
    for (const u of equipe) {
      await notificationService.create({
        userId: u.id, title: d.tipo === 'homologado' ? '🤝 Acordo homologado — registre os valores' : '🤝 Acordo juntado no processo',
        message: `Processo ${lp?.process_number || ''}${lp?.name ? ` (${lp.name})` : ''}. Financeiro → Acordos → "Acordos a registrar".`,
        notificationType: 'acordo_detectado', channel: 'som', scheduledAt: new Date(),
      }).catch(() => {});
    }
  }
  return true;
}

/** Varre o histórico (sem avisar no sino) — usado uma vez e pelo botão "Procurar". */
export async function varrerHistorico(dias = 180): Promise<{ encontrados: number }> {
  const [movs] = await db.query(
    `SELECT id, process_id, CONCAT(COALESCE(title,''), ' | ', COALESCE(description,'')) AS texto
       FROM process_movements
      WHERE movement_date > NOW() - INTERVAL ? DAY
        AND (title REGEXP 'acordo|transa|concilia' OR description REGEXP 'acordo|transa|concilia')
      ORDER BY movement_date ASC`, [dias]) as any;
  let encontrados = 0;
  for (const m of movs) if (await registrarSeForAcordo(m.process_id, m.id, m.texto, false)) encontrados++;
  return { encontrados };
}

export async function listarPendentes() {
  // Processos com o mesmo número em formatos diferentes aparecem uma vez só.
  const [rows] = await db.query(
    `SELECT ad.id, ad.tipo, ad.trecho, ad.valor_sugerido, ad.created_at,
            lp.id AS process_id, lp.process_number, lp.client_id, lp.case_id, cl.name AS client_name,
            (SELECT DATE(pm.movement_date) FROM process_movements pm WHERE pm.id = ad.movement_id) AS data_movimento
       FROM acordos_detectados ad
       JOIN legal_processes lp ON lp.id = ad.process_id
       LEFT JOIN clients cl ON cl.id = lp.client_id
      WHERE ad.status = 'pendente'
      ORDER BY ad.created_at DESC`) as any;
  const vistos = new Set<string>();
  return rows.filter((r: any) => {
    const k = String(r.process_number).replace(/\D/g, '');
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}

export async function resolver(id: number, acao: 'registrado' | 'descartado', agreementId: number | null = null): Promise<void> {
  const [[ad]] = await db.query(
    'SELECT ad.id, lp.process_number FROM acordos_detectados ad JOIN legal_processes lp ON lp.id = ad.process_id WHERE ad.id = ?', [id]) as any;
  if (!ad) return;
  // Resolve também os "gêmeos" (mesmo número de processo cadastrado em outro formato).
  await db.query(
    `UPDATE acordos_detectados ad JOIN legal_processes lp ON lp.id = ad.process_id
        SET ad.status = ?, ad.agreement_id = ?, ad.resolvido_em = NOW()
      WHERE ad.status = 'pendente' AND REGEXP_REPLACE(lp.process_number, '[^0-9]', '') = ?`,
    [acao, agreementId, String(ad.process_number).replace(/\D/g, '')]);
}
