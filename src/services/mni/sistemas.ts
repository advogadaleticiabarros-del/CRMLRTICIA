/**
 * Sistemas dos tribunais ligados pelo MNI. Cada um tem login próprio (a senha
 * do PJe do 1º grau do TJES, por exemplo, não serve no 2º grau).
 *
 * Situação em 17/11/2026 (teste com a advogada):
 *  - tjes_pje1g: login ok.
 *  - eproc_jfes: login ok.
 *  - tjes_pje2g (2º grau e Turmas Recursais): endereço ok, falta a senha certa.
 *  - TRT17 (1º e 2º grau): o tribunal recusa a conexão (HTTP 403) antes do
 *    login — exige credenciamento. Fica fora do catálogo até liberarem.
 */

export interface SistemaMni {
  id: string;
  nome: string;
  url: string;
  /** Este sistema é onde o processo tramita? (pelo número CNJ) */
  atende(numeroCnj: string): boolean;
}

/** Partes do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO), só dígitos. */
export function partesCnj(numero: string): { j: string; tr: string; origem: string } | null {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return null;
  return { j: d.slice(13, 14), tr: d.slice(14, 16), origem: d.slice(16, 20) };
}

const ehTjes = (n: string) => { const p = partesCnj(n); return !!p && p.j === '8' && p.tr === '08'; };
// Justiça Federal da 2ª Região, seção judiciária do ES (origem 50xx).
const ehJfes = (n: string) => { const p = partesCnj(n); return !!p && p.j === '4' && p.tr === '02' && p.origem.startsWith('50'); };

export const SISTEMAS_MNI: SistemaMni[] = [
  { id: 'tjes_pje1g', nome: 'TJES — PJe 1º grau', url: 'https://pje.tjes.jus.br/pje/intercomunicacao', atende: ehTjes },
  { id: 'tjes_pje2g', nome: 'TJES — PJe 2º grau e Turmas Recursais', url: 'https://pje.tjes.jus.br/pje2g/intercomunicacao', atende: ehTjes },
  { id: 'eproc_jfes', nome: 'Justiça Federal ES — eproc', url: 'https://eproc-ws.jfes.jus.br/eproc/ws/controlador_ws.php?srv=intercomunicacao2.2', atende: ehJfes },
];

export function sistemaPorId(id: string): SistemaMni | undefined {
  return SISTEMAS_MNI.find((s) => s.id === id);
}

/** Prefixo do campo `source` das movimentações vindas por aqui. */
export const fonteMni = (sistemaId: string) => `mni_${sistemaId}`;

/**
 * Ciência automática: no processo eletrônico, a intimação que ninguém abre
 * conta como recebida 10 dias corridos depois de disponibilizada (Lei
 * 11.419/2006, art. 5º, § 3º). Devolve a data (AAAA-MM-DD).
 */
export function cienciaAutomaticaEm(disponibilizadoEm: string | null): string | null {
  if (!disponibilizadoEm) return null;
  const d = new Date(`${disponibilizadoEm.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 10);
  return d.toISOString().slice(0, 10);
}
