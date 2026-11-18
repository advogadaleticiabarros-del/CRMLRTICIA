import { limparTextoJudicial } from './textCleanup';

/**
 * E-mail "Push" do PJe (18/11/2026). Sem o credenciamento do MNI no TRT17,
 * a via que o tribunal oferece sem pedir nada é o Push: o PJe manda um e-mail
 * a cada atualização dos processos em que a advogada atua
 * ("[TRT17] [PUSH] Atualizações de Informações Processuais do Processo …",
 * de notificacoes@trt17.jus.br). O e-mail traz uma tabela com a data e o
 * texto de cada movimento.
 *
 * Aqui só se lê o e-mail; quem grava é o courtEmailMonitorService. Se o
 * formato não for reconhecido, a lista vem vazia e o leitor de e-mail segue
 * o caminho antigo (um movimento por e-mail, resumido) — nada piora.
 */

export interface MovimentoPush { data: string | null; texto: string }

/** É e-mail Push do PJe? Devolve o tribunal (sigla), ou null. */
export function ehEmailPush(from: string, subject: string): { tribunal: string } | null {
  const de = String(from || '').toLowerCase();
  const assunto = String(subject || '');
  const dominio = de.match(/@([a-z0-9.-]+\.jus\.br)/);
  if (!dominio) return null;
  if (!/\bpush\b/i.test(assunto)) return null;
  const sigla = assunto.match(/\[([A-Z]{2,6}\d{0,2})\]/);
  if (sigla && sigla[1].toUpperCase() !== 'PUSH') return { tribunal: sigla[1].toUpperCase() };
  // Sem sigla no assunto: o tribunal sai do domínio (pje.tjes.jus.br → TJES).
  const partes = dominio[1].split('.').filter((p) => !['pje', 'jus', 'br', 'www', 'push'].includes(p));
  const t = partes[partes.length - 1];
  return t ? { tribunal: t.toUpperCase() } : null;
}

const DATA_RE = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** "17/11/2026 14:32" (horário de Brasília) → ISO em UTC. Sem hora: meio-dia. */
export function dataPushParaIso(s: string): string | null {
  const m = String(s || '').trim().match(DATA_RE);
  if (!m) return null;
  const [, dd, mm, aaaa, hh, mi, ss] = m;
  const dia = Number(dd), mes = Number(mm), ano = Number(aaaa);
  const d = new Date(Date.UTC(ano, mes - 1, dia, (hh ? Number(hh) : 12) + 3, mi ? Number(mi) : 0, ss ? Number(ss) : 0));
  // Recusa data impossível (31/02 vira 03/03 no Date).
  const local = new Date(d.getTime() - 3 * 3600_000);
  if (local.getUTCDate() !== dia || local.getUTCMonth() !== mes - 1 || local.getUTCFullYear() !== ano) return null;
  return d.toISOString();
}

function semRepetidos(movs: MovimentoPush[]): MovimentoPush[] {
  const vistos = new Set<string>();
  return movs.filter((m) => {
    const k = `${m.data}|${m.texto.toLowerCase()}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

function lerTabela(html: string): MovimentoPush[] {
  const out: MovimentoPush[] = [];
  const linhas = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of linhas) {
    const celulas = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => limparTextoJudicial(c));
    const i = celulas.findIndex((c) => DATA_RE.test(c));
    if (i < 0) continue;
    const data = dataPushParaIso(celulas[i]);
    const texto = celulas.filter((c, j) => j !== i && c).join(' — ').trim();
    if (data && texto) out.push({ data, texto: texto.slice(0, 2000) });
  }
  return out;
}

function lerTextoPuro(txt: string): MovimentoPush[] {
  const out: MovimentoPush[] = [];
  for (const linha of txt.split(/\r?\n/)) {
    const m = linha.trim().match(/^(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)\s*[-–|:]\s*(.+)$/);
    if (!m) continue;
    const data = dataPushParaIso(m[1]);
    const texto = limparTextoJudicial(m[2]);
    if (data && texto) out.push({ data, texto: texto.slice(0, 2000) });
  }
  return out;
}

/** Movimentos do corpo do e-mail Push (HTML com tabela, ou texto puro). */
export function lerMovimentosDoPush(corpo: string | null | undefined): MovimentoPush[] {
  const s = String(corpo || '');
  if (!s.trim()) return [];
  const daTabela = /<tr[\s>]/i.test(s) ? lerTabela(s) : [];
  return semRepetidos(daTabela.length ? daTabela : lerTextoPuro(s));
}
