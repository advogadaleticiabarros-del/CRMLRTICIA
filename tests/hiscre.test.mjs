// tests/hiscre.test.mjs — descontos do histórico de créditos lidos em código (31/10/2026).
// Caso real (Valmirio/Itaú): com 6 anos de históricos, a IA não conseguia devolver todos
// os descontos na ficha (centenas de linhas) e parava em 2021; o Itaú ficou só com 05 a
// 12/2021 e os outros bancos zeraram. A transcrição já traz a tabela de rubricas de cada
// competência; o código lê tudo dela. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert';
import { lerHiscre, juntarHiscre } from '../dist/services/hiscre.js';

const pagina = (comp, rubricas, status = 'Pago') => `
Competência | Período | Valor Líquido | Meio de Pagamento | Status | Previsão do Pagamento | Data do Pagamento | Crédito Invalidado | Isento IR
${comp} | 01/${comp} a 28/${comp} | R$ 986,00 | CMG - CARTAO MAGNETICO | ${status} | 04/02/2025 | 04/02/2025 | Não | Não

Banco: 1 - BRASIL
Rubrica | Descrição Rubrica | Valor
101 | VALOR TOTAL DE MR DO PERIODO | R$ 1.717,03
${rubricas.join('\n')}
`;
const HISCRE_2025 = `[Transcrito por IA de "Histórico de créditos (3).pdf"]\nTIPO: HISTÓRICO DE CRÉDITOS DO INSS\n`
  + pagina('01/2025', ['216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 43,64', '216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 43,64', '217 | EMPRESTIMO SOBRE A RMC | R$ 81,94', '268 | CONSIGNACAO - CARTAO | R$ 75,65'])
  + pagina('02/2025', ['216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 1.024,60']);

test('lê cada desconto de banco por competência, com a rubrica e a fonte; dois iguais no mês são dois', () => {
  const r = lerHiscre([{ nome: 'Histórico de créditos (3).pdf', texto: HISCRE_2025 }]);
  assert.deepStrictEqual(r.competencias, ['2025-01', '2025-02']);
  assert.deepStrictEqual(r.lancamentos.map((l) => [l.competencia, l.valor, l.rubrica.slice(0, 3)]), [
    ['2025-01', 43.64, '216'], ['2025-01', 43.64, '216'], ['2025-01', 81.94, '217'], ['2025-01', 75.65, '268'], ['2025-02', 1024.6, '216'],
  ]);
  assert.strictEqual(r.lancamentos[0].fonte, 'Histórico de créditos (3).pdf');
  assert.strictEqual(r.lancamentos[0].rubrica, '216 CONSIGNACAO EMPRESTIMO BANCARIO');
});

test('a mesma competência em dois históricos conta uma vez (a do primeiro)', () => {
  const r = lerHiscre([
    { nome: 'a.pdf', texto: pagina('09/2026', ['216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 24,60']) },
    { nome: 'b.pdf', texto: pagina('09/2026', ['216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 24,60']) + pagina('10/2026', ['216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 24,60']) },
  ]);
  assert.deepStrictEqual(r.lancamentos.map((l) => `${l.competencia} ${l.fonte}`), ['2026-09 a.pdf', '2026-10 b.pdf']);
});

test('crédito não pago ou invalidado não conta como desconto; outros documentos são ignorados', () => {
  const r = lerHiscre([
    { nome: 'h.pdf', texto: pagina('03/2025', ['216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 24,60'], 'Não Pago') },
    { nome: 'contrato.pdf', texto: '216 | CONSIGNACAO EMPRESTIMO BANCARIO | R$ 24,60' },
  ]);
  assert.deepStrictEqual(r.lancamentos, []);
});

test('juntarHiscre: os descontos do histórico lido em código substituem os que a IA listou do histórico', () => {
  const ficha = {
    contratos: [], reus: [], fatos: [], lacunas: [], triagem: [],
    descontos: [
      { competencia: '2025-01', valor: 43.64, contrato: null, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO', fonte: 'Histórico de créditos (3).pdf' },
      { competencia: '2024-07', valor: 99.9, contrato: '123', fonte: 'fatura.pdf' },
    ],
    competencias_extrato: ['2025-01'],
  };
  const f = juntarHiscre(ficha, [{ nome: 'Histórico de créditos (3).pdf', texto: HISCRE_2025 }]);
  assert.strictEqual(f.descontos.length, 6, 'os 5 do histórico + o da fatura');
  assert.ok(f.descontos.some((d) => d.fonte === 'fatura.pdf'));
  assert.deepStrictEqual(f.competencias_extrato, ['2025-01', '2025-02']);
  // Sem histórico em tabela, a ficha fica como veio.
  assert.strictEqual(juntarHiscre(ficha, [{ nome: 'rg.pdf', texto: 'RG' }]), ficha);
});
