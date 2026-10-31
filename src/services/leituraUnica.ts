import { createHash } from 'crypto';

/**
 * Leitura única (pedido da Jessica, 30/10/2026: "os documentos de todos os processos do
 * Valmiro são os mesmos, leia uma vez só"). O que a IA já leu fica guardado pelo
 * CONTEÚDO, não pelo documento: o mesmo PDF juntado em várias ações, ou a mesma pasta
 * de documentos do cliente, não volta para a IA. A memória entra por `CacheLeitura`
 * (documento_leituras no banco, em esteiraPecaMysql.ts).
 */

export interface CacheLeitura {
  buscar(ref: string): Promise<string | null>;
  guardar(ref: string, fonte: string, texto: string): Promise<void>;
}

const sha1 = (partes: Array<string | Buffer>) => {
  const h = createHash('sha1');
  for (const p of partes) h.update(p);
  return h.digest('hex');
};

/** Referência do conteúdo para a memória (cabe nos 60 caracteres de documento_leituras.ref). */
export function refDoConteudo(prefixo: string, ...conteudo: Array<string | Buffer>): string {
  return `${prefixo.slice(0, 18)}:${sha1(conteudo)}`;
}

/** Lê pela IA só se esse conteúdo nunca foi lido. Leitura que falhou (null/vazia) não fica guardada. */
export async function lerUmaVez(cache: CacheLeitura, ref: string, fonte: string, ler: () => Promise<string | null>): Promise<string | null> {
  const guardado = await cache.buscar(ref).catch(() => null);
  if (guardado) return guardado;
  const texto = await ler();
  if (texto && texto.trim()) await cache.guardar(ref, fonte, texto).catch(() => {});
  return texto;
}

/**
 * Chave da leitura dos documentos do cliente: muda só quando muda o conteúdo de algum
 * documento (nome e ordem não contam; o mesmo conteúdo repetido conta uma vez). Fontes
 * marcadas `muda` (conversa do WhatsApp, anotações) entram na leitura, mas mensagem
 * nova não obriga a IA a ler tudo de novo.
 */
/**
 * Versão do que a ficha guarda. Sobe quando o pedido de leitura muda: a ficha antiga não
 * serve mais e os documentos são lidos de novo. v2 (31/10/2026): rubrica de cada desconto
 * do HISCRE e os meses que o extrato cobre, para o Calculista (contabilista.ts).
 */
export const VERSAO_FICHA = 2;

export function chaveLeituraCliente(clientId: number, fontes: Array<{ texto: string; muda?: boolean }>): string {
  const textos = [...new Set(fontes.filter((f) => !f.muda).map((f) => String(f.texto || '').trim()).filter(Boolean))].sort();
  return `ficha${VERSAO_FICHA}:${clientId}:${sha1(textos.map((t) => `${t.length}:${t}`))}`;
}
