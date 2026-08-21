// Transcrição de áudio (Whisper/Groq) e descrição de imagem (Gemini Vision)
// das mensagens de WhatsApp recebidas — usado tanto pelos botões manuais
// quanto pelo orquestrador automático chamado pelo botão de Resumo.

import { db } from '../config/database';
import { aiExtractFromFile } from './aiAssistant';

export interface MediaRow {
  id: number;
  file_name: string;
  mime: string;
  data: Buffer;
}

export type TranscricaoResultado = { ok: true; texto: string } | { ok: false; erro: string };

/** Chama o Whisper (Groq) para transcrever um áudio/vídeo. NÃO grava no banco. */
export async function transcreverAudio(media: MediaRow): Promise<TranscricaoResultado> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, erro: 'Transcrição requer GROQ_API_KEY configurada' };
  if (!String(media.mime).startsWith('audio/') && !String(media.mime).startsWith('video/')) {
    return { ok: false, erro: 'Este arquivo não é um áudio' };
  }
  try {
    const fd = new FormData();
    fd.append('file', new Blob([media.data], { type: media.mime }), media.file_name || 'audio.ogg');
    fd.append('model', 'whisper-large-v3');
    fd.append('language', 'pt');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd as any,
    });
    const d: any = await r.json();
    if (!r.ok) return { ok: false, erro: d?.error?.message || 'Falha na transcrição' };
    const texto = String(d.text || '').trim();
    if (!texto) return { ok: false, erro: 'Não foi possível entender o áudio' };
    return { ok: true, texto };
  } catch (e: any) {
    return { ok: false, erro: e?.message || 'Falha na transcrição' };
  }
}

const INSTRUCAO_IMAGEM = 'Descreva em português, de forma objetiva e factual, o conteúdo '
  + 'desta imagem enviada por um cliente de escritório de advocacia. Se for documento, '
  + 'extraia os dados visíveis (nome, datas, valores, número de processo). Se for foto/print, '
  + 'descreva o que se vê. Não invente informação que não está na imagem. Máximo 500 caracteres.';

/** Descreve uma imagem via Gemini Vision. NÃO grava no banco. */
export async function descreverImagem(media: MediaRow): Promise<TranscricaoResultado> {
  if (!process.env.GEMINI_API_KEY) return { ok: false, erro: 'A leitura de imagens exige GEMINI_API_KEY' };
  const r = await aiExtractFromFile(media.data.toString('base64'), media.mime, INSTRUCAO_IMAGEM);
  if (!r.ok) return { ok: false, erro: r.message || 'Falha ao descrever a imagem' };
  const texto = String(r.text || '').trim();
  if (!texto) return { ok: false, erro: 'Não foi possível descrever a imagem' };
  return { ok: true, texto: texto.slice(0, 500) };
}

const LIMITE_MIDIA_POR_CHAMADA = 15;

/**
 * Antes de gerar o resumo da conversa, garante que todo áudio e toda foto
 * pendentes (ainda sem transcrição/descrição gravada no body) sejam
 * processados — para o resumo por IA "enxergar" esse conteúdo sem precisar de
 * cliques manuais item a item. Falha individual não interrompe os demais.
 */
export async function garantirMidiaTranscrita(phone: string): Promise<void> {
  const [pendentes] = await db.query(
    `SELECT w.id AS msg_id, w.media_id, wm.mime, wm.file_name, wm.data
       FROM whatsapp_messages w
       JOIN whatsapp_media wm ON wm.id = w.media_id
      WHERE w.phone = ?
        AND w.body NOT LIKE '%📝 Transcrição:%'
        AND w.body NOT LIKE '%🖼️ Descrição:%'
      ORDER BY w.msg_time DESC
      LIMIT ?`, [phone, LIMITE_MIDIA_POR_CHAMADA]) as any;

  for (const row of pendentes) {
    const media: MediaRow = { id: row.media_id, file_name: row.file_name, mime: row.mime, data: row.data };
    try {
      if (String(row.mime).startsWith('audio/') || String(row.mime).startsWith('video/')) {
        const r = await transcreverAudio(media);
        if (r.ok) {
          await db.query(
            "UPDATE whatsapp_messages SET body = CONCAT(body, '\n📝 Transcrição: ', ?) WHERE id = ? AND body NOT LIKE '%📝 Transcrição:%'",
            [r.texto.slice(0, 3000), row.msg_id]);
        }
      } else if (String(row.mime).startsWith('image/')) {
        const r = await descreverImagem(media);
        if (r.ok) {
          await db.query(
            "UPDATE whatsapp_messages SET body = CONCAT(body, '\n🖼️ Descrição: ', ?) WHERE id = ? AND body NOT LIKE '%🖼️ Descrição:%'",
            [r.texto, row.msg_id]);
        }
      }
      // outros mimes (pdf, vcard etc.) são ignorados — fora de escopo
    } catch {
      // falha individual não interrompe o loop — o resumo final só não terá esse item
    }
  }
}
