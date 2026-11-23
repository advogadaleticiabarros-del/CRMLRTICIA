/**
 * Regras puras do backup (sem banco, sem MEGA, sem disco):
 *  - planoRetencao: o que manter e o que apagar (avô-pai-filho);
 *  - slotsPerdidos: quais horários programados de hoje passaram sem backup;
 *  - textoRelatorioDiario: o aviso diário enviado à advogada.
 *
 * Datas: os arquivos têm o carimbo em UTC no nome; dia e hora são contados
 * no horário de Brasília (UTC−3, sem horário de verão desde 2019).
 */

export const PREFIXO_BACKUP = 'crm-backup-';
export const HORARIOS_BACKUP = [2, 9, 19];               // horário de Brasília
const BRT_MS = 3 * 3600_000;

export interface PoliticaRetencao { diasTodos: number; diasDiarios: number; meses: number }
export const RETENCAO_MEGA: PoliticaRetencao = { diasTodos: 3, diasDiarios: 30, meses: 12 };
export const RETENCAO_LOCAL: PoliticaRetencao = { diasTodos: 3, diasDiarios: 14, meses: 0 };

/** Data UTC do carimbo no nome (crm-backup-2026-10-07T12-00-00...), ou null. */
export function dataDoArquivo(nome: string): Date | null {
  const m = String(nome).match(/^crm-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : null;
}

const diaBrt = (d: Date) => new Date(d.getTime() - BRT_MS).toISOString().slice(0, 10);

/**
 * Mantém: tudo dos últimos `diasTodos` dias; o último de cada dia até
 * `diasDiarios`; o último de cada mês até `meses`. Nunca apaga o mais recente.
 */
export function planoRetencao(nomes: string[], agora: Date, p: PoliticaRetencao = RETENCAO_MEGA) {
  const backups = nomes
    .map((n) => ({ n, d: dataDoArquivo(n) }))
    .filter((x): x is { n: string; d: Date } => !!x.d)
    .sort((a, b) => b.d.getTime() - a.d.getTime());       // mais recente primeiro

  const hoje = diaBrt(agora);
  const diasAtras = (d: Date) => Math.round((Date.parse(hoje) - Date.parse(diaBrt(d))) / 86400_000);
  const manter = new Set<string>();
  const diaVisto = new Set<string>();
  const mesVisto = new Set<string>();

  for (const b of backups) {
    const idade = diasAtras(b.d);
    const dia = diaBrt(b.d);
    const mes = dia.slice(0, 7);
    if (idade < p.diasTodos) manter.add(b.n);
    if (idade < p.diasDiarios && !diaVisto.has(dia)) { manter.add(b.n); diaVisto.add(dia); }
    if (p.meses > 0 && !mesVisto.has(mes) && idade < p.meses * 31) { manter.add(b.n); mesVisto.add(mes); }
  }
  if (backups.length && !manter.size) manter.add(backups[0].n);

  return {
    manter: backups.filter((b) => manter.has(b.n)).map((b) => b.n),
    apagar: backups.filter((b) => !manter.has(b.n)).map((b) => b.n),
  };
}

export interface CopiaMega { nome: string; bytes: number }

/**
 * Quanto apagar no MEGA ANTES de enviar a cópia nova (23/11/2026). O MEGA
 * lotou (102%) e o envio travava; como a rotação só rodava depois de um envio
 * bem-sucedido, ele nunca mais se esvaziava sozinho. Agora: primeiro sai o que
 * a rotação normal já apagaria; se ainda não couber com folga (uso final até
 * `usoMaximo`), saem as cópias extras de um mesmo dia, depois as diárias e por
 * último as mensais, sempre da mais antiga para a mais nova. As `minRecentes`
 * mais novas nunca saem (o servidor guarda mais 14 dias à parte).
 */
export function planoEspacoMega(
  copias: CopiaMega[], agora: Date, conta: { total: number; usado: number }, bytesNovo: number,
  opts: { usoMaximo?: number; minRecentes?: number; politica?: PoliticaRetencao } = {},
): { apagar: string[]; cabe: boolean } {
  const usoMaximo = opts.usoMaximo ?? 0.8;
  const minRecentes = opts.minRecentes ?? 3;
  const validas = copias
    .map((c) => ({ ...c, d: dataDoArquivo(c.nome) }))
    .filter((c): c is CopiaMega & { d: Date } => !!c.d)
    .sort((a, b) => a.d.getTime() - b.d.getTime());       // mais antiga primeiro
  const protegidas = new Set(validas.slice(-minRecentes).map((c) => c.nome));
  const { apagar: daRotacao } = planoRetencao(validas.map((c) => c.nome), agora, opts.politica ?? RETENCAO_MEGA);

  const apagar: string[] = daRotacao.filter((n) => !protegidas.has(n));
  const bytesDe = new Map(validas.map((c) => [c.nome, c.bytes]));
  let usado = conta.usado - apagar.reduce((a, n) => a + (bytesDe.get(n) || 0), 0);
  const limite = conta.total * usoMaximo;
  if (usado + bytesNovo <= limite) return { apagar, cabe: true };

  // Última de cada dia e de cada mês (no horário de Brasília) entre as que sobraram.
  const restantes = validas.filter((c) => !apagar.includes(c.nome));
  const ultimaDoDia = new Map<string, string>();
  const ultimaDoMes = new Map<string, string>();
  for (const c of restantes) { ultimaDoDia.set(diaBrt(c.d), c.nome); ultimaDoMes.set(diaBrt(c.d).slice(0, 7), c.nome); }
  const nivel = (c: { nome: string; d: Date }) => {
    if (ultimaDoMes.get(diaBrt(c.d).slice(0, 7)) === c.nome) return 2;
    if (ultimaDoDia.get(diaBrt(c.d)) === c.nome) return 1;
    return 0;
  };
  const fila = restantes
    .filter((c) => !protegidas.has(c.nome))
    .sort((a, b) => nivel(a) - nivel(b) || a.d.getTime() - b.d.getTime());
  for (const c of fila) {
    if (usado + bytesNovo <= limite) break;
    apagar.push(c.nome);
    usado -= c.bytes;
  }
  // Não cabe nem no limite total: devolve só a rotação normal, para não esvaziar o MEGA à toa.
  if (usado + bytesNovo > conta.total) return { apagar: daRotacao.filter((n) => !protegidas.has(n)), cabe: false };
  return { apagar, cabe: true };
}

/** Horários de hoje (Brasília) cuja tolerância já passou sem nenhum backup ok depois do horário. */
export function slotsPerdidos(agora: Date, oks: Date[], toleranciaMin = 40, horarios = HORARIOS_BACKUP): number[] {
  const hoje = diaBrt(agora);
  return horarios.filter((h) => {
    const inicio = Date.parse(`${hoje}T${String(h).padStart(2, '0')}:00:00Z`) + BRT_MS; // h em Brasília → UTC
    if (agora.getTime() < inicio + toleranciaMin * 60_000) return false;
    const proximo = horarios.find((x) => x > h);
    const fim = proximo != null ? Date.parse(`${hoje}T${String(proximo).padStart(2, '0')}:00:00Z`) + BRT_MS : Infinity;
    return !oks.some((d) => d.getTime() >= inicio && d.getTime() < fim);
  });
}

export interface BackupDoDia { hora: number; mega: boolean; local: boolean; verificado: boolean; mb: number }
export interface DadosRelatorio {
  dia: string; esperados: number[]; feitos: BackupDoDia[];
  copiasMega: number; maisAntigaMega: string | null; megaUsoPct: number | null;
  ultimaProva: { data: string; ok: boolean } | null;
}

const hh = (h: number) => `${String(h).padStart(2, '0')}h`;

/** Aviso diário. Começa com ✅ só se TUDO estiver certo; qualquer problema vira ⚠️ e é listado. */
export function textoRelatorioDiario(d: DadosRelatorio): string {
  const completos = d.feitos.filter((f) => f.mega && f.local && f.verificado);
  const faltando = d.esperados.filter((h) => !d.feitos.some((f) => f.hora === h));
  const problemas: string[] = [];
  for (const h of faltando) problemas.push(`backup das ${hh(h)} não foi feito`);
  for (const f of d.feitos) {
    if (!f.mega) problemas.push(`backup das ${hh(f.hora)} não chegou ao MEGA (nuvem)`);
    if (!f.local) problemas.push(`backup das ${hh(f.hora)} não foi gravado no servidor`);
    if (!f.verificado) problemas.push(`backup das ${hh(f.hora)} não passou na verificação do arquivo`);
  }
  if (d.megaUsoPct != null && d.megaUsoPct >= 85) problemas.push(`espaço do MEGA em ${d.megaUsoPct}% — precisa de atenção`);
  if (d.ultimaProva && !d.ultimaProva.ok) problemas.push(`a última prova de restauração (${d.ultimaProva.data}) FALHOU`);

  const ok = !problemas.length;
  const ultimo = d.feitos[d.feitos.length - 1];
  const linhas = [
    `${ok ? '✅' : '⚠️'} *Backup do CRM — ${d.dia}*`,
    `${completos.length} de ${d.esperados.length} cópias completas hoje (${d.esperados.map(hh).join(', ')}), cada uma salva no servidor e no MEGA e conferida (o arquivo abre e está inteiro).`,
    ultimo ? `Última cópia: ${hh(ultimo.hora)}, ${ultimo.mb} MB.` : '',
    `Histórico na nuvem: ${d.copiasMega} cópias${d.maisAntigaMega ? `, a mais antiga de ${d.maisAntigaMega}` : ''}${d.megaUsoPct != null ? ` · MEGA ${d.megaUsoPct}% ocupado` : ''}.`,
    d.ultimaProva ? `Última prova de restauração: ${d.ultimaProva.data} — ${d.ultimaProva.ok ? 'OK' : 'FALHOU'}.` : '',
    ok ? 'Nenhuma ação necessária.' : `*Atenção:*\n${problemas.map((p) => `• ${p}`).join('\n')}`,
  ];
  return linhas.filter(Boolean).join('\n');
}
