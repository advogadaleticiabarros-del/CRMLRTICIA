// Transcrição de áudio (Whisper/Groq) e descrição de imagem (Gemini Vision) das
// mensagens de WhatsApp recebidas — usado tanto pelo botão manual "Transcrever
// áudio" quanto pelo orquestrador automático chamado pelo botão de Resumo.
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
