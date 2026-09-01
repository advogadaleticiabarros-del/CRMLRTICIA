/**
 * Tira o prefixo "data:<mime>;base64," de uma data URL, devolvendo só o
 * payload base64. Existia como regex /^data:[^;]+;base64,/ copiada em 3
 * lugares (documents.ts, acordos.ts, whatsapp-instance.ts) — quebrava
 * silenciosamente sempre que o mime tinha parâmetro extra (ex.: áudio
 * gravado no navegador vem como "audio/webm;codecs=opus", não só
 * "audio/webm"): a regex não batia, o .replace() não fazia nada, e
 * Buffer.from(string_inteira, 'base64') decodificava só uns bytes de lixo
 * do prefixo — o arquivo salvava com poucos bytes, sem erro nenhum.
 *
 * Uma data URL é sempre "data:[<mediatype>][;base64],<dados>" — o payload
 * começa depois da PRIMEIRA vírgula, não importa quantos ";param=valor"
 * vierem antes dela. Por isso corta em "," e não em ";base64,".
 */
export function stripDataUrlPrefix(value: string): string {
  return String(value || '').replace(/^data:[^,]*,/, '');
}
