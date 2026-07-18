/**
 * Contagem de prazos processuais em DIAS ÚTEIS (CPC art. 219 e 224):
 * - exclui o dia do começo e inclui o do vencimento;
 * - começo em dia não útil empurra para o 1º dia útil seguinte;
 * - vencimento em dia não útil prorroga para o 1º dia útil seguinte;
 * - opcionalmente suspende 20/12 a 20/01 (CPC art. 220).
 *
 * Feriados: nacionais fixos + móveis (Carnaval, Sexta-feira Santa, Corpus
 * Christi, calculados pela Páscoa) + estaduais do ES. Feriados MUNICIPAIS da
 * comarca não entram — confira o calendário do tribunal em datas apertadas.
 */

function pascoa(ano: number): Date {
  // Algoritmo de Meeus/Jones/Butcher (calendário gregoriano)
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime()); r.setUTCDate(r.getUTCDate() + n); return r;
}
const iso = (d: Date) => d.toISOString().split('T')[0];

export function feriadosDoAno(ano: number): Map<string, string> {
  const out = new Map<string, string>();
  const fixos: [string, string][] = [
    [`${ano}-01-01`, 'Confraternização Universal'],
    [`${ano}-04-21`, 'Tiradentes'],
    [`${ano}-05-01`, 'Dia do Trabalho'],
    [`${ano}-09-07`, 'Independência'],
    [`${ano}-10-12`, 'N. Sra. Aparecida'],
    [`${ano}-11-02`, 'Finados'],
    [`${ano}-11-15`, 'Proclamação da República'],
    [`${ano}-11-20`, 'Consciência Negra'],
    [`${ano}-12-25`, 'Natal'],
    // Feriados forenses da Lei 5.010/66 art. 62 (Justiça Federal; TJES adota)
    [`${ano}-08-11`, 'Criação dos cursos jurídicos (forense)'],
    [`${ano}-11-01`, 'Todos os Santos (forense)'],
    [`${ano}-12-08`, 'Imaculada Conceição / N. Sra. da Penha (forense/ES)'],
  ];
  for (const [d, n] of fixos) out.set(d, n);
  const p = pascoa(ano);
  out.set(iso(addDays(p, -48)), 'Carnaval (segunda)');
  out.set(iso(addDays(p, -47)), 'Carnaval (terça)');
  out.set(iso(addDays(p, -3)), 'Quinta-feira Santa (forense)');
  out.set(iso(addDays(p, -2)), 'Sexta-feira Santa');
  out.set(iso(addDays(p, 60)), 'Corpus Christi (forense)');
  return out;
}

function emSuspensao(dataISO: string): boolean {
  // CPC art. 220 — 20/12 a 20/01, inclusive.
  const md = dataISO.slice(5); // MM-DD
  return md >= '12-20' || md <= '01-20';
}

export interface PrazoOpts {
  uteis?: boolean;            // padrão true (CPC). false = dias corridos
  suspensaoFimAno?: boolean;  // padrão true — CPC art. 220 (desligue p/ CLT etc.)
}

export function ehDiaUtil(dataISO: string, opts: PrazoOpts = {}): { util: boolean; motivo?: string } {
  const d = new Date(dataISO + 'T12:00:00Z');
  const dow = d.getUTCDay();
  if (dow === 0) return { util: false, motivo: 'domingo' };
  if (dow === 6) return { util: false, motivo: 'sábado' };
  const fer = feriadosDoAno(d.getUTCFullYear()).get(dataISO);
  if (fer) return { util: false, motivo: fer };
  if (opts.suspensaoFimAno !== false && emSuspensao(dataISO)) return { util: false, motivo: 'suspensão 20/12–20/01 (CPC art. 220)' };
  return { util: true };
}

export function contarPrazo(inicioISO: string, dias: number, opts: PrazoOpts = {}) {
  const uteis = opts.uteis !== false;
  const pulados: { data: string; motivo: string }[] = [];

  // Dia do começo é excluído (CPC art. 224); o dia 1 é o primeiro dia útil
  // seguinte à publicação — cair em dia não útil já é tratado pela própria
  // contagem, que só desconta dias úteis.
  let cursor = new Date(inicioISO + 'T12:00:00Z');
  let restantes = Math.max(1, Math.floor(dias));
  while (restantes > 0) {
    cursor = addDays(cursor, 1);
    const dataISO = iso(cursor);
    if (uteis) {
      const chk = ehDiaUtil(dataISO, opts);
      if (!chk.util) { pulados.push({ data: dataISO, motivo: chk.motivo || '' }); continue; }
    }
    restantes--;
  }

  // Vencimento em dia não útil prorroga (só relevante na contagem corrida).
  if (!uteis) {
    let chk = ehDiaUtil(iso(cursor), opts);
    while (!chk.util) { pulados.push({ data: iso(cursor), motivo: chk.motivo || '' }); cursor = addDays(cursor, 1); chk = ehDiaUtil(iso(cursor), opts); }
  }

  return { vencimento: iso(cursor), dias_pulados: pulados.length, pulados: pulados.slice(0, 40) };
}
