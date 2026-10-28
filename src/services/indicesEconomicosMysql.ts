import { db } from '../config/database';
import { carregarIndices, type DepsIndices, type IndicesMensais, type LinhaIndice } from './indicesEconomicos';

/** Índices do Bacen com o cache no banco (regras em indicesEconomicos.ts). */

async function cache(): Promise<LinhaIndice[]> {
  const [rows] = await db.query('SELECT serie, competencia, valor FROM indices_economicos') as any;
  return rows.map((r: any) => ({ serie: r.serie, competencia: r.competencia, valor: Number(r.valor) }));
}

async function guardar(linhas: LinhaIndice[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    await db.query(
      `INSERT INTO indices_economicos (serie, competencia, valor) VALUES ${lote.map(() => '(?, ?, ?)').join(', ')}
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_em = NOW()`,
      lote.flatMap((l) => [l.serie, l.competencia, l.valor]));
  }
}

async function bacen(codigo: number, de: string, ate: string): Promise<unknown> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${de}&dataFinal=${ate}`;
  // A API às vezes devolve vazio ou erro na 1ª chamada: tenta de novo uma vez.
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (tentativa >= 2) throw e;
    }
  }
}

export const depsIndicesMysql: DepsIndices = { cache, guardar, bacen, hoje: () => new Date() };

export async function indicesDoBacen(): Promise<{ indices: IndicesMensais; avisos: string[] }> {
  return carregarIndices(depsIndicesMysql);
}
