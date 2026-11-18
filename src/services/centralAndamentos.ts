/**
 * Central de andamentos (pedido da Dra., 17/11/2026): tudo o que chega dos
 * tribunais num lugar só, com situação da EQUIPE (não lida → lida → tratada,
 * com quem e quando). Fonte única: `process_movements` (DJEN, PJe/eproc pelo
 * MNI, DataJud, e-mail). As regras puras (tipo e fonte) ficam exportadas e
 * testadas; o resto lê e grava no banco.
 */
import { db } from '../config/database';

export type Situacao = 'nao_lidas' | 'lidas' | 'tratadas' | 'todas';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tipo do andamento para a etiqueta e o filtro. A análise da IA, quando existe, manda. */
export function tipoDoAndamento(titulo: string | null, descricao: string | null, aiTipo?: string | null): string {
  const mapaIa: Record<string, string> = {
    sentenca: 'Sentença', acordao: 'Acórdão', decisao: 'Decisão', despacho: 'Despacho', intimacao: 'Intimação',
    citacao: 'Citação', audiencia: 'Audiência', recurso: 'Recurso', transito_julgado: 'Trânsito em julgado', juntada: 'Juntada',
  };
  if (aiTipo && mapaIa[aiTipo]) return mapaIa[aiTipo];
  const t = semAcento(`${titulo || ''} ${String(descricao || '').slice(0, 300)}`);
  const titulo0 = semAcento(titulo || '');
  const regras: Array<[RegExp, string]> = [
    [/transit\w* em julgado/, 'Trânsito em julgado'],
    [/acordao|acordam/, 'Acórdão'],
    [/sentenca|julgo (im)?procedente|julgo parcialmente/, 'Sentença'],
    [/audiencia/, 'Audiência'],
    [/citacao|cite-se/, 'Citação'],
    [/tutela|liminar|decisao/, 'Decisão'],
    [/despacho|mero expediente/, 'Despacho'],
    [/intimacao|intime-se|intimad/, 'Intimação'],
    [/juntada/, 'Juntada'],
  ];
  for (const [re, nome] of regras) if (re.test(titulo0)) return nome;
  for (const [re, nome] of regras) if (re.test(t)) return nome;
  return 'Andamento';
}

/** Nome curto da fonte para a etiqueta. */
export function nomeDaFonte(source: string | null): string {
  const s = String(source || '');
  if (s === 'mni_tjes_pje1g') return 'PJe TJES';
  if (s === 'mni_tjes_pje2g') return 'PJe TJES 2º grau';
  if (s === 'mni_eproc_jfes') return 'eproc JFES';
  if (s.startsWith('mni_')) return 'Tribunal (MNI)';
  if (s.startsWith('djen')) return 'DJEN';
  if (s === 'email_monitoramento') return 'E-mail';
  if (s === 'datajud' || s.startsWith('api_publica_')) return 'DataJud';
  if (s === 'manual') return 'Manual';
  return s || '—';
}

export const TIPOS_FILTRO = ['Sentença', 'Acórdão', 'Decisão', 'Despacho', 'Intimação', 'Citação', 'Audiência', 'Trânsito em julgado', 'Juntada', 'Andamento'];

