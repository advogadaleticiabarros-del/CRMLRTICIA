/**
 * Audiência entrando sozinha na agenda (pedido da Dra., 17/11/2026).
 *
 * Toda movimentação nova (DJEN, PJe/eproc, DataJud, e-mail) passa por aqui.
 * Se o texto marcar uma audiência com DATA e HORA no futuro ("designo
 * audiência de conciliação para 10/12/2026, às 14h00"), o CRM lança na agenda
 * da Dra. (e no Google Agenda, se conectado) e avisa no sino. Sem hora não
 * lança: hora inventada é pior que nenhuma.
 *
 * `extrairAudiencia` é a regra pura (testada); `registrarAudienciaSeHouver`
 * grava, sem duplicar: a mesma movimentação só gera uma vez, e audiência que
 * já está na agenda (mesmo cliente/caso e mesmo horário) não ganha cópia.
 */

export interface AudienciaExtraida {
  /** Hora local de Brasília, "AAAA-MM-DDTHH:MM". */
  inicio: string;
  tipo: string | null;
  virtual: boolean;
  link: string | null;
}

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = (n: number) => String(n).padStart(2, '0');

const TIPOS: Array<[RegExp, string]> = [
  [/\buna\b/, 'una'],
  [/concilia/, 'conciliação'],
  [/media[cç]/, 'mediação'],
  [/instru/, 'instrução'],
  [/julgamento/, 'julgamento'],
  [/inicial/, 'inicial'],
  [/justifica/, 'justificação'],
  [/custodia/, 'custódia'],
];

