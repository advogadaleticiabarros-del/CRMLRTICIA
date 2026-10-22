/**
 * Regras puras da Mesa do caso (tela de trabalho da produção):
 * - a peça editada vira HTML com só a formatação de peça (lista fechada: nada de
 *   script, evento, link ou estilo além do alinhamento) e um texto puro paralelo,
 *   que a revisão, a Dra. Vera e a contagem de [colchetes] continuam lendo;
 * - a peça da IA (texto com marcações simples) vira HTML para editar;
 * - comparação entre a versão da equipe e a da Dra., e as lições que a equipe tira dela;
 * - as etapas da produção com "o que fazer agora" e "pronto para avançar quando".
 * Testes em tests/mesaCaso.test.mjs.
 */

// ── HTML da peça: lista fechada ─────────────────────────────────────────────

const PERMITIDAS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const COM_ALINHAMENTO = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'li', 'td', 'th']);
const TROCA: Record<string, string> = { div: 'p' };
const PERIGOSAS_COM_CONTEUDO = /<(script|style|iframe|object|embed|noscript|template|svg|math|textarea|select|title|head)\b[\s\S]*?<\/\1\s*>/gi;

function alinhamento(attrs: string): string | null {
  const m = attrs.match(/style\s*=\s*("([^"]*)"|'([^']*)')/i);
  const css = m ? (m[2] ?? m[3] ?? '') : '';
  const a = css.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i);
  return a ? a[1].toLowerCase() : null;
}

export function sanitizarHtmlPeca(html: string): string {
  const semPerigo = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(PERIGOSAS_COM_CONTEUDO, '')
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>/gi, '');
  let out = '';
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(semPerigo))) {
    if (m[4] !== undefined) { out += m[4].replace(/>/g, '&gt;'); continue; }
    if (m[5] !== undefined) { out += '&lt;'; continue; }
    const fecha = m[1] === '/';
    const nome = TROCA[m[2].toLowerCase()] || m[2].toLowerCase();
    if (!PERMITIDAS.has(nome)) continue;
    if (nome === 'br') { if (!fecha) out += '<br>'; continue; }
    if (fecha) { out += `</${nome}>`; continue; }
    const al = COM_ALINHAMENTO.has(nome) ? alinhamento(m[3]) : null;
    out += al ? `<${nome} style="text-align:${al}">` : `<${nome}>`;
  }
  return out;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodificar(t: string): string {
  return t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (todo, e: string) => {
    const k = e.toLowerCase();
    if (ENTIDADES[k] !== undefined) return ENTIDADES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
    return todo;
  });
}

/** Texto puro da peça (para revisão, conferência das citações, busca e cópia sem formatação). */
export function htmlParaTexto(html: string): string {
  let out = '';
  const listas: Array<{ ordenada: boolean; n: number }> = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || '')))) {
    if (m[3] !== undefined) { out += decodificar(m[3]); continue; }
    const fecha = m[1] === '/', nome = m[2].toLowerCase();
    if (nome === 'br') out += '\n';
    else if (nome === 'ol' || nome === 'ul') { if (fecha) { listas.pop(); out += '\n\n'; } else { listas.push({ ordenada: nome === 'ol', n: 0 }); out += '\n'; } }
    else if (nome === 'li') { if (fecha) out += '\n'; else { const l = listas[listas.length - 1]; out += l?.ordenada ? `${++l.n}. ` : '- '; } }
    else if (nome === 'td' || nome === 'th') { if (fecha) out += ' | '; }
    else if (nome === 'tr') { if (fecha) out += '\n'; }
    else if (fecha && ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'table'].includes(nome)) out += '\n\n';
  }
  return out.split('\n').map((l) => l.replace(/[ \t\u00a0]+$/g, '').replace(/ \| $/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── texto da IA -> HTML editável ────────────────────────────────────────────

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emLinha = (s: string) => escapar(s)
  .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s.,;:)!?]|$)/g, '$1<i>$2</i>');
