/**
 * Pasta do Drive do caso (30/10/2026, caso do Valmirio): traz para o caso os
 * arquivos novos da pasta, inclusive das subpastas, com o texto lido pela IA.
 *
 * Antes, qualquer falha do Google (pasta não compartilhada com a conta do CRM,
 * permissão faltando, conexão expirada) virava "pasta vazia" em silêncio. Agora a
 * falha volta como mensagem em português para a tela e para o sino.
 *
 * Dependências injetadas (Drive, banco, IA): a ligação real fica em pastaDriveMysql.ts.
 */

export type ArquivoDrive = { id: string; name: string; mimeType: string };

export type DepsPastaDrive = {
  /** Filhos diretos da pasta (arquivos e subpastas). Lança erro se o Google recusar. */
  listarFilhos(pastaId: string): Promise<ArquivoDrive[]>;
  /** O caso já tem documento com esse nome (ou com esse nome de chegada)? */
  jaTem(caseId: number, nome: string): Promise<boolean>;
  /** Baixa e lê o arquivo; null quando não é legível (vídeo, planilha...). */
  ler(arquivo: ArquivoDrive): Promise<string | null>;
  gravar(doc: { caseId: number; clientId: number | null; nome: string; link: string; conteudo: string | null; actorId: number }): Promise<void>;
};

const MIME_PASTA = 'application/vnd.google-apps.folder';
const LIMITE_ARQUIVOS = 300;

export function idDaPasta(url: string): string | null {
  const s = String(url || '').trim();
  if (!s) return null;
  const m = s.match(/\/folders\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

/** Todos os arquivos da pasta, descendo pelas subpastas. */
export async function listarPasta(listarFilhos: DepsPastaDrive['listarFilhos'], pastaId: string): Promise<ArquivoDrive[]> {
  const arquivos: ArquivoDrive[] = [];
  const fila = [pastaId];
  const vistas = new Set<string>();
  while (fila.length && arquivos.length < LIMITE_ARQUIVOS) {
    const id = fila.shift()!;
    if (vistas.has(id)) continue;
    vistas.add(id);
    for (const f of await listarFilhos(id)) {
      if (f.mimeType === MIME_PASTA) fila.push(f.id);
      else arquivos.push(f);
    }
  }
  return arquivos.slice(0, LIMITE_ARQUIVOS);
}

/** Traduz a falha do Google para o que a equipe precisa fazer. */
export function erroDoDrive(e: any, contaCrm?: string | null): string {
  const msg = String(e?.message || e || '');
  const code = Number(e?.code || e?.status || e?.response?.status) || 0;
  const conta = contaCrm ? ` (${contaCrm})` : '';
  if (/não conectado/i.test(msg)) return 'O Google do CRM não está conectado. Conecte em Parcerias → Gmail da parceria.';
  if (/invalid_grant|token.*(expired|revoked)/i.test(msg)) return 'A conexão do CRM com o Google expirou. Reconecte em Parcerias → Gmail da parceria.';
  if (code === 403 && /scope/i.test(msg)) return 'O CRM não tem permissão de ler o Drive. Reconecte o Google em Parcerias → Gmail da parceria e aceite o acesso ao Drive.';
  if (code === 404 || /not found/i.test(msg)) return `A pasta não foi encontrada ou não está compartilhada com a conta Google do CRM${conta}. No Drive, compartilhe a pasta com essa conta e tente de novo.`;
  if (code === 403) return `O Google negou acesso à pasta. Compartilhe a pasta com a conta Google do CRM${conta} e tente de novo.`;
  return `Não consegui ler a pasta do Drive: ${msg || 'erro desconhecido'}`;
}

export type ResultadoPasta = { novos: string[]; erro?: string };

/** Andamento para a barra da tela: (vistos, total, arquivo que está sendo lido ou null). */
export type ProgressoPasta = (feito: number, total: number, nome: string | null) => void;

export async function sincronizarPasta(
  deps: DepsPastaDrive,
  caso: { caseId: number; clientId: number | null; folderUrl: string; actorId: number; pastaId?: string },
  contaCrm?: string | null,
  progresso?: ProgressoPasta,
): Promise<ResultadoPasta> {
  const pastaId = caso.pastaId || idDaPasta(caso.folderUrl);
  if (!pastaId) return { novos: [], erro: 'O link da pasta do Drive não é válido. Copie o link da pasta (drive.google.com/drive/folders/...).' };
  let arquivos: ArquivoDrive[];
  try { arquivos = await listarPasta(deps.listarFilhos, pastaId); }
  catch (e) { return { novos: [], erro: erroDoDrive(e, contaCrm) }; }

  const novos: string[] = [];
  const avisar: ProgressoPasta = (a, b, c) => { try { progresso?.(a, b, c); } catch { /* a barra nunca derruba a leitura */ } };
  avisar(0, arquivos.length, null);
  for (const [i, f] of arquivos.entries()) {
    if (await deps.jaTem(caso.caseId, f.name)) continue;
    avisar(i, arquivos.length, f.name);
    let conteudo: string | null = null;
    try { conteudo = await deps.ler(f); } catch { conteudo = null; } // fica o link; a leitura tenta de novo depois
    await deps.gravar({ caseId: caso.caseId, clientId: caso.clientId, nome: f.name, link: `https://drive.google.com/file/d/${f.id}/view`, conteudo, actorId: caso.actorId });
    novos.push(f.name);
  }
  avisar(arquivos.length, arquivos.length, null);
  return { novos };
}