export async function listarAndamentos(f: { situacao?: Situacao; q?: string; tribunal?: string; tipo?: string; limite?: number }) {
  const situacao: Situacao = (['nao_lidas', 'lidas', 'tratadas', 'todas'] as const).includes(f.situacao as any) ? f.situacao as Situacao : 'nao_lidas';
  const where: string[] = [];
  const params: any[] = [];
  if (situacao === 'nao_lidas') where.push('pm.lida_em IS NULL AND pm.tratada_em IS NULL');
  if (situacao === 'lidas') where.push('pm.lida_em IS NOT NULL AND pm.tratada_em IS NULL');
  if (situacao === 'tratadas') where.push('pm.tratada_em IS NOT NULL');
  // Lidas/tratadas/todas: janela de 120 dias para a lista não ficar pesada.
  if (situacao !== 'nao_lidas') where.push('pm.created_at >= NOW() - INTERVAL 120 DAY');
  if (f.tribunal) { where.push('lp.court LIKE ?'); params.push(`%${String(f.tribunal).slice(0, 60)}%`); }
  const q = String(f.q || '').trim();
  if (q) {
    const dig = q.replace(/\D/g, '');
    if (dig.length >= 7) { where.push("REGEXP_REPLACE(lp.process_number, '[^0-9]', '') LIKE ?"); params.push(`%${dig}%`); }
    else { where.push('c.name LIKE ?'); params.push(`%${q.slice(0, 80)}%`); }
  }
  const limite = Math.min(Math.max(Number(f.limite) || 150, 1), 400);
  const [rows] = await db.query(
    `SELECT pm.id, pm.process_id, pm.movement_date, pm.title, LEFT(pm.description, 700) AS description, pm.source,
            pm.created_at, pm.lida_em, pm.tratada_em, ul.name AS lida_por_nome, ut.name AS tratada_por_nome,
            JSON_UNQUOTE(JSON_EXTRACT(pm.ai_summary, '$.tipo')) AS ai_tipo,
            JSON_UNQUOTE(JSON_EXTRACT(pm.ai_summary, '$.resumo')) AS ai_resumo,
            lp.process_number, lp.court, lp.case_id, lp.client_id, c.name AS client_name,
            ad.inicio AS audiencia_inicio, ad.event_id AS audiencia_evento
       FROM process_movements pm
       JOIN legal_processes lp ON lp.id = pm.process_id
       LEFT JOIN clients c ON c.id = lp.client_id
       LEFT JOIN users ul ON ul.id = pm.lida_por
       LEFT JOIN users ut ON ut.id = pm.tratada_por
       LEFT JOIN audiencias_detectadas ad ON ad.movement_id = pm.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(pm.movement_date, pm.created_at) DESC, pm.id DESC
      LIMIT ${limite}`,
    params
  ) as any;
  const tipoFiltro = f.tipo && TIPOS_FILTRO.includes(f.tipo) ? f.tipo : null;
  return rows
    .map((r: any) => ({
      ...r,
      tipo: tipoDoAndamento(r.title, r.description, r.ai_tipo),
      fonte: nomeDaFonte(r.source),
      situacao: r.tratada_em ? 'tratada' : r.lida_em ? 'lida' : 'nao_lida',
    }))
    .filter((r: any) => !tipoFiltro || r.tipo === tipoFiltro);
}

export async function resumoAndamentos() {
  const [[a]] = await db.query('SELECT COUNT(*) AS n FROM process_movements WHERE lida_em IS NULL AND tratada_em IS NULL') as any;
  const [[i]] = await db.query(
    'SELECT COUNT(*) AS n, MIN(ciencia_automatica_em) AS proxima FROM mni_avisos WHERE resolvido_em IS NULL'
  ) as any;
  const [[n]] = await db.query("SELECT COUNT(*) AS n FROM acoes_novas_clientes WHERE status = 'pendente'") as any;
  const [[au]] = await db.query(
    "SELECT COUNT(*) AS n FROM calendar_events WHERE event_type = 'audiencia' AND start_datetime >= UTC_TIMESTAMP() AND start_datetime < UTC_TIMESTAMP() + INTERVAL 30 DAY"
  ) as any;
  return {
    nao_lidas: Number(a.n || 0),
    intimacoes_pendentes: Number(i.n || 0),
    ciencia_mais_proxima: i.proxima ?? null,
    acoes_novas: Number(n.n || 0),
    audiencias_30d: Number(au.n || 0),
  };
}

/** Marca como lidas: lista de ids ou todas as não lidas. */
export async function marcarLidas(userId: number, ids: number[] | 'todas'): Promise<number> {
  if (ids === 'todas') {
    const [r] = await db.query('UPDATE process_movements SET lida_em = NOW(), lida_por = ? WHERE lida_em IS NULL', [userId]) as any;
    return r.affectedRows || 0;
  }
  const lista = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (!lista.length) return 0;
  const [r] = await db.query('UPDATE process_movements SET lida_em = NOW(), lida_por = ? WHERE lida_em IS NULL AND id IN (?)', [userId, lista]) as any;
  return r.affectedRows || 0;
}

/** Tratada = alguém cuidou (prazo criado, tarefa, nada a fazer). Também conta como lida. */
export async function marcarTratada(userId: number, id: number, desfazer = false): Promise<boolean> {
  const [r] = desfazer
    ? await db.query('UPDATE process_movements SET tratada_em = NULL, tratada_por = NULL WHERE id = ?', [id]) as any
    : await db.query(
      'UPDATE process_movements SET tratada_em = NOW(), tratada_por = ?, lida_em = COALESCE(lida_em, NOW()), lida_por = COALESCE(lida_por, ?) WHERE id = ?',
      [userId, userId, id]
    ) as any;
  return (r.affectedRows || 0) > 0;
}
