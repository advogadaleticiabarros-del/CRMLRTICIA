import { createHash } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  lerNorma, dividirEmDispositivos, caminhoNoAcervo, extrairCitacoes, interpretarPergunta, montarConsulta,
  ordenarResultados, formatarCitacao, avaliarCitacao, semAcento,
  type Citacao, type RefNorma, type ResultadoBusca, type ResultadoConferencia, type Fundamento, type Esfera,
} from './leisTexto';

/**
 * Pesquisa de Leis — o índice (SQLite embutido do Node, busca FTS5 sem acento).
 *
 * Fica FORA do MySQL do CRM de propósito: são centenas de milhares de artigos
 * que o backup diário não precisa levar (o acervo se refaz do GitHub). Um
 * arquivo só (`acervo.db`), aberto por quem lê (o servidor) e por quem escreve
 * (o processo de atualização, em segundo plano), em modo WAL.
 *
 *   abrirAcervo(caminho) → indexarArquivo, removerNorma, buscar, norma,
 *   dispositivo, conferir, fundamentos, resumo, lerMeta/definirMeta.
 */

export interface Filtros {
  esferas?: Esfera[];
  vigentes?: boolean;
  uf?: string;
}

export interface ItemBusca extends ResultadoBusca { exato?: boolean }

export interface NormaDetalhe {
  id: number; caminho: string; titulo: string; tipo: string; tipoChave: string; numero: string; ano: number | null;
  data: string | null; ementa: string; situacao: string; revogada: boolean; uf: string | null; tribunal: string | null;
  orgao: string | null; esfera: Esfera; fonte: string; versao: string; apelido: string | null;
  dispositivos: { id: number; rotulo: string; numero: string; revogado: boolean; parte: number; principal: boolean }[];
}

export interface Acervo {
  indexarArquivo(caminho: string, md: string): 'novo' | 'igual' | 'atualizado' | 'ignorado';
  removerNorma(caminho: string): boolean;
  /** Faz a próxima indexação reler todos os arquivos (regras de leitura novas). */
  esquecerHashes(): void;
  transacao<T>(fn: () => T): T;
  caminhos(): string[];
  localizarNorma(ref: RefNorma): { id: number; titulo: string } | null;
  buscar(q: string, filtros?: Filtros, limite?: number): ItemBusca[];
  norma(id: number): NormaDetalhe | null;
  dispositivo(id: number): { id: number; normaId: number; rotulo: string; numero: string; revogado: boolean; texto: string; citacao: string; titulo: string; fonte: string } | null;
  conferir(texto: string): (ResultadoConferencia & { normaId?: number; tipo: Citacao['tipo'] })[];
  fundamentos(citacoes: string[]): Fundamento[];
  resumo(): { normas: number; dispositivos: number; porEsfera: Record<string, number>; commit: string | null; atualizadoEm: string | null };
  lerMeta(chave: string): string | null;
  definirMeta(chave: string, valor: string): void;
  fechar(): void;
}

interface LinhaNorma {
  id: number; caminho: string; titulo: string; tipo: string; tipo_chave: string; numero: string; ano: number | null; data: string | null;
  ementa: string; situacao: string; revogada: number; uf: string | null; tribunal: string | null; orgao: string | null;
  esfera: Esfera; fonte: string; versao: string; apelido: string | null;
}
interface LinhaDisp { id: number; norma_id: number; rotulo: string; numero: string; revogado: number; parte: number; principal: number }

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS normas (
  id INTEGER PRIMARY KEY, caminho TEXT NOT NULL UNIQUE, hash TEXT, titulo TEXT, tipo TEXT, tipo_chave TEXT, numero TEXT,
  ano INTEGER, data TEXT, ementa TEXT, situacao TEXT, revogada INTEGER, uf TEXT, tribunal TEXT, orgao TEXT, esfera TEXT,
  fonte TEXT, urn TEXT, versao TEXT, apelido TEXT);
CREATE INDEX IF NOT EXISTS normas_ref ON normas(tipo_chave, numero);
CREATE TABLE IF NOT EXISTS dispositivos (
  id INTEGER PRIMARY KEY, norma_id INTEGER NOT NULL, ordem INTEGER, parte INTEGER, principal INTEGER, rotulo TEXT, numero TEXT, revogado INTEGER);
