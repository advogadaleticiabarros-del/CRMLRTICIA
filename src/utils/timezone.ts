/**
 * O <input type="datetime-local"> manda hora local (Brasília, sem info de
 * fuso) — ex.: "2026-08-25T14:00". O banco guarda tudo em UTC (timezone 'Z'
 * na conexão — ver src/config/database.ts). Sem essa conversão, "14:00"
 * digitado virava "14:00 UTC" gravado, e ao exibir de volta (fuso do
 * navegador, Brasília) aparecia 11:00 — 3h a menos do que foi digitado.
 * Brasil não observa horário de verão desde 2019, então o offset -03:00 é fixo.
 */
export function localParaUtcMysql(v: string): string {
  const d = new Date(`${v}:00-03:00`);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