/** Data + hora logo depois de uma posição do texto (já sem acento, minúsculo). */
function dataHoraApos(t: string, desde: number): Array<{ pos: number; ano: number; mes: number; dia: number; h: number | null; mi: number }> {
  const janela = t.slice(desde, desde + 400);
  const out: Array<{ pos: number; ano: number; mes: number; dia: number; h: number | null; mi: number }> = [];
  const hora = (resto: string) => {
    const m = resto.slice(0, 40).match(/(?:as|a partir das|horario[:\s]*|hora[:\s]*|,|-|\s)\s*(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?/);
    if (!m) return { h: null as number | null, mi: 0 };
    const h = Number(m[1]); const mi = Number(m[2] || 0);
    return h <= 23 && mi <= 59 ? { h, mi } : { h: null, mi: 0 };
  };
  for (const m of janela.matchAll(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/g)) {
    const { h, mi } = hora(janela.slice((m.index ?? 0) + m[0].length));
    out.push({ pos: m.index ?? 0, dia: Number(m[1]), mes: Number(m[2]), ano: Number(m[3]), h, mi });
  }
  for (const m of janela.matchAll(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/g)) {
    const mes = MESES[m[2]];
    if (!mes) continue;
    const { h, mi } = hora(janela.slice((m.index ?? 0) + m[0].length));
    out.push({ pos: m.index ?? 0, dia: Number(m[1]), mes, ano: Number(m[3]), h, mi });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

export function extrairAudiencia(texto: string | null | undefined, agora: Date = new Date()): AudienciaExtraida | null {
  const original = String(texto || '');
  const t = semAcento(original).replace(/\s+/g, ' ');
  const hojeIso = new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10); // dia em Brasília
  for (const m of t.matchAll(/audiencia/g)) {
    const pos = m.index ?? 0;
    const contexto = t.slice(Math.max(0, pos - 80), pos + 220);
    // Ato que encerra/cancela a audiência, sem nova data marcada: não lança.
    const marca = /(design|redesign|marcad|pautad|agend|fica\w* (?:designad|marcad)|para o dia|sera realizada|realizar-se-a|intim\w+ .{0,60}comparec)/.test(contexto);
    const encerra = /(cancelad|nao realizada|foi realizada|audiencia realizada|termo de audiencia|ata de audiencia|retirad\w* de pauta)/.test(contexto);
    if (encerra && !/redesign/.test(contexto)) continue;
    if (!marca) continue;
    for (const d of dataHoraApos(t, pos)) {
      if (d.h == null) continue;
      if (d.mes < 1 || d.mes > 12 || d.dia < 1 || d.dia > 31) continue;
      const dia = `${d.ano}-${pad(d.mes)}-${pad(d.dia)}`;
      if (dia < hojeIso) continue; // data passada: é histórico, não agenda
      const tipo = TIPOS.find(([re]) => re.test(contexto))?.[1] ?? null;
      const virtual = /(videoconfer|virtual|telepresencial|zoom|teams|google meet|meet\.google|sala virtual|remot)/.test(t);
      const link = original.match(/https?:\/\/[^\s<>"')]+/)?.[0] ?? null;
      return { inicio: `${dia}T${pad(d.h)}:${pad(d.mi)}`, tipo, virtual, link };
    }
  }
  return null;
}

/** "AAAA-MM-DDTHH:MM" + 1 hora (sem fuso: hora local). */
export function maisUmaHora(inicio: string): string {
  const [d, hm] = inicio.split('T');
  const [h, mi] = hm.split(':').map(Number);
  if (h < 23) return `${d}T${pad(h + 1)}:${pad(mi)}`;
  return `${d}T23:59`;
}

export function tituloAudiencia(a: AudienciaExtraida, quem: string | null, processo: string | null): string {
  const base = a.tipo ? `Audiência de ${a.tipo}` : 'Audiência';
  return `${base}${a.virtual ? ' (virtual)' : ''} — ${quem || processo || 'processo sem número'}`.slice(0, 500);
}

/**
 * Grava a audiência da movimentação (se houver), sem duplicar. Best-effort:
 * quem chama ignora erro. Retorna o id do evento (novo ou já existente) ou null.
 */
export async function registrarAudienciaSeHouver(movementId: number, processId: number, texto: string): Promise<number | null> {
  const aud = extrairAudiencia(texto);
  if (!aud) return null;
  const { db } = await import('../config/database');
  const [ja] = await db.query('SELECT event_id FROM audiencias_detectadas WHERE movement_id = ?', [movementId]) as any;
  if (ja.length) return ja[0].event_id ?? null;

  const [[proc]] = await db.query(
    `SELECT lp.client_id, lp.case_id, lp.process_number, lp.court, c.name AS client_name
       FROM legal_processes lp LEFT JOIN clients c ON c.id = lp.client_id WHERE lp.id = ?`, [processId]
  ) as any;
  if (!proc) return null;

  // Mesmo processo + mesmo horário já detectado por outra movimentação (ex.: DJEN e PJe).
  const inicioSql = `${aud.inicio.replace('T', ' ')}:00`;
  const [mesmoProc] = await db.query(
    'SELECT event_id FROM audiencias_detectadas WHERE process_id = ? AND inicio = ? LIMIT 1', [processId, inicioSql]
  ) as any;
  let eventId: number | null = mesmoProc[0]?.event_id ?? null;

  if (!eventId) {
    // Já está na agenda (lançada à mão ou vinda do Google)? Mesmo cliente/caso e mesmo horário local.
    const { localParaUtcMysql } = await import('../utils/timezone');
    const inicioUtc = localParaUtcMysql(aud.inicio);
    const [existe] = await db.query(
      `SELECT id FROM calendar_events
        WHERE event_type = 'audiencia' AND start_datetime = ?
          AND ((? IS NOT NULL AND client_id = ?) OR (? IS NOT NULL AND case_id = ?) OR description LIKE ?)
        LIMIT 1`,
      [inicioUtc, proc.client_id, proc.client_id, proc.case_id, proc.case_id, `%${proc.process_number || '#'}%`]
    ) as any;
    eventId = existe[0]?.id ?? null;
  }

  let criado = false;
  if (!eventId) {
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
    if (!admins.length) return null;
    const { criarEventoAgenda } = await import('./agendaEventos');
    const trecho = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const ev = await criarEventoAgenda(admins[0].id, {
      title: tituloAudiencia(aud, proc.client_name, proc.process_number),
      description: [
        `Processo ${proc.process_number || '(sem número)'}${proc.court ? ` · ${proc.court}` : ''}`,
        aud.link ? `Link: ${aud.link}` : null,
        `Lançada automaticamente pelo CRM a partir de uma movimentação. Confira data e hora no processo.`,
        trecho ? `Trecho: ${trecho}` : null,
      ].filter(Boolean).join('\n'),
      event_type: 'audiencia',
      start_datetime: aud.inicio,
      end_datetime: maisUmaHora(aud.inicio),
      location: aud.virtual ? (aud.link || 'Virtual (videoconferência)') : (proc.court || undefined),
      client_id: proc.client_id ?? null,
      case_id: proc.case_id ?? null,
    });
    eventId = Number(ev?.id ?? ev?.insertId ?? 0) || null;
    criado = true;
  }

  await db.query(
    'INSERT IGNORE INTO audiencias_detectadas (movement_id, process_id, inicio, event_id) VALUES (?, ?, ?, ?)',
    [movementId, processId, inicioSql, eventId]
  );

  if (criado) {
    const { notificationService } = await import('./NotificationService');
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    const [d, hm] = aud.inicio.split('T');
    const quando = `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} às ${hm}`;
    for (const a of admins) {
      await notificationService.create({
        userId: a.id, clientId: proc.client_id ?? undefined,
        title: 'Audiência lançada na agenda',
        message: `${tituloAudiencia(aud, proc.client_name, proc.process_number)}: ${quando}. Confira no processo ${proc.process_number || ''}.`,
        notificationType: 'audiencia_detectada', channel: 'sistema', scheduledAt: new Date(),
      }).catch(() => undefined);
    }
  }
  return eventId;
}
