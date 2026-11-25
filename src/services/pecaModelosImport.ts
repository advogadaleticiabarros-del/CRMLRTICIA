import mammoth from 'mammoth';
import { db } from '../config/database';
import { aiEmbed } from './aiAssistant';
import { stripDataUrlPrefix } from '../utils/dataUrl';

/**
 * Importa UMA ficha de modelo de peça do cofre Obsidian para peca_modelos:
 * extrai o texto do .docx, calcula o índice de sentido e grava (idempotente
 * pelo nome do arquivo). Usada pelo botão "Importar do Obsidian…"
 * (POST /api/peca-modelos/import-ficha) e pela ponte do Obsidian
 * (POST /api/obsidian-ponte/modelos).
 */

// Mesmo mapeamento de scripts/import-pecas-obsidian.mjs. PRECISA ficar igual
// se uma área nova for adicionada em algum dos dois.
export const AREA_MAP: Record<string, string> = {
  'previdenciário': 'previdenciario', 'previdenciario': 'previdenciario',
  'trabalhista': 'trabalhista', 'consumidor': 'consumidor', 'bancário': 'consumidor',
  'família': 'familia', 'familia': 'familia', 'cível': 'civel', 'civel': 'civel',
  'execução': 'execucao', 'execucao': 'execucao',
  'extrajudicial': 'extrajudicial',
};

export interface FichaModelo {
  external_key?: string; titulo?: string; area?: string | null; assunto?: string | null; tipo?: string | null;
  rito?: string | null; teses?: string | string[] | null; fundamentos?: string | string[] | null; docx_base64?: string | null;
}

export class FichaInvalida extends Error {}

export async function importarFichaModelo(f: FichaModelo) {
  const key = String(f.external_key || f.titulo || '').trim().slice(0, 255);
  if (!key) throw new FichaInvalida('Informe external_key ou titulo');

  let conteudo: string | null = null;
  if (f.docx_base64) {
    try {
      const buffer = Buffer.from(stripDataUrlPrefix(f.docx_base64), 'base64');
      const r = await mammoth.extractRawText({ buffer });
      conteudo = r.value.replace(/\n{3,}/g, '\n\n').trim().slice(0, 120000);
    } catch { /* docx corrompido/ilegível — segue sem conteúdo, a ficha ainda entra */ }
  }

  const lista = (v: any) => (Array.isArray(v) ? v.join('; ') : (v || null));
  const teses = lista(f.teses); const fund = lista(f.fundamentos);
  const areaNormalizada = AREA_MAP[String(f.area || '').toLowerCase()] || null;
  const embedding = await aiEmbed([f.titulo, f.assunto, teses, fund].filter(Boolean).join('\n'));

  const [r] = await db.query(
    `INSERT INTO peca_modelos (external_key, titulo, area, assunto, tipo, rito, tribunal, teses, fundamentos, conteudo, embedding, embedded_at, fonte)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'obsidian')
     ON DUPLICATE KEY UPDATE titulo=VALUES(titulo), area=VALUES(area), assunto=VALUES(assunto),
       tipo=VALUES(tipo), rito=VALUES(rito), teses=VALUES(teses), fundamentos=VALUES(fundamentos),
       conteudo=COALESCE(VALUES(conteudo), conteudo),
       embedding=COALESCE(VALUES(embedding), embedding), embedded_at=COALESCE(VALUES(embedded_at), embedded_at)`,
    [key, String(f.titulo || key), areaNormalizada, f.assunto || null, f.tipo || null, f.rito || null, null,
     teses, fund, conteudo, embedding ? JSON.stringify(embedding) : null, embedding ? new Date() : null],
  ) as any;

  return { success: true, criado: r.affectedRows === 1, teve_docx: !!conteudo, teve_embedding: !!embedding };
}
