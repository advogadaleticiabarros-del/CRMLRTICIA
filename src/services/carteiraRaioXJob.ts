/**
 * Raio-x diário da carteira (06h45, antes do briefing das 7h). Regras em
 * `carteiraRaioX.ts`. Lê processos e casos ativos, guarda a foto do dia em
 * `carteira_raio_x`, compara com a anterior, repassa a cada colega (vira
 * conversa no mural) e avisa a Dra. no sino só quando precisa.
 * Nada é enviado a cliente; nenhum dado é alterado em processos ou casos.
 */
import { db } from '../config/database';
import { notificationService } from './NotificationService';
import { registrarAcaoAgente } from './usoIa';
import {
  montarRaioX, compararComOntem, repassesPorColega, textoDoRepasse, textoDoRaioX, avisoParaDra,
  type CasoCarteira, type Pendencia, type ProcessoCarteira, type RaioX,
} from './carteiraRaioX';

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const iso = (d: any) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);
const json = (v: any) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : Array.isArray(v) ? v : []);

async function lerCarteira(): Promise<{ processos: ProcessoCarteira[]; casos: CasoCarteira[] }> {
  const [ps] = await db.query(
    `SELECT lp.id, lp.process_number, lp.client_id, cl.name AS client_name, lp.case_id, lp.phase, lp.suggested_phase,
            lp.last_movement_at, lp.last_sync_at, lp.monitoring_enabled, lp.valor_causa,
            (SELECT COUNT(*) FROM deadlines d WHERE d.case_id = lp.case_id AND d.status = 'pendente') AS prazos
       FROM legal_processes lp LEFT JOIN clients cl ON cl.id = lp.client_id
      WHERE lp.status = 'ativo'`) as any;
  const [cs] = await db.query(
    `SELECT c.id, c.title, c.client_id, cl.name AS client_name, c.legal_area, c.prescricao_data, c.created_at, c.protocoled_at,
            (EXISTS (SELECT 1 FROM legal_processes lp WHERE lp.case_id = c.id) OR COALESCE(c.case_number, '') <> '') AS tem_processo
       FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.status = 'ativo'`) as any;
  return {
    processos: ps.map((p: any): ProcessoCarteira => ({
      id: p.id, numero: p.process_number, clienteId: p.client_id, cliente: p.client_name, casoId: p.case_id,
      fase: p.phase, faseSugerida: p.suggested_phase, ultimaMov: iso(p.last_movement_at), ultimaConsulta: iso(p.last_sync_at),
      monitorado: !!p.monitoring_enabled, valorCausa: p.valor_causa === null ? null : Number(p.valor_causa), prazosPendentes: Number(p.prazos) || 0,
    })),
    casos: cs.map((c: any): CasoCarteira => ({
      id: c.id, titulo: c.title, clienteId: c.client_id, cliente: c.client_name, area: c.legal_area,
      prescricaoData: iso(c.prescricao_data), temProcesso: !!Number(c.tem_processo), criadoEm: iso(c.created_at)!, protocoladoEm: iso(c.protocoled_at),
    })),
  };
}

async function ultimaFotoAntesDe(dia: string): Promise<Pendencia[] | null> {
  const [[r]] = await db.query('SELECT pendencias FROM carteira_raio_x WHERE dia < ? ORDER BY dia DESC LIMIT 1', [dia]) as any;
  return r ? json(r.pendencias) : null;
}

async function avisarAdmins(title: string, message: string) {
  const [admins] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado') AND active = 1") as any;
  for (const a of admins) {
    await notificationService.create({ userId: a.id, title, message, notificationType: 'carteira_raio_x', channel: 'sistema', scheduledAt: new Date() });
  }
}

export async function runRaioXCarteira(agora = new Date()) {
  const dia = hojeSP();
  const { processos, casos } = await lerCarteira();
  const r = montarRaioX(processos, casos, dia);
  const anterior = await ultimaFotoAntesDe(dia);
  const [[jaHoje]] = await db.query('SELECT dia FROM carteira_raio_x WHERE dia = ?', [dia]) as any;
  await db.query(
    `INSERT INTO carteira_raio_x (dia, saude, processos, casos, em_dia, pendencias) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE saude = VALUES(saude), processos = VALUES(processos), casos = VALUES(casos), em_dia = VALUES(em_dia), pendencias = VALUES(pendencias)`,
    [dia, r.saude, r.conferidos.processos, r.conferidos.casos, r.emDia, JSON.stringify(r.pendencias)]);

  const d = compararComOntem(r.pendencias, anterior);
  // Repetir a rotina no mesmo dia (deploy, rodada manual) não repete conversa nem aviso.
  if (!jaHoje) {
    registrarAcaoAgente('carteira', textoDoRaioX(r));
    // Repassa o que é novo (ou tudo, na 1ª vez e às segundas), só o que não é ajuste leve.
    const segunda = agora.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' }) === 'Mon';
    const paraRepassar = (d.primeiraVez || segunda ? r.pendencias : [...d.novas, ...d.pioraram]).filter((p) => p.gravidade !== 'baixa');
    for (const g of repassesPorColega(paraRepassar)) registrarAcaoAgente('carteira', textoDoRepasse(g.colega, g.pendencias));
    if (d.resolvidas.length) registrarAcaoAgente('carteira', `tirou ${d.resolvidas.length} pendência(s) da lista: resolvidas desde ontem`);
    const aviso = avisoParaDra(r, d, agora);
    if (aviso) await avisarAdmins(aviso.titulo, aviso.mensagem);
  }
  return {
    'processos conferidos': r.conferidos.processos,
    'em dia': r.emDia,
    'pendências': r.pendencias.length,
    graves: r.contagem.critica + r.contagem.alta,
  };
}

/** Última foto (ficha do Vítor, briefing e TV). */
export async function ultimoRaioX(): Promise<(RaioX & { novas: number; resolvidas: number }) | null> {
  const [fotos] = await db.query('SELECT dia, saude, processos, casos, em_dia, pendencias FROM carteira_raio_x ORDER BY dia DESC LIMIT 2') as any;
  if (!fotos.length) return null;
  const [h, o] = fotos;
  const pendencias: Pendencia[] = json(h.pendencias);
  const contagem = { critica: 0, alta: 0, media: 0, baixa: 0 };
  for (const p of pendencias) contagem[p.gravidade]++;
  const d = compararComOntem(pendencias, o ? json(o.pendencias) : null);
  return {
    dia: iso(h.dia)!, saude: Number(h.saude), conferidos: { processos: Number(h.processos), casos: Number(h.casos) }, emDia: Number(h.em_dia),
    contagem, pendencias, novas: d.novas.length, resolvidas: d.resolvidas.length,
  };
}
