import type { FichaDeFatos } from './pecaDossie';
import { familiaDaRubrica, type LancamentoExtrato } from './contabilista';

/**
 * Descontos do histórico de créditos do INSS (HISCRE) lidos em código, da transcrição
 * (31/10/2026, caso Valmirio/Itaú). A ficha de fatos pedia à IA "todo desconto, mês a mês";
 * com 6 anos de históricos são centenas de linhas, a resposta parava em 2021 e o Itaú ficou
 * só com 8 meses. A transcrição traz, para cada competência, a linha da competência e a
 * tabela de rubricas ("216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 43,64"); aqui se lê tudo
 * dela, sem limite. Só as rubricas de banco (216, 217, 268) viram desconto.
 * Testes em tests/hiscre.test.mjs.
 */

export interface LeituraHiscre { lancamentos: Array<LancamentoExtrato & { rubrica: string; fonte: string }>; competencias: string[] }

// "01/2025 | 01/01/2025 a 31/01/2025 | R$ 986,00 | CMG - ... | Pago | ..."
const LINHA_COMPETENCIA = /^\s*\**(\d{2})\/(\d{4})\**\s*\|\s*\d{2}\/\d{2}\/\d{4}\s+a\s+\d{2}\/\d{2}\/\d{4}\s*\|(.*)$/;
// "216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 43,64"
const LINHA_RUBRICA = /^\s*(\d{3})\s*\|\s*([^|]+?)\s*\|\s*(?:R\$\s*)?(-?[\d.]+,\d{2})\s*\|?\s*$/;
const valor = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

export function lerHiscre(fontes: Array<{ nome: string; texto: string }>): LeituraHiscre {
  const lancamentos: LeituraHiscre['lancamentos'] = [];
  const vistas = new Set<string>(); // competências já lidas em outro histórico
  for (const f of fontes) {
    const nome = f.nome.replace(/\s*\((caso #\d+|documento do cliente)\)\s*$/, '');
    const desteDoc = new Set<string>();
    let atual: string | null = null, valida = false;
    for (const linha of String(f.texto || '').split(/\r?\n/)) {
      const c = linha.match(LINHA_COMPETENCIA);
      if (c) {
        atual = `${c[2]}-${c[1]}`;
        // Crédito não pago ou invalidado: o desconto não aconteceu.
        const resto = c[3].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        valida = !/nao pago|invalidad|cancelad|bloquead/.test(resto) && !vistas.has(atual);
        if (valida) desteDoc.add(atual);
        continue;
      }
      if (!atual || !valida) continue;
      const r = linha.match(LINHA_RUBRICA);
      if (!r) continue;
      const rubrica = `${r[1]} ${r[2].trim()}`;
      if (!familiaDaRubrica(rubrica) || !['216', '217', '268'].includes(r[1])) continue;
      const v = valor(r[3]);
      if (v > 0) lancamentos.push({ competencia: atual, valor: v, rubrica, fonte: nome });
    }
    for (const c of desteDoc) vistas.add(c);
  }
  return { lancamentos, competencias: [...vistas].sort() };
}

/** A ficha com os descontos do histórico lidos em código no lugar dos que a IA listou do histórico. */
export function juntarHiscre(ficha: FichaDeFatos, fontes: Array<{ nome: string; texto: string }>): FichaDeFatos {
  const h = lerHiscre(fontes);
  if (!h.lancamentos.length) return ficha;
  const doHistorico = new Set(h.competencias);
  const outros = ficha.descontos.filter((d) => !(d.rubrica && familiaDaRubrica(d.rubrica)) && !(!d.contrato && doHistorico.has(d.competencia)));
  return {
    ...ficha,
    descontos: [...h.lancamentos.map((l) => ({ competencia: l.competencia, valor: l.valor, contrato: null, rubrica: l.rubrica, fonte: l.fonte })), ...outros],
    competencias_extrato: [...new Set([...(ficha.competencias_extrato || []), ...h.competencias])].sort(),
  };
}
