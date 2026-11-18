/**
 * Termômetro dos casos (18/11/2026, pedido da Dra.: "quais estão parados a
 * mais de 100 dias, quais fases estão e qual login e senha ainda falta").
 *
 * Para cada processo ativo: há quantos dias não se mexe (última movimentação
 * de qualquer fonte), a faixa (em dia ≤30, atenção ≤60, alerta ≤100, parado
 * >100), a fase, se a fase precisa ser conferida (o CRM sugeriu outra) e em
 * qual sistema do tribunal ele está — e se esse sistema já tem o login da
 * advogada ligado no CRM.
 *
 * Regras puras exportadas (testadas); `termometroDoBanco()` só lê o banco.
 */
import { partesCnj } from './mni/sistemas';

export type Faixa = 'em_dia' | 'atencao' | 'alerta' | 'parado' | 'sem_movimento';
export type SituacaoLogin = 'ligado' | 'falta_login' | 'credenciamento' | 'sem_ligacao';

export interface SistemaProcesso { id: string; nome: string; ligavel: boolean }

const NOMES_LIGAVEIS: Record<string, string> = {
  tjes_pje1g: 'TJES — PJe 1º grau',
  tjes_pje2g: 'TJES — PJe 2º grau e Turmas Recursais',
  eproc_jfes: 'Justiça Federal ES — eproc',
};

/** Em qual sistema o processo tramita, pelo número CNJ. */
export function sistemaDoProcesso(numero: string | null): SistemaProcesso {
  const p = partesCnj(numero || '');
  if (!p) return { id: 'sem_numero', nome: 'Sem número CNJ', ligavel: false };
  const tr = Number(p.tr);
  if (p.j === '8' && p.tr === '08') {
    const id = p.origem === '0000' ? 'tjes_pje2g' : 'tjes_pje1g';
    return { id, nome: NOMES_LIGAVEIS[id], ligavel: true };
  }
  if (p.j === '4' && p.tr === '02' && p.origem.startsWith('50')) return { id: 'eproc_jfes', nome: NOMES_LIGAVEIS.eproc_jfes, ligavel: true };
  if (p.j === '4') return { id: `trf${tr}`, nome: `Justiça Federal da ${tr}ª Região (fora do ES)`, ligavel: false };
  if (p.j === '5' && p.tr === '17') return { id: 'trt17', nome: 'TRT17 — PJe-JT', ligavel: false };
  if (p.j === '5') return { id: `trt${tr}`, nome: `TRT da ${tr}ª Região`, ligavel: false };
  if (p.j === '6') return { id: 'tre', nome: 'Justiça Eleitoral', ligavel: false };
  if (p.j === '8') return { id: `tj${p.tr}`, nome: `Tribunal de Justiça (fora do ES, código ${p.tr})`, ligavel: false };
  if (p.j === '3') return { id: 'stj', nome: 'STJ', ligavel: false };
  if (p.j === '1') return { id: 'stf', nome: 'STF', ligavel: false };
  return { id: `j${p.j}`, nome: `Outro tribunal (${p.j}.${p.tr})`, ligavel: false };
}

export function faixaDeDias(dias: number | null): Faixa {
  if (dias == null) return 'sem_movimento';
  if (dias <= 30) return 'em_dia';
  if (dias <= 60) return 'atencao';
  if (dias <= 100) return 'alerta';
  return 'parado';
}

function situacaoLogin(s: SistemaProcesso, ligados: Set<string>): SituacaoLogin {
  if (ligados.has(s.id)) return 'ligado';
  if (s.ligavel) return 'falta_login';
  if (s.id === 'trt17') return 'credenciamento';
  return 'sem_ligacao';
}

const MOTIVO: Record<SituacaoLogin, string> = {
  ligado: 'Login salvo e funcionando no CRM.',
  falta_login: 'Falta salvar o login em Configurações → Ligação com os tribunais.',
  credenciamento: 'O TRT17 só libera depois de pedido de credenciamento ao tribunal.',
  sem_ligacao: 'Sem ligação direta: o CRM acompanha pelo DJEN e pelo DataJud.',
};

export interface ProcessoTermometro {
  id: number; process_number: string | null; client_id: number | null; client_name: string | null; case_id: number | null;
  court: string | null; phase: string | null; suggested_phase: string | null; status: string | null;
  ultimo_movimento_em: string | Date | null; ultimo_titulo: string | null;
}