CREATE INDEX IF NOT EXISTS disp_norma ON dispositivos(norma_id, numero);
CREATE VIRTUAL TABLE IF NOT EXISTS busca USING fts5(rotulo, cabecalho, texto, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT);
`;

const JURIS: Citacao['tipo'][] = ['sumula', 'sumula_vinculante', 'oj', 'tema_rg', 'tema_rep'];
const chaveTrecho = (t: string) => semAcento(t).toLowerCase().replace(/\s+/g, ' ').trim();

export function abrirAcervo(caminho: string): Acervo {
  const db = new DatabaseSync(caminho);
  if (caminho !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
  }
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(ESQUEMA);

  const st = {
    hash: db.prepare('SELECT id, hash FROM normas WHERE caminho = ?'),
    upsert: db.prepare(`INSERT INTO normas (caminho, hash, titulo, tipo, tipo_chave, numero, ano, data, ementa, situacao, revogada, uf, tribunal, orgao, esfera, fonte, urn, versao, apelido)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(caminho) DO UPDATE SET hash = excluded.hash, titulo = excluded.titulo, tipo = excluded.tipo, tipo_chave = excluded.tipo_chave,
        numero = excluded.numero, ano = excluded.ano, data = excluded.data, ementa = excluded.ementa, situacao = excluded.situacao,
        revogada = excluded.revogada, uf = excluded.uf, tribunal = excluded.tribunal, orgao = excluded.orgao, esfera = excluded.esfera,
        fonte = excluded.fonte, urn = excluded.urn, versao = excluded.versao, apelido = excluded.apelido
      RETURNING id`),
    apagarBusca: db.prepare('DELETE FROM busca WHERE rowid IN (SELECT id FROM dispositivos WHERE norma_id = ?)'),
    apagarDisp: db.prepare('DELETE FROM dispositivos WHERE norma_id = ?'),
    apagarNorma: db.prepare('DELETE FROM normas WHERE id = ?'),
    inserirDisp: db.prepare('INSERT INTO dispositivos (norma_id, ordem, parte, principal, rotulo, numero, revogado) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'),
    inserirBusca: db.prepare('INSERT INTO busca (rowid, rotulo, cabecalho, texto) VALUES (?, ?, ?, ?)'),
    normaPorId: db.prepare('SELECT * FROM normas WHERE id = ?'),
    dispsDaNorma: db.prepare('SELECT id, norma_id, rotulo, numero, revogado, parte, principal FROM dispositivos WHERE norma_id = ? ORDER BY ordem'),
    dispPorId: db.prepare('SELECT id, norma_id, rotulo, numero, revogado, parte, principal FROM dispositivos WHERE id = ?'),
    texto: db.prepare('SELECT texto FROM busca WHERE rowid = ?'),
    lerMeta: db.prepare('SELECT valor FROM meta WHERE chave = ?'),
    definirMeta: db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'),
  };

  const textoDe = (id: number) => String((st.texto.get(id) as any)?.texto || '');
  const paraCitar = (n: LinhaNorma) => ({ titulo: n.titulo, apelido: n.apelido, tipoChave: n.tipo_chave, numero: n.numero, ano: n.ano, uf: n.uf, esfera: n.esfera });

  function localizar(ref: RefNorma): LinhaNorma | null {
    if (ref.tipo === 'cf') return (db.prepare("SELECT * FROM normas WHERE caminho = 'constituicao.md'").get() as any) || null;
    if (ref.tipo === 'ce') return (db.prepare("SELECT * FROM normas WHERE tipo_chave = 'ce' AND uf = ? LIMIT 1").get(ref.uf || 'ES') as any) || null;
    if (!ref.numero) return null;
    const esfera = ref.uf ? 'estadual' : 'federal';
    const tipos = ref.tipo === 'decreto' ? ['decreto', 'dl'] : [ref.tipo];
    const ordem = "ORDER BY (caminho LIKE 'federal/regulamentos/%') DESC, (tipo_chave = ?) DESC, ano DESC LIMIT 1";
    const ph = tipos.map(() => '?').join(',');
    if (ref.ano) {
      const r = db.prepare(`SELECT * FROM normas WHERE tipo_chave IN (${ph}) AND numero = ? AND ano = ? AND esfera = ? ${ordem}`).get(...tipos, ref.numero, ref.ano, esfera, ref.tipo);
      return (r as any) || null;
    }
    const r = db.prepare(`SELECT * FROM normas WHERE tipo_chave IN (${ph}) AND numero = ? AND esfera = ? ${ordem}`).get(...tipos, ref.numero, esfera, ref.tipo);
    return (r as any) || null;
  }

  function localizarJuris(tipo: string, tribunal: string, numero: string): LinhaNorma | null {
    return (db.prepare('SELECT * FROM normas WHERE tipo_chave = ? AND tribunal = ? AND numero = ? LIMIT 1').get(tipo, tribunal, numero) as any) || null;
  }

  /** Os artigos pedidos da norma; na dúvida (número repetido), o da parte principal — no ADCT, o da outra. */
  function artigosDe(normaId: number, numeros: string[], parte?: 'adct'): LinhaDisp[] {
    if (!numeros.length) return [];
    const ph = numeros.map(() => '?').join(',');
    const linhas = db.prepare(`SELECT id, norma_id, rotulo, numero, revogado, parte, principal FROM dispositivos WHERE norma_id = ? AND numero IN (${ph}) ORDER BY ordem`)
      .all(normaId, ...numeros) as unknown as LinhaDisp[];
    return numeros.map((num) => {
      const cand = linhas.filter((l) => l.numero === num);
      if (parte === 'adct') return cand.find((l) => !l.principal) || null;
      return cand.find((l) => l.principal) || cand[0] || null;
    }).filter((x): x is LinhaDisp => !!x);
  }

  interface Resolvido { citacao: Citacao; norma: LinhaNorma | null; disps: LinhaDisp[]; resultado: ResultadoConferencia & { normaId?: number; tipo: Citacao['tipo'] } }

  function resolver(c: Citacao): Resolvido {
    if (JURIS.includes(c.tipo)) {
      const norma = localizarJuris(c.tipo, c.tribunal!, c.numero!);
      const disps = norma ? (st.dispsDaNorma.all(norma.id) as unknown as LinhaDisp[]) : [];
      const situacao = !norma ? 'fora_do_acervo' : norma.revogada ? 'norma_revogada' : 'confere';
      return {
        citacao: c, norma, disps,
        resultado: { tipo: c.tipo, trecho: c.trecho, detalhe: c.detalhe, situacao, normaId: norma?.id, citacao: norma?.titulo, fonte: norma?.fonte, texto: disps.length ? disps.map((d) => textoDe(d.id)).join('\n\n').slice(0, 8000) : undefined },
      };
    }
    const norma = localizar(c.norma!);
    const disps = norma ? artigosDe(norma.id, c.artigos, c.norma!.parte) : [];
    const av = avaliarCitacao(norma ? { revogada: !!norma.revogada } : null, disps.map((d) => ({ numero: d.numero, revogado: !!d.revogado })), c.artigos);
    const base = norma ? { ...paraCitar(norma), apelido: c.norma!.parte === 'adct' ? 'ADCT' : norma.apelido } : null;
    const citacao = base ? (disps.length ? disps.map((d) => formatarCitacao(base, d)).join('; ') : formatarCitacao(base, null)) : undefined;
    const texto = disps.length ? disps.map((d) => textoDe(d.id)).join('\n\n').slice(0, 8000) : norma && !c.artigos.length ? (norma.ementa || undefined) : undefined;
    return { citacao: c, norma, disps, resultado: { tipo: c.tipo, trecho: c.trecho, detalhe: c.detalhe, situacao: av.situacao, normaId: norma?.id, citacao, fonte: norma?.fonte, texto } };
  }

  function linhaParaItem(r: any, exato = false): ItemBusca {
    return {
      dispositivoId: r.dispositivoId, normaId: r.normaId, titulo: r.titulo, rotulo: r.rotulo, trecho: r.trecho, esfera: r.esfera,
      tipoChave: r.tipo_chave, apelido: r.apelido, uf: r.uf, tribunal: r.tribunal, fonte: r.fonte, revogado: !!r.revogado,
      normaRevogada: !!r.revogada, relevancia: Number(r.relevancia) || 0, ...(exato ? { exato: true } : {}),
    };
  }

  function exatos(q: string): ItemBusca[] {
    let cits = interpretarPergunta(q);
    if (!cits.length) cits = extrairCitacoes(q).filter((c) => c.tipo === 'norma');
    const out: ItemBusca[] = [];
    for (const c of cits.slice(0, 5)) {
      const r = resolver(c);
      if (!r.norma) continue;
      const alvos = r.disps.length ? r.disps : (st.dispsDaNorma.all(r.norma.id) as unknown as LinhaDisp[]).slice(0, 1);
      for (const d of alvos) {
        out.push(linhaParaItem({
          dispositivoId: d.id, normaId: r.norma.id, titulo: r.norma.titulo, rotulo: d.rotulo, trecho: textoDe(d.id).slice(0, 400),
          esfera: r.norma.esfera, tipo_chave: r.norma.tipo_chave, apelido: r.norma.apelido, uf: r.norma.uf, tribunal: r.norma.tribunal,
          fonte: r.norma.fonte, revogado: d.revogado, revogada: r.norma.revogada, relevancia: 1e6,
        }, true));
      }
    }
    return out;
  }

  function porPalavras(q: string, f: Filtros, ou: boolean): ItemBusca[] {
    const expr = montarConsulta(q, { ou });
    if (!expr) return [];
    const where: string[] = ['busca MATCH ?'];
    const args: any[] = [expr];
    if (f.esferas?.length) { where.push(`n.esfera IN (${f.esferas.map(() => '?').join(',')})`); args.push(...f.esferas); }
    if (f.vigentes) where.push('n.revogada = 0 AND d.revogado = 0');
    if (f.uf) { where.push('(n.uf IS NULL OR n.uf = ?)'); args.push(f.uf); }
    const sql = `SELECT d.id AS dispositivoId, n.id AS normaId, n.titulo, d.rotulo, snippet(busca, 2, '[[', ']]', '…', 28) AS trecho,
        n.esfera, n.tipo_chave, n.apelido, n.uf, n.tribunal, n.fonte, d.revogado, n.revogada, -bm25(busca, 1.0, 0.4, 1.0) AS relevancia
      FROM busca JOIN dispositivos d ON d.id = busca.rowid JOIN normas n ON n.id = d.norma_id
      WHERE ${where.join(' AND ')} ORDER BY bm25(busca, 1.0, 0.4, 1.0) LIMIT 300`;
    try {
      return (db.prepare(sql).all(...args) as any[]).map((r) => linhaParaItem(r));
    } catch { return []; }
  }

  const acervo: Acervo = {
    transacao<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },

    indexarArquivo(caminho, md) {
      if (!caminhoNoAcervo(caminho)) return 'ignorado';
      const hash = createHash('sha256').update(md).digest('hex');
      const antes = st.hash.get(caminho) as any;
      if (antes?.hash === hash) return 'igual';
      const n = lerNorma(caminho, md);
      const disps = dividirEmDispositivos(n);
      const { id } = st.upsert.get(n.caminho, hash, n.titulo, n.tipo, n.tipoChave, n.numero, n.ano, n.data, n.ementa, n.situacao,
        n.revogada ? 1 : 0, n.uf, n.tribunal, n.orgao, n.esfera, n.fonte, n.urn, n.versao, n.apelido) as any;
      st.apagarBusca.run(id);
      st.apagarDisp.run(id);
      const cabecalho = [n.titulo, n.apelido, n.ementa, n.tribunal].filter(Boolean).join(' · ');
      for (const d of disps) {
        const { id: did } = st.inserirDisp.get(id, d.ordem, d.parte, d.principal ? 1 : 0, d.rotulo, d.numero, d.revogado ? 1 : 0) as any;
        st.inserirBusca.run(did, d.rotulo, cabecalho, d.texto);
      }
      return antes ? 'atualizado' : 'novo';
    },

    removerNorma(caminho) {
      const antes = st.hash.get(caminho) as any;
      if (!antes) return false;
      st.apagarBusca.run(antes.id);
      st.apagarDisp.run(antes.id);
      st.apagarNorma.run(antes.id);
      return true;
    },

    localizarNorma(ref) {
      const n = localizar(ref);
      return n ? { id: n.id, titulo: n.titulo } : null;
    },

    esquecerHashes() { db.exec('UPDATE normas SET hash = NULL'); },

    caminhos() {
      return (db.prepare('SELECT caminho FROM normas').all() as any[]).map((r) => r.caminho);
    },

    buscar(q, filtros = {}, limite = 40) {
      const ex = exatos(q);
      let pal = porPalavras(q, filtros, false);
      if (!pal.length && !ex.length) pal = porPalavras(q, filtros, true);
      const vistos = new Set(ex.map((x) => x.dispositivoId));
      return [...ex, ...ordenarResultados(pal.filter((x) => !vistos.has(x.dispositivoId)))].slice(0, limite);
    },

    norma(id) {
      const n = st.normaPorId.get(id) as unknown as LinhaNorma | undefined;
      if (!n) return null;
      const ds = st.dispsDaNorma.all(id) as unknown as LinhaDisp[];
      return {
        id: n.id, caminho: n.caminho, titulo: n.titulo, tipo: n.tipo, tipoChave: n.tipo_chave, numero: n.numero, ano: n.ano, data: n.data,
        ementa: n.ementa, situacao: n.situacao, revogada: !!n.revogada, uf: n.uf, tribunal: n.tribunal, orgao: n.orgao, esfera: n.esfera,
        fonte: n.fonte, versao: n.versao, apelido: n.apelido,
        dispositivos: ds.map((d) => ({ id: d.id, rotulo: d.rotulo, numero: d.numero, revogado: !!d.revogado, parte: d.parte, principal: !!d.principal })),
      };
    },

    dispositivo(id) {
      const d = st.dispPorId.get(id) as unknown as LinhaDisp | undefined;
      if (!d) return null;
      const n = st.normaPorId.get(d.norma_id) as unknown as LinhaNorma;
      const base = { ...paraCitar(n), apelido: n.caminho === 'constituicao.md' && !d.principal ? 'ADCT' : n.apelido };
      return {
        id: d.id, normaId: n.id, rotulo: d.rotulo, numero: d.numero, revogado: !!d.revogado, texto: textoDe(d.id),
        citacao: formatarCitacao(base, d), titulo: n.titulo, fonte: n.fonte,
      };
    },

    conferir(texto) {
      const vistos = new Set<string>();
      const out: ReturnType<Acervo['conferir']> = [];
      for (const c of extrairCitacoes(texto)) {
        const k = chaveTrecho(c.trecho);
        if (vistos.has(k)) continue;
        vistos.add(k);
        out.push(resolver(c).resultado);
      }
      return out;
    },

    fundamentos(citacoes) {
      const out: Fundamento[] = [];
      const vistos = new Set<string>();
      for (const txt of citacoes) {
        let cits = extrairCitacoes(txt);
        if (!cits.length) cits = interpretarPergunta(txt);
        for (const c of cits) {
          const r = resolver(c);
          if (r.resultado.situacao !== 'confere' || !r.norma) continue;
          if (JURIS.includes(c.tipo)) {
            if (vistos.has(r.norma.titulo)) continue;
            vistos.add(r.norma.titulo);
            out.push({ citacao: r.norma.titulo, texto: r.resultado.texto || '', fonte: r.norma.fonte });
            continue;
          }
          const base = { ...paraCitar(r.norma), apelido: c.norma!.parte === 'adct' ? 'ADCT' : r.norma.apelido };
          for (const d of r.disps) {
            const cit = formatarCitacao(base, d);
            if (vistos.has(cit)) continue;
            vistos.add(cit);
            out.push({ citacao: cit, texto: textoDe(d.id), fonte: r.norma.fonte });
          }
        }
      }
      return out;
    },

    resumo() {
      const tot = db.prepare('SELECT COUNT(*) AS n FROM normas').get() as any;
      const disp = db.prepare('SELECT COUNT(*) AS n FROM dispositivos').get() as any;
      const porEsfera: Record<string, number> = {};
      for (const r of db.prepare('SELECT esfera, COUNT(*) AS n FROM normas GROUP BY esfera').all() as any[]) porEsfera[r.esfera] = Number(r.n);
      return { normas: Number(tot.n), dispositivos: Number(disp.n), porEsfera, commit: acervo.lerMeta('commit'), atualizadoEm: acervo.lerMeta('atualizado_em') };
    },

    lerMeta(chave) { return ((st.lerMeta.get(chave) as any)?.valor ?? null) as string | null; },
    definirMeta(chave, valor) { st.definirMeta.run(chave, valor); },
    fechar() { db.close(); },
  };
  return acervo;
}
