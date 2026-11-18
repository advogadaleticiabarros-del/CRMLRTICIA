/**
 * Sistemas dos tribunais ligados pelo MNI. Cada um tem login próprio (a senha
 * do PJe do 1º grau do TJES, por exemplo, não serve no 2º grau).
 *
 * Situação em 17/11/2026 (teste com a advogada):
 *  - tjes_pje1g: login ok.
 *  - eproc_jfes: login ok.
 *  - tjes_pje2g (2º grau e Turmas Recursais): endereço ok, falta a senha certa.
 *  - TRT17 (1º e 2º grau): o MNI recusa (HTTP 403 "administrative rules", de
 *    qualquer rede) — exige credenciamento. Desde 18/11/2026 o TRT17 entra
 *    pelo SITE do PJe-JT, com o login da Dra., pelo robô de services/pjeJt
 *    (escolha dela, com os riscos explicados). Vai pelo computador do
 *    escritório: o site do TRT17 também bloqueia o servidor do CRM.
 */

export interface SistemaMni {
  id: string;
  nome: string;
  url: string;
  /**
   * A consulta sai pelo computador do escritório (ponteEscritorio.ts), e não
   * direto da VPS. Desde 18/11/2026 o TJES bloqueia o IP da VPS (403 do
   * CloudFront) e aceita a rede do escritório.
   */
  viaEscritorio?: boolean;
  /** Não é MNI: o robô entra no site do PJe-JT (services/pjeJt) neste grau. */
  pjeJt?: 'primeirograu' | 'segundograu';
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
const ehTrt17 = (n: string) => { const p = partesCnj(n); return !!p && p.j === '5' && p.tr === '17'; };
const ehJfes = (n: string) => { const p = partesCnj(n); return !!p && p.j === '4' && p.tr === '02' && p.origem.startsWith('50'); };

export const SISTEMAS_MNI: SistemaMni[] = [
  { id: 'tjes_pje1g', nome: 'TJES — PJe 1º grau', url: 'https://pje.tjes.jus.br/pje/intercomunicacao', atende: ehTjes, viaEscritorio: true },
  { id: 'tjes_pje2g', nome: 'TJES — PJe 2º grau e Turmas Recursais', url: 'https://pje.tjes.jus.br/pje2g/intercomunicacao', atende: ehTjes, viaEscritorio: true },
  { id: 'trt17_pje1g', nome: 'TRT17 — PJe-JT 1º grau (site)', url: 'https://pje.trt17.jus.br/primeirograu', atende: ehTrt17, viaEscritorio: true, pjeJt: 'primeirograu' },
  { id: 'trt17_pje2g', nome: 'TRT17 — PJe-JT 2º grau (site)', url: 'https://pje.trt17.jus.br/segundograu', atende: ehTrt17, viaEscritorio: true, pjeJt: 'segundograu' },
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
