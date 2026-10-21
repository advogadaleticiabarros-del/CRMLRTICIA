import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { abrirAcervo, type Acervo } from './leisAcervo';
import { PASTAS_DO_ACERVO, VERSAO_REGRAS, caminhoNoAcervo } from './leisTexto';

/**
 * Pesquisa de Leis — baixa e atualiza o acervo (github.com/ctresb/leis).
 *
 * Só a versão atual (`--depth 1`), sem baixar arquivo fora das pastas do
 * acervo (`--filter=blob:none --sparse`). Na 1ª vez, ou se o índice sair de
 * sincronia, confere tudo; depois, reindexa só o que o `git diff` entre o
 * commit indexado e o novo mostra. Roda num PROCESSO SEPARADO
 * (scripts/leisAtualizar), porque indexar milhares de arquivos travaria o CRM.
 */

export const REPO_LEIS = 'https://github.com/ctresb/leis.git';
/** Nomes de arquivo que o Windows não aceita (só para testar no computador). */
const NOMES_INVALIDOS_WINDOWS = ['!*"*', '!*:*', '!*\\?*', '!*<*', '!*>*', '!*|*'];

export interface DepsSync {
  dir: string;
  acervo: Acervo;
  windows: boolean;
  git(args: string[]): Promise<string>;
  existe(caminho: string): boolean;
  listar(dir: string): string[];
  lerArquivo(caminho: string): string;
  log?(msg: string): void;
}

export interface ResumoAtualizacao {
  commit: string;
  anterior: string | null;
  completo: boolean;
  semMudanca: boolean;
  novos: number;
  atualizados: number;
  iguais: number;
  removidos: number;
  erros: number;
  segundos: number;
}

export async function atualizarAcervo(deps: DepsSync, opts: { completo?: boolean } = {}): Promise<ResumoAtualizacao> {
  const inicio = Date.now();
  const { acervo } = deps;
  const padroes = PASTAS_DO_ACERVO.concat(deps.windows ? NOMES_INVALIDOS_WINDOWS : []);
  const pastas = JSON.stringify(padroes);
  const C = (...a: string[]) => ['-C', deps.dir, ...a];
  let completo = !!opts.completo;
  let anterior: string | null = null;

  if (!deps.existe(`${deps.dir}/.git`)) {
    await deps.git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', REPO_LEIS, deps.dir]);
    await deps.git(C('sparse-checkout', 'set', '--no-cone', ...padroes));
    completo = true;
  } else {
    if (acervo.lerMeta('pastas') !== pastas) { await deps.git(C('sparse-checkout', 'set', '--no-cone', ...padroes)); completo = true; }
    anterior = (await deps.git(C('rev-parse', 'HEAD'))).trim();
    await deps.git(C('fetch', '--depth', '1', 'origin', 'main'));
    await deps.git(C('reset', '--hard', 'FETCH_HEAD'));
  }
  const commit = (await deps.git(C('rev-parse', 'HEAD'))).trim();
  if (acervo.lerMeta('commit') !== anterior) completo = true; // índice não corresponde ao que estava baixado
  if (acervo.lerMeta('versao_regras') !== String(VERSAO_REGRAS)) { acervo.esquecerHashes(); completo = true; }

  const r: ResumoAtualizacao = { commit, anterior, completo, semMudanca: false, novos: 0, atualizados: 0, iguais: 0, removidos: 0, erros: 0, segundos: 0 };
  const indexar = (caminhos: string[]) => {
    for (let i = 0; i < caminhos.length; i += 400) {
      acervo.transacao(() => {
        for (const c of caminhos.slice(i, i + 400)) {
          try {
            const s = acervo.indexarArquivo(c, deps.lerArquivo(`${deps.dir}/${c}`));
            if (s === 'novo') r.novos++; else if (s === 'atualizado') r.atualizados++; else if (s === 'igual') r.iguais++;
          } catch { r.erros++; }
        }
      });
      if (i % 8000 === 0) deps.log?.(`leis: ${Math.min(i + 400, caminhos.length)}/${caminhos.length}`);
    }
  };
  const remover = (caminhos: string[]) => acervo.transacao(() => { for (const c of caminhos) if (acervo.removerNorma(c)) r.removidos++; });

  if (!completo && anterior === commit) {
    r.semMudanca = true;
  } else if (!completo) {
    try {
      const saida = await deps.git(C('diff', '--name-status', '--no-renames', '-z', anterior!, commit));
      const partes = saida.split('\0').filter((x) => x !== '');
      const mudou: string[] = [], saiu: string[] = [];
      for (let i = 0; i + 1 < partes.length; i += 2) {
        const [st, c] = [partes[i], partes[i + 1]];
        if (!caminhoNoAcervo(c)) continue;
        (st.startsWith('D') ? saiu : mudou).push(c);
      }
      indexar(mudou);
      remover(saiu);
    } catch {
      r.completo = completo = true;
    }
  }
  if (completo) {
    const todos = deps.listar(deps.dir).filter(caminhoNoAcervo);
    indexar(todos);
    const existentes = new Set(todos);
    remover(acervo.caminhos().filter((c) => !existentes.has(c)));
  }

  acervo.definirMeta('commit', commit);
  acervo.definirMeta('pastas', pastas);
  acervo.definirMeta('versao_regras', String(VERSAO_REGRAS));
  acervo.definirMeta('atualizado_em', new Date().toISOString());
  r.segundos = Math.round((Date.now() - inicio) / 1000);
  return r;
}

// ── Execução real (processo separado) ──────────────────────────────────────
export function pastasLeis() {
  const base = process.env.LEIS_DIR || path.join(os.homedir(), 'leis');
  return { base, repo: path.join(base, 'acervo'), db: path.join(base, 'acervo.db'), trava: path.join(base, 'atualizando.lock') };
}

function listarArquivos(raiz: string): string[] {
  const out: string[] = [];
  const andar = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) andar(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  if (fs.existsSync(raiz)) andar(raiz, '');
  return out;
}

function depsReais(acervo: Acervo, dir: string): DepsSync {
  return {
    dir: dir.replace(/\\/g, '/'),
    acervo,
    windows: process.platform === 'win32',
    git: (args) => new Promise((ok, falha) => execFile('git', args, {
      maxBuffer: 512 * 1024 * 1024, timeout: 60 * 60 * 1000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (e, saida, erro) => (e ? falha(new Error(`git ${args.filter((a) => a !== '-C').slice(1, 3).join(' ')}: ${String(erro || e.message).trim().slice(-400)}`)) : ok(String(saida))))),
    existe: (p) => fs.existsSync(p),
    listar: listarArquivos,
    lerArquivo: (p) => fs.readFileSync(p, 'utf8'),
    log: (m) => console.log(m),
  };
}

/** Atualiza com trava (duas atualizações ao mesmo tempo nunca rodam). */
export async function executarAtualizacao(opts: { completo?: boolean } = {}): Promise<ResumoAtualizacao | { emAndamento: true }> {
  const p = pastasLeis();
  fs.mkdirSync(p.base, { recursive: true });
  try {
    const st = fs.statSync(p.trava);
    if (Date.now() - st.mtimeMs < 3 * 60 * 60 * 1000) return { emAndamento: true };
  } catch { /* sem trava */ }
  fs.writeFileSync(p.trava, String(process.pid));
  const acervo = abrirAcervo(p.db);
  try {
    return await atualizarAcervo(depsReais(acervo, p.repo), opts);
  } finally {
    acervo.fechar();
    try { fs.unlinkSync(p.trava); } catch { /* ok */ }
  }
}