const maiusculo = (l: string) => { const letras = l.replace(/[^A-Za-zÀ-ÿ]/g, ''); return letras.length >= 3 && letras === letras.toUpperCase(); };
const SECAO = /^(?:[IVXLC]+\s*[-–—.)]|D[OA]S?\s)/;

/** Dentro de um bloco, separa título (#), lista e tabela que vieram sem linha em branco. */
function grupos(linhas: string[]): string[][] {
  const tipo = (l: string) => (/^#{1,6}\s/.test(l) ? 'h' : /^[-*•]\s+/.test(l) ? 'li' : l.startsWith('|') ? 'tab' : 'p');
  const out: string[][] = [];
  let ult = '';
  for (const l of linhas) {
    const t = tipo(l);
    if (t !== 'h' && t === ult) out[out.length - 1].push(l); else out.push([l]);
    ult = t;
  }
  return out;
}

export function textoParaHtml(texto: string): string {
  const blocos = String(texto || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.replace(/^\n+|\n+$/g, '')).filter((b) => b.trim());
  return blocos.flatMap((b) => grupos(b.split('\n').map((l) => l.trim()).filter(Boolean))).map((linhas) => {
    if (linhas.every((l) => l.startsWith('|'))) {
      const celulas = (l: string) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => emLinha(c.trim()));
      const temCabecalho = linhas.length > 1 && /^\|?\s*:?-{2,}/.test(linhas[1]);
      const corpo = linhas.filter((_, i) => !(temCabecalho && i === 1));
      return `<table>${corpo.map((l, i) => {
        const tag = temCabecalho && i === 0 ? 'th' : 'td';
        return `<tr>${celulas(l).map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
      }).join('')}</table>`;
    }
    if (linhas.every((l) => /^[-*•]\s+/.test(l))) return `<ul>${linhas.map((l) => `<li>${emLinha(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (linhas.length === 1 && /^#{1,6}\s/.test(linhas[0])) return `<h3>${emLinha(linhas[0].replace(/^#{1,6}\s+/, ''))}</h3>`;
    const unico = linhas.join(' ');
    if (linhas.length === 1 && maiusculo(unico) && SECAO.test(unico.replace(/\*\*/g, ''))) return `<h3>${emLinha(unico.replace(/\*\*/g, ''))}</h3>`;
    if (maiusculo(unico) && unico.length <= 400) return `<p style="text-align:center"><b>${emLinha(linhas.join('\n').replace(/\*\*/g, '')).replace(/\n/g, '<br>')}</b></p>`;
    return `<p style="text-align:justify">${linhas.map(emLinha).join('<br>')}</p>`;
  }).join('');
}

/** Campos que a IA deixou para preencher: [CPF], [endereço], [a comprovar…]. Não conta [1]. */
export function contarColchetes(texto: string): number {
  return (String(texto || '').match(/\[[^[\]\n]*[A-Za-zÀ-ÿ][^[\]\n]*\]/g) || []).length;
}

// ── versões ─────────────────────────────────────────────────────────────────

export function numeroDaVersao(nome: string): number {
  const m = String(nome || '').match(/\(v(\d+)/);
  return m ? Number(m[1]) : 1;
}

export function nomeVersaoDra(nomeBase: string, n: number): string {
  return `${String(nomeBase || 'Petição Inicial').replace(/\s*\(v\d+[^)]*\)\s*$/, '').trim()} (v${n} · edição da Dra.)`;
}

export type Segmento = { t: string; tipo: 'igual' | 'saiu' | 'entrou' };
export interface Par { esq: Segmento[]; dir: Segmento[] }

/** Sequência de operações da maior subsequência comum (iguais, só em a, só em b). */
function lcs<T>(a: T[], b: T[], igual: (x: T, y: T) => boolean): Array<['=' | '-' | '+', number]> {
  const n = a.length, m = b.length;
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i * (m + 1) + j] = igual(a[i], b[j]) ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
  }
  const ops: Array<['=' | '-' | '+', number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (igual(a[i], b[j])) { ops.push(['=', i]); i++; j++; }
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { ops.push(['-', i]); i++; }
    else { ops.push(['+', j]); j++; }
  }
  while (i < n) ops.push(['-', i++]);
  while (j < m) ops.push(['+', j++]);
  return ops;
}

function juntar(segs: Segmento[]): Segmento[] {
  const colar = (l: Segmento[]) => {
    const out: Segmento[] = [];
    for (const s of l) { const u = out[out.length - 1]; if (u && u.tipo === s.tipo) u.t += s.t; else if (s.t) out.push({ ...s }); }
    return out;
  };
  // Espaço ou palavrinha ("de", "o") igual no meio de uma troca entra na troca:
  // a frase trocada aparece inteira, não picotada palavra por palavra.
  let out = colar(segs);
  for (let mudou = true; mudou;) {
    mudou = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1], m = out[i], d = out[i + 1];
      if (m.tipo === 'igual' && a.tipo !== 'igual' && a.tipo === d.tipo && m.t.trim().length <= 3) { m.tipo = a.tipo; mudou = true; }
    }
    if (mudou) out = colar(out);
  }
  return out;
}

function diffPalavras(a: string, b: string): Par {
  if (!a) return { esq: [], dir: b ? [{ t: b, tipo: 'entrou' }] : [] };
  if (!b) return { esq: [{ t: a, tipo: 'saiu' }], dir: [] };
  const ta = a.split(/(\s+)/).filter((x) => x !== ''), tb = b.split(/(\s+)/).filter((x) => x !== '');
  if (ta.length * tb.length > 4_000_000) return { esq: [{ t: a, tipo: 'saiu' }], dir: [{ t: b, tipo: 'entrou' }] };
  const esq: Segmento[] = [], dir: Segmento[] = [];
  let j = 0;
  for (const [op, k] of lcs(ta, tb, (x, y) => x === y)) {
    if (op === '=') { esq.push({ t: ta[k], tipo: 'igual' }); dir.push({ t: tb[j], tipo: 'igual' }); j++; }
    else if (op === '-') esq.push({ t: ta[k], tipo: 'saiu' });
    else { dir.push({ t: tb[k], tipo: 'entrou' }); j = k + 1; }
  }
  return { esq: juntar(esq), dir: juntar(dir) };
}

/** Compara as versões por parágrafo e, nos que mudaram, palavra a palavra. */
export function compararTextos(antes: string, depois: string): { pares: Par[]; iguais: number } {
  const pars = (t: string) => String(t || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const a = pars(antes), b = pars(depois);
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const pares: Par[] = [];
  let iguais = 0, sai: string[] = [], entra: string[] = [];
  const fechar = () => { if (sai.length || entra.length) pares.push(diffPalavras(sai.join('\n\n'), entra.join('\n\n'))); sai = []; entra = []; };
  for (const [op, k] of lcs(a, b, (x, y) => norm(x) === norm(y))) {
    if (op === '=') { fechar(); iguais++; } else if (op === '-') sai.push(a[k]); else entra.push(b[k]);
  }
  fechar();
  return { pares, iguais };
}

// ── etapas da produção ──────────────────────────────────────────────────────

export interface FatosDaMesa {
  stage: string | null; relato: boolean; partesContrarias: number;
  checklist: { completos: number; total: number } | null; documentos: number;
  temPeticaoEquipe: boolean; colchetes: number | null; temVersaoDra: boolean;
  revisaoDepoisDaEdicao: boolean; pendenciasAbertas: number; temFinal: boolean; numeroProcesso: boolean;
}

const FASES = ['Preparação', 'Produção', 'Protocolo'];
export const ETAPAS_PRODUCAO = [
  { key: 'em_analise', nome: 'Em análise', fase: 0, fazer: 'Leia o relato e decida se o caso entra. A Dra. Helena cruza os documentos com a história contada.' },
  { key: 'separacao_documentos', nome: 'Separação de documentos', fase: 0, fazer: 'Complete os documentos do checklist. A Dra. Camila prepara a cobrança ao cliente pelo que falta, para você aprovar.' },
  { key: 'criacao_inicial', nome: 'Criação inicial', fase: 1, fazer: 'A equipe monta a petição. Revise, preencha os campos em amarelo e ajuste o que quiser: a sua edição vira uma nova versão, e a da equipe fica intacta para comparar.' },
  { key: 'revisao_inicial', nome: 'Revisão inicial', fase: 1, fazer: 'Leia o parecer da revisão automática e as citações conferidas pela Dra. Vera. Corrija na própria peça.' },
  { key: 'aguardando_protocolo', nome: 'Aguardando protocolo', fase: 2, fazer: 'Marque a versão final e copie para o Jusbrasil. A formatação vai junto.' },
  { key: 'protocolado', nome: 'Protocolado', fase: 2, fazer: 'Informe o número do processo. Os vigias dos tribunais passam a acompanhar o caso.' },
  { key: 'concluido', nome: 'Concluído', fase: 2, fazer: 'Produção encerrada. O caso segue na esteira processual: prazos, audiências e movimentações.' },
];

export function etapasDaMesa(f: FatosDaMesa) {
  const atual = ETAPAS_PRODUCAO.findIndex((e) => e.key === f.stage);
  const c = (txt: string, ok: boolean) => ({ txt, ok });
  const crit: Record<string, Array<{ txt: string; ok: boolean }>> = {
    em_analise: [c('Relato do caso cadastrado', f.relato), c('Parte contrária cadastrada', f.partesContrarias > 0)],
    separacao_documentos: [
      f.checklist && f.checklist.total
        ? c(`Checklist de documentos completo (${f.checklist.completos}/${f.checklist.total})`, f.checklist.completos >= f.checklist.total)
        : c('Documentos no caso', f.documentos > 0),
    ],
    criacao_inicial: [
      c('Petição montada pela equipe', f.temPeticaoEquipe),
      f.colchetes ? c(`Nenhum campo a preencher (faltam ${f.colchetes})`, false) : c('Nenhum campo a preencher', f.colchetes === 0),
      c('Sua revisão salva como nova versão', f.temVersaoDra),
    ],
    revisao_inicial: [
      c('Revisão automática feita depois da última edição', f.revisaoDepoisDaEdicao),
      f.pendenciasAbertas ? c(`Nenhuma pendência aberta (há ${f.pendenciasAbertas})`, false) : c('Nenhuma pendência aberta', true),
    ],
    aguardando_protocolo: [c('Versão final marcada', f.temFinal)],
    protocolado: [c('Número do processo informado', f.numeroProcesso)],
    concluido: [],
  };
  return {
    atual,
    etapas: ETAPAS_PRODUCAO.map((e, i) => ({
      key: e.key, nome: e.nome, fase: e.fase, faseNome: FASES[e.fase], fazer: e.fazer,
      estado: atual < 0 ? 'depois' : i < atual ? 'feito' : i === atual ? 'atual' : 'depois',
      criterios: crit[e.key],
    })),
  };
}

/** Onde a mesa abre em cada etapa: no trabalho daquele momento. */
export function abaDaEtapa(stage: string | null): { aba: 'caso' | 'docs' | 'peca'; parecerAoLado: boolean } {
  if (stage === 'separacao_documentos') return { aba: 'docs', parecerAoLado: false };
  if (stage === 'criacao_inicial' || stage === 'aguardando_protocolo') return { aba: 'peca', parecerAoLado: false };
  if (stage === 'revisao_inicial') return { aba: 'peca', parecerAoLado: true };
  return { aba: 'caso', parecerAoLado: false };
}

const ROTULO_COBRANCA: Record<string, string> = { docs_d2: '2 dias depois', docs_d5: '5 dias depois', docs_d10: '10 dias depois' };

/** Situação da coleta de documentos da Dra. Camila (o que pediu, o que chegou, cobranças preparadas). */
export function resumoColeta(
  coleta: { pedido_em: string | Date; concluido_em: string | Date | null; itens: unknown } | null,
  arquivos: string[], avisos: Array<{ marco: string; created_at: string | Date }>,
) {
  if (!coleta) return null;
  let itens: Array<{ label: string; keys: string[] }> = [];
  try { itens = typeof coleta.itens === 'string' ? JSON.parse(coleta.itens) : (coleta.itens as any) || []; } catch { itens = []; }
  const sem = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nomes = arquivos.map(sem);
  const lista = itens.map((i) => ({ label: i.label, recebido: nomes.some((n) => (i.keys || []).some((k) => n.includes(sem(k)))) }));
  return {
    pedidoEm: coleta.pedido_em, concluidoEm: coleta.concluido_em, concluida: !!coleta.concluido_em,
    itens: lista, total: lista.length, recebidos: lista.filter((i) => i.recebido).length,
    cobrancas: avisos.filter((a) => ROTULO_COBRANCA[a.marco])
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((a) => ({ rotulo: ROTULO_COBRANCA[a.marco], em: a.created_at })),
  };
}

/** Achados da Dra. Helena em ordem de gravidade. */
export function ordenarAchados(achados: unknown): Array<{ nivel: string; tema?: string; texto: string; fontes?: string[] }> {
  let lista: any[] = [];
  try { lista = typeof achados === 'string' ? JSON.parse(achados) : (Array.isArray(achados) ? achados : []); } catch { return []; }
  if (!Array.isArray(lista)) return [];
  const peso: Record<string, number> = { grave: 0, atencao: 1 };
  return lista.filter((a) => a && a.texto).sort((a, b) => (peso[a.nivel] ?? 2) - (peso[b.nivel] ?? 2));
}

// ── lições da equipe (comparação v-equipe × v-Dra.) ─────────────────────────

const lado = (s: Segmento[], marca: 'saiu' | 'entrou') => s.map((x) => (x.tipo === marca ? `⟦${x.t}⟧` : x.t)).join('').slice(0, 1500);

export function promptLicoes(area: string | null, pares: Par[]): string {
  return `Você é o redator da equipe de um escritório de advocacia (área: ${area || 'não informada'}). A advogada corrigiu a petição inicial que a equipe redigiu. Compare cada trecho (⟦entre colchetes duplos⟧ está o que saiu ou entrou) e anote o que a equipe deve aprender para as próximas petições deste tipo.

${pares.slice(0, 25).map((p, i) => `TRECHO ${i + 1}\nANTES (equipe): ${lado(p.esq, 'saiu') || '(nada)'}\nDEPOIS (advogada): ${lado(p.dir, 'entrou') || '(removido)'}`).join('\n\n')}

Regras:
- Uma lição por correção que se repete em outros casos (endereçamento, pedidos, tese, estrutura, estilo, cálculo, provas).
- NÃO é lição preencher dado deste caso (CPF, RG, nome, endereço, número de contrato, datas e valores do cliente), a não ser que revele um padrão (ex.: "sempre pedir prioridade para idoso").
- "regra": uma frase geral e direta que a equipe consegue seguir sozinha na próxima peça.
- No máximo 8. Sem nada a aprender: lista vazia.
Responda SOMENTE com JSON: {"licoes":[{"titulo":"assunto curto","mudou":"o que a advogada mudou, em uma frase","regra":"a regra para as próximas peças"}]}`;
}

export function parseLicoes(texto: string): Array<{ titulo: string; mudou: string; regra: string }> {
  const t = String(texto || '');
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return [];
  let o: any;
  try { o = JSON.parse(t.slice(ini, fim + 1)); } catch { return []; }
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  return (Array.isArray(o?.licoes) ? o.licoes : [])
    .map((l: any) => ({ titulo: s(l?.titulo, 200), mudou: s(l?.mudou, 600), regra: s(l?.regra, 600) }))
    .filter((l: any) => l.titulo && l.mudou && l.regra)
    .slice(0, 8);
}