const ENCERRADO = (p: ProcessoTermometro) => p.status === 'arquivado' || p.phase === 'encerrado';
const ORDEM_FAIXA: Record<Faixa, number> = { sem_movimento: 0, parado: 1, alerta: 2, atencao: 3, em_dia: 4 };

export function montarTermometro(processos: ProcessoTermometro[], sistemasLigados: string[], hoje = new Date()) {
  const ligados = new Set(sistemasLigados);
  const ativos = processos.filter((p) => !ENCERRADO(p));
  const linhas = ativos.map((p) => {
    const ult = p.ultimo_movimento_em ? new Date(p.ultimo_movimento_em) : null;
    const dias = ult && !Number.isNaN(ult.getTime()) ? Math.max(0, Math.floor((hoje.getTime() - ult.getTime()) / 86_400_000)) : null;
    const sis = sistemaDoProcesso(p.process_number);
    return {
      ...p,
      ultimo_movimento_em: ult ? ult.toISOString() : null,
      dias_parado: dias,
      faixa: faixaDeDias(dias),
      fase_a_conferir: !!p.suggested_phase && p.suggested_phase !== p.phase,
      sistema: { ...sis, situacao: situacaoLogin(sis, ligados) },
    };
  }).sort((a, b) => ORDEM_FAIXA[a.faixa] - ORDEM_FAIXA[b.faixa] || (b.dias_parado ?? 0) - (a.dias_parado ?? 0));

  const por_faixa: Record<Faixa, number> = { em_dia: 0, atencao: 0, alerta: 0, parado: 0, sem_movimento: 0 };
  const por_fase: Record<string, number> = {};
  const sistemas = new Map<string, { id: string; nome: string; situacao: SituacaoLogin; motivo: string; processos: number; parados: number }>();
  for (const id of Object.keys(NOMES_LIGAVEIS)) {
    const s = { id, nome: NOMES_LIGAVEIS[id], ligavel: true };
    const sit = situacaoLogin(s, ligados);
    sistemas.set(id, { id, nome: s.nome, situacao: sit, motivo: MOTIVO[sit], processos: 0, parados: 0 });
  }
  for (const l of linhas) {
    por_faixa[l.faixa]++;
    const f = l.phase || 'sem_fase';
    por_fase[f] = (por_fase[f] || 0) + 1;
    const s = sistemas.get(l.sistema.id) || { id: l.sistema.id, nome: l.sistema.nome, situacao: l.sistema.situacao, motivo: MOTIVO[l.sistema.situacao], processos: 0, parados: 0 };
    s.processos++;
    if (l.faixa === 'parado' || l.faixa === 'sem_movimento') s.parados++;
    sistemas.set(s.id, s);
  }
  const comMov60 = por_faixa.em_dia + por_faixa.atencao;
  return {
    gerado_em: hoje.toISOString(),
    total_ativos: linhas.length,
    encerrados: processos.length - linhas.length,
    temperatura: linhas.length ? Math.round((comMov60 / linhas.length) * 100) : 0,
    parados_100: por_faixa.parado,
    fases_a_conferir: linhas.filter((l) => l.fase_a_conferir).length,
    por_faixa,
    por_fase,
    logins: [...sistemas.values()].sort((a, b) => b.processos - a.processos),
    processos: linhas,
  };
}

export async function termometroDoBanco() {
  const { db } = await import('../config/database');
  const [rows] = await db.query(
    `SELECT lp.id, lp.process_number, lp.client_id, c.name AS client_name, lp.case_id, lp.court, lp.phase, lp.suggested_phase, lp.status,
            GREATEST(COALESCE(mv.ult, '1000-01-01'), COALESCE(lp.last_movement_at, '1000-01-01')) AS ultimo_raw,
            (SELECT pm.title FROM process_movements pm WHERE pm.process_id = lp.id ORDER BY pm.movement_date DESC, pm.id DESC LIMIT 1) AS ultimo_titulo
       FROM legal_processes lp
       LEFT JOIN clients c ON c.id = lp.client_id
       LEFT JOIN (SELECT process_id, MAX(movement_date) AS ult FROM process_movements GROUP BY process_id) mv ON mv.process_id = lp.id`
  ) as any;
  const [creds] = await db.query('SELECT sistema FROM mni_credenciais WHERE ativo = 1') as any;
  const processos: ProcessoTermometro[] = rows.map((r: any) => {
    const u = r.ultimo_raw ? new Date(r.ultimo_raw) : null;
    return { ...r, ultimo_movimento_em: u && u.getUTCFullYear() > 1900 ? u : null };
  });
  return montarTermometro(processos, creds.map((c: any) => c.sistema));
}
