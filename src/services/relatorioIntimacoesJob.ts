/**
 * Liga o relatório diário de intimações (`relatorioIntimacoes.ts`) ao banco,
 * ao e-mail e ao WhatsApp da EQUIPE (Dra. e Jessica; nunca a cliente).
 *
 * Roda às 7h25, depois da busca no DJEN das 7h. Traz só as publicações que
 * entraram depois do último relatório enviado (`relatorio_intimacoes_envios`).
 * Dia sem publicação nova: não manda nada.
 */
import { db } from '../config/database';
import { sendEmail } from './EmailService';
import { sendText } from './uazapiInstance';
import { interpretarMovimentacao } from './aiAssistant';
import { analisarPrazoIntimacao } from './prazoIntimacao';
import { montarRelatorio, pdfRelatorio, pdfRecorte, polosDasPartes, type ItemRelatorio, type RelatorioIntimacoes } from './relatorioIntimacoes';

/** Mesmos números que recebem os avisos de prazo (monitoringService). */
const EQUIPE_WHATSAPP = ['5544991011402', '5527988798093'];
const MAX_RESUMOS_IA = 25;

const json = (v: unknown): any => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
};
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

async function ultimoRelatado(): Promise<number | null> {
  const [[r]] = await db.query('SELECT MAX(ate_movement_id) AS id FROM relatorio_intimacoes_envios') as any;
  return r?.id ?? null;
}

async function oabPrincipal(): Promise<string> {
  const [[l]] = await db.query("SELECT oab_number, oab_uf FROM lawyers WHERE oab_number IS NOT NULL AND oab_number <> '' ORDER BY id LIMIT 1").catch(() => [[null]]) as any;
  return l ? `${l.oab_number}/${l.oab_uf || 'ES'}` : '39948/ES';
}

/**
 * Publicações do DJEN para o relatório. `dias` define a janela quando não há
 * corte (primeiro envio) ou numa prévia; com corte, vêm só as posteriores.
 */
export async function coletarItens(opts: { desdeMovementId: number | null; dias: number; resumirComIa?: boolean }): Promise<{ itens: ItemRelatorio[]; ultimoId: number | null }> {
  const [rows] = await db.query(
    `SELECT pm.id, pm.movement_date, pm.title, pm.description, pm.movement_metadata, pm.ai_summary,
            lp.process_number, lp.court, c.name AS client_name
       FROM process_movements pm
       JOIN legal_processes lp ON lp.id = pm.process_id
       LEFT JOIN clients c ON c.id = lp.client_id
      WHERE pm.source = 'djen_oab'
        AND pm.created_at >= NOW() - INTERVAL ? DAY
        ${opts.desdeMovementId ? 'AND pm.id > ?' : ''}
      ORDER BY pm.id
      LIMIT 200`,
    opts.desdeMovementId ? [opts.dias, opts.desdeMovementId] : [opts.dias]
  ) as any;

  const itens: ItemRelatorio[] = [];
  let resumidas = 0;
  for (const r of rows) {
    const meta = json(r.movement_metadata) || {};
    let resumo = json(r.ai_summary)?.resumo || null;
    if (!resumo && opts.resumirComIa && resumidas < MAX_RESUMOS_IA && r.description) {
      resumidas++;
      const ia = await interpretarMovimentacao(r.id, r.description).catch(() => null);
      resumo = ia?.ok ? ia.summary?.resumo || null : null;
    }
    const disponibilizacao = String(meta.disponibilizacao_date || (r.movement_date ? new Date(r.movement_date).toISOString() : hojeSP())).slice(0, 10);
    const polos = polosDasPartes(meta.parties);
    itens.push({
      movementId: r.id, numero: r.process_number, tribunal: r.court || null, orgao: meta.orgao || null,
      classe: meta.classe || null, tipo: meta.tipoComunicacao || r.title || null,
      poloAtivo: polos.ativo, poloPassivo: polos.passivo, cliente: r.client_name || null, link: meta.link || null,
      texto: r.description || r.title || '', resumo,
      analise: analisarPrazoIntimacao({
        numeroProcesso: r.process_number, tribunal: r.court, orgao: meta.orgao, classe: meta.classe,
        tipo: meta.tipoComunicacao || r.title, texto: r.description || r.title || '', disponibilizacao,
      }),
    });
  }
  return { itens, ultimoId: rows.length ? rows[rows.length - 1].id : null };
}

/** Prévia sem enviar e sem mexer no corte (rota do admin). */
export async function previaRelatorio(dias = 1): Promise<RelatorioIntimacoes> {
  const { itens } = await coletarItens({ desdeMovementId: null, dias, resumirComIa: false });
  return montarRelatorio(itens, { oab: await oabPrincipal(), dataReferencia: hojeSP() });
}

export interface ResultadoEnvio { publicacoes: number; prazos: number; emails: number; whatsapp: boolean; pulado?: string }

export async function enviarRelatorioIntimacoes(opts: { dias?: number; mesmoSemNovas?: boolean } = {}): Promise<ResultadoEnvio> {
  const corte = await ultimoRelatado();
  const { itens, ultimoId } = await coletarItens({ desdeMovementId: corte, dias: opts.dias ?? (corte ? 7 : 1), resumirComIa: true });
  if (!itens.length && !opts.mesmoSemNovas) return { publicacoes: 0, prazos: 0, emails: 0, whatsapp: false, pulado: 'nenhuma publicação nova' };

  const rel = montarRelatorio(itens, { oab: await oabPrincipal(), dataReferencia: hojeSP() });
  const sufixo = `${rel.oab.replace('/', '-')}_${rel.dataReferencia}`;
  const anexos = itens.length ? [
    { filename: `Relatorio_${sufixo}.pdf`, content: await pdfRelatorio(rel), contentType: 'application/pdf' },
    { filename: `Relatorio_${sufixo}.csv`, content: Buffer.from(rel.csv, 'utf8'), contentType: 'text/csv; charset=utf-8' },
    { filename: `Recorte_${sufixo}.pdf`, content: await pdfRecorte(rel), contentType: 'application/pdf' },
  ] : [];

  const [users] = await db.query(
    "SELECT email FROM users WHERE active = 1 AND role IN ('admin','advogado') AND email IS NOT NULL AND email <> '' ORDER BY id"
  ) as any;
  let emails = 0;
  for (const u of users) {
    const r = await sendEmail({ to: u.email, subject: rel.assunto, html: rel.html, text: rel.texto, attachments: anexos }).catch(() => ({ ok: false }));
    if (r.ok) emails++;
  }
  let whatsapp = false;
  for (const n of EQUIPE_WHATSAPP) {
    if (await sendText(n, rel.texto, 'Automático — relatório de intimações').catch(() => false)) whatsapp = true;
  }

  if (ultimoId && (emails || whatsapp)) {
    await db.query(
      'INSERT INTO relatorio_intimacoes_envios (ate_movement_id, publicacoes, prazos, email_ok, whatsapp_ok) VALUES (?, ?, ?, ?, ?)',
      [ultimoId, rel.totais.publicacoes, rel.totais.prazos, emails ? 1 : 0, whatsapp ? 1 : 0]
    );
  }
  return { publicacoes: rel.totais.publicacoes, prazos: rel.totais.prazos, emails, whatsapp };
}
