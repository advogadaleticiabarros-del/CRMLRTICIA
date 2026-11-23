/**
 * Classifica todos os processos (rotina diária `processos:classificar`, 18/11/2026):
 * justiça, instância, classe, assuntos, órgão, área (só se vazia), polo da
 * cliente e temperatura pelas decisões. Regras em `classificacaoProcesso.ts`;
 * aqui só banco e DataJud.
 */
import { db } from '../config/database';
import { consultarProcessoDataJud } from './datajud';
import { areaPeloProcesso, instanciaMaisAlta, justicaPeloNumero, temperaturaPelasDecisoes } from './classificacaoProcesso';

/** DataJud manda a data como ISO ("2025-03-10T...") ou compacta ("20250310143311"). */
export function dataDataJud(v: unknown): string | null {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

export interface ResumoClassificacao {
  processos: number; consultadosDataJud: number; areasPreenchidas: number;
  quente: number; morno: number; frio: number; dataJudLimitou: boolean;
}

/**
 * Temperatura e área: todos os processos, toda rodada (só banco).
 * DataJud: no máximo `limiteDataJud` por rodada (o CNJ devolve 429 com muitas
 * consultas seguidas), primeiro os nunca consultados e depois os consultados
 * há mais de 7 dias. Se o DataJud recusar, para de consultar nesta rodada.
 */
export async function classificarProcessos(opts: { datajud?: boolean; pausaMs?: number; limiteDataJud?: number } = {}): Promise<ResumoClassificacao> {
  let usarDataJud = opts.datajud !== false;
  const pausa = opts.pausaMs ?? 1500;
  let cotaDataJud = opts.limiteDataJud ?? 30;
  const [ps] = await db.query(
    `SELECT lp.id, lp.process_number, lp.court_alias, lp.judicial_area, lp.distribution_date, lp.polo_cliente,
            lp.classe, lp.assuntos, c.polo_cliente AS polo_caso,
            (lp.datajud_classificado_em IS NULL OR lp.datajud_classificado_em < NOW() - INTERVAL 7 DAY) AS precisa_datajud
       FROM legal_processes lp LEFT JOIN cases c ON c.id = lp.case_id
      WHERE lp.process_number IS NOT NULL
      ORDER BY lp.datajud_classificado_em IS NOT NULL, lp.datajud_classificado_em, lp.id`
  ) as any;
  const resumo: ResumoClassificacao = { processos: ps.length, consultadosDataJud: 0, areasPreenchidas: 0, quente: 0, morno: 0, frio: 0, dataJudLimitou: false };

  for (const p of ps) {
    const justica = justicaPeloNumero(p.process_number);
    let instancia: string | null = null;
    let classe: string | null = p.classe ?? null;
    let assuntos: string[] = p.assuntos ? String(p.assuntos).split(' | ') : [];
    let classeOrigem: string | null = null;
    let orgao: string | null = null;
    let ajuizamento: string | null = null;
    let sigilo = 0;

    let consultou = false;
    if (usarDataJud && cotaDataJud > 0 && Number(p.precisa_datajud)) {
      cotaDataJud--;
      const r = await consultarProcessoDataJud(p.process_number, p.court_alias).catch(() => null);
      if (r?.limitado || (r?.error && /429|Timeout/i.test(r.error))) { usarDataJud = false; resumo.dataJudLimitou = true; }
      consultou = !!r && (r.found || r.error === 'Processo não encontrado');
      if (r?.found && r.metadata) {
        resumo.consultadosDataJud++;
        const m = r.metadata;
        instancia = instanciaMaisAlta(m.graus || [m.grau]);
        classe = m.classeAtual || m.classe || classe;
        classeOrigem = m.classe || null;
        if (Array.isArray(m.assuntos) && m.assuntos.length) assuntos = m.assuntos;
        orgao = m.orgaoAtual || m.orgao || null;
        ajuizamento = dataDataJud(m.primeiroAjuizamento || m.distribuicao);
        sigilo = Number(m.sigilo) || 0;
      }
      if (pausa) await new Promise((res) => setTimeout(res, pausa));
    }

    const area = !p.judicial_area ? areaPeloProcesso({ justica, classe: [classeOrigem, classe].filter(Boolean).join(' | '), assuntos }) : null;
    if (area) resumo.areasPreenchidas++;

    const [movs] = await db.query('SELECT movement_date, title FROM process_movements WHERE process_id = ?', [p.id]) as any;
    const t = temperaturaPelasDecisoes(movs, p.polo_cliente || p.polo_caso || null);
    resumo[t.temperatura]++;

    await db.query(
      `UPDATE legal_processes SET
         justica = ?, instancia = COALESCE(?, instancia), classe = COALESCE(?, classe), assuntos = COALESCE(?, assuntos),
         orgao_julgador = COALESCE(?, orgao_julgador),
         judicial_area = COALESCE(judicial_area, ?),
         distribution_date = COALESCE(distribution_date, ?),
         confidential = IF(? > 0, 1, confidential),
         temperatura = ?, temperatura_confianca = ?, temperatura_decisao = ?, temperatura_decisao_em = ?, temperatura_motivo = ?,
         classificado_em = NOW(), datajud_classificado_em = IF(?, NOW(), datajud_classificado_em)
       WHERE id = ?`,
      [justica, instancia, classe?.slice(0, 200) ?? null, assuntos.length ? assuntos.join(' | ').slice(0, 600) : null,
        orgao?.slice(0, 255) ?? null, area, ajuizamento, sigilo,
        t.temperatura, t.confianca, t.decisao?.slice(0, 255) ?? null, t.decisao_em, t.motivo.slice(0, 255), consultou ? 1 : 0, p.id]
    );
  }
  return resumo;
}
