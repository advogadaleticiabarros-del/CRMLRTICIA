/**
 * Freio das consultas ao DataJud (API pública do CNJ).
 *
 * Incidente de 23/11/2026 ("DataJud HTTP 429" ao sincronizar processo): o
 * monitoramento consultava os 136 processos toda hora, as rodadas se
 * sobrepunham e o CNJ recusava de 400 a 650 consultas por dia; o clique manual
 * caía no mesmo bloqueio.
 *
 * Regras (uma instância para o processo inteiro, `freioDataJud` em datajud.ts):
 *  - uma consulta por vez, com intervalo mínimo entre elas (DATAJUD_INTERVALO_MS, padrão 2s);
 *  - depois de um 429 ou timeout, as consultas automáticas param pela pausa
 *    (DATAJUD_PAUSA_MS, padrão 15 min) e voltam sozinhas;
 *  - consulta com prioridade (o clique "Sincronizar agora") passa à frente da
 *    fila e tenta mesmo durante a pausa.
 */
export interface Freio {
  /** Executa a consulta na vez dela. null = automática barrada pela pausa (nem chamou o CNJ). */
  executar<T>(fn: () => Promise<T>, opts?: { prioridade?: boolean }): Promise<T | null>;
  /** O CNJ limitou (429) ou não respondeu: pausa as automáticas. */
  registrarLimite(): void;
  /** Até quando (ms desde 1970) as automáticas estão pausadas; 0 = livre. */
  pausadoAte(): number;
  /** Tira a pausa (testes e liberação manual). */
  liberar(): void;
}

export function criarFreio(deps: {
  agora?: () => number;
  esperar?: (ms: number) => Promise<void>;
  intervaloMs?: () => number;
  pausaMs?: () => number;
} = {}): Freio {
  const agora = deps.agora ?? (() => Date.now());
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const intervalo = deps.intervaloMs ?? (() => Number(process.env.DATAJUD_INTERVALO_MS ?? 2000));
  const pausa = deps.pausaMs ?? (() => Number(process.env.DATAJUD_PAUSA_MS ?? 15 * 60000));
  let ultimo = -Infinity;
  let pausadoAte = 0;
  let fila: Promise<unknown> = Promise.resolve();

  async function minhaVez(): Promise<void> {
    const falta = ultimo + intervalo() - agora();
    if (falta > 0) await esperar(falta);
    ultimo = agora();
  }

  return {
    async executar<T>(fn: () => Promise<T>, opts: { prioridade?: boolean } = {}): Promise<T | null> {
      if (opts.prioridade) { await minhaVez(); return fn(); }
      if (agora() < pausadoAte) return null;
      const vez = fila.then(async () => {
        if (agora() < pausadoAte) return null;
        await minhaVez();
        return fn();
      });
      fila = vez.then(() => undefined, () => undefined);
      return vez;
    },
    registrarLimite() { pausadoAte = agora() + pausa(); },
    pausadoAte: () => (agora() < pausadoAte ? pausadoAte : 0),
    liberar() { pausadoAte = 0; },
  };
}
