// tests/mesaCaso.test.mjs — Mesa do caso: limpeza do HTML da peça, texto <-> formatação,
// campos a preencher, comparação de versões, etapas da produção e lições da equipe.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  sanitizarHtmlPeca, htmlParaTexto, textoParaHtml, contarColchetes, compararTextos,
  etapasDaMesa, promptLicoes, parseLicoes, nomeVersaoDra, numeroDaVersao, abaDaEtapa, resumoColeta, ordenarAchados,
} from '../dist/services/mesaCaso.js';

test('abaDaEtapa: a mesa abre no que importa em cada etapa', () => {
  assert.deepStrictEqual(abaDaEtapa('em_analise'), { aba: 'caso', parecerAoLado: false });
  assert.deepStrictEqual(abaDaEtapa('separacao_documentos'), { aba: 'docs', parecerAoLado: false });
  assert.deepStrictEqual(abaDaEtapa('criacao_inicial'), { aba: 'peca', parecerAoLado: false });
  assert.deepStrictEqual(abaDaEtapa('revisao_inicial'), { aba: 'peca', parecerAoLado: true });
  assert.deepStrictEqual(abaDaEtapa('aguardando_protocolo'), { aba: 'peca', parecerAoLado: false });
  assert.deepStrictEqual(abaDaEtapa('protocolado'), { aba: 'caso', parecerAoLado: false });
  assert.deepStrictEqual(abaDaEtapa('concluido'), { aba: 'caso', parecerAoLado: false });
  assert.deepStrictEqual(abaDaEtapa(null), { aba: 'caso', parecerAoLado: false });
});

test('resumoColeta: o que a Dra. Camila pediu, o que chegou e as cobranças preparadas', () => {
  const r = resumoColeta(
    { pedido_em: '2026-10-10T12:00:00Z', concluido_em: null, itens: JSON.stringify([
      { label: 'Documento com foto (RG ou CNH), frente e verso', keys: ['rg', 'cnh'] },
      { label: 'Extrato do FGTS em PDF', keys: ['fgts'] },
    ]) },
    ['RG frente.jpg', 'conversa.txt'],
    [{ marco: 'docs_d5', created_at: '2026-10-15T12:00:00Z' }, { marco: 'docs_d2', created_at: '2026-10-12T12:00:00Z' }],
  );
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.recebidos, 1);
  assert.deepStrictEqual(r.itens.map((i) => i.recebido), [true, false]);
  assert.deepStrictEqual(r.cobrancas.map((c) => c.rotulo), ['2 dias depois', '5 dias depois']);
  assert.strictEqual(r.concluida, false);
  assert.strictEqual(resumoColeta(null, [], []), null);
});

test('ordenarAchados: graves primeiro, depois atenção, depois informação', () => {
  const a = ordenarAchados(JSON.stringify([{ nivel: 'info', texto: 'c' }, { nivel: 'grave', texto: 'a' }, { nivel: 'atencao', texto: 'b' }]));
  assert.deepStrictEqual(a.map((x) => x.texto), ['a', 'b', 'c']);
  assert.deepStrictEqual(ordenarAchados('lixo'), []);
});
import { auditarArquivos } from './helpers/schemaAudit.mjs';

// ── segurança: só a formatação de peça passa ────────────────────────────────

test('sanitizarHtmlPeca tira script, eventos, links e estilos perigosos', () => {
  const sujo = '<p onclick="x()">Oi <script>alert(1)</script><b>forte</b></p><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a><style>p{}</style><iframe src="x"></iframe>';
  const limpo = sanitizarHtmlPeca(sujo);
  assert.doesNotMatch(limpo, /script|onclick|onerror|javascript|<img|<a|<style|iframe|alert\(1\)/i);
  assert.match(limpo, /<p>Oi <b>forte<\/b><\/p>/);
  assert.match(limpo, /link/);
});

test('sanitizarHtmlPeca mantém alinhamento, títulos, listas e recuo; troca div por p e tira o destaque', () => {
  const h = sanitizarHtmlPeca('<div style="text-align: justify; color: red">texto <mark class="colchete">[CPF]</mark></div><h3 style="text-align:center">I. DOS FATOS</h3><ol><li>um</li></ol><blockquote>recuo</blockquote><p style="position:fixed">x</p>');
  assert.match(h, /<p style="text-align:justify">texto \[CPF\]<\/p>/);
  assert.match(h, /<h3 style="text-align:center">I\. DOS FATOS<\/h3>/);
  assert.match(h, /<ol><li>um<\/li><\/ol>/);
  assert.match(h, /<blockquote>recuo<\/blockquote>/);
  assert.match(h, /<p>x<\/p>/);
  assert.doesNotMatch(h, /mark|color|position/);
});

test('sanitizarHtmlPeca escapa o "<" solto e mantém as entidades', () => {
  assert.strictEqual(sanitizarHtmlPeca('<p>a < b &amp; c</p>'), '<p>a &lt; b &amp; c</p>');
});

test('htmlParaTexto vira texto corrido com parágrafos, quebras e listas numeradas', () => {
  const t = htmlParaTexto('<p class="x">EXCELENTÍSSIMO</p><p>linha 1<br>linha 2</p><ol><li>um</li><li>dois</li></ol><p>R$ 1.000,00 &amp; juros&nbsp;</p>');
  assert.strictEqual(t, 'EXCELENTÍSSIMO\n\nlinha 1\nlinha 2\n\n1. um\n2. dois\n\nR$ 1.000,00 & juros');
});

test('textoParaHtml converte a peça da IA em parágrafos formatados, sem deixar HTML passar', () => {
  const h = textoParaHtml('EXCELENTÍSSIMO SENHOR JUIZ DA VARA CÍVEL\n\n## I. DOS FATOS\n\n1. A autora **não** contratou.\nSegunda linha <script>x</script>\n\n- item a\n- item b\n\n| Mês | Valor |\n|---|---|\n| 01/2022 | R$ 10,00 |');
  assert.match(h, /<p style="text-align:center"><b>EXCELENTÍSSIMO SENHOR JUIZ DA VARA CÍVEL<\/b><\/p>/);
  assert.match(h, /<h3>I\. DOS FATOS<\/h3>/);
  assert.match(h, /<p style="text-align:justify">1\. A autora <b>não<\/b> contratou\.<br>Segunda linha &lt;script&gt;x&lt;\/script&gt;<\/p>/);
  assert.match(h, /<ul><li>item a<\/li><li>item b<\/li><\/ul>/);
  assert.match(h, /<table><tr><th>Mês<\/th><th>Valor<\/th><\/tr><tr><td>01\/2022<\/td><td>R\$ 10,00<\/td><\/tr><\/table>/);
});

test('textoParaHtml: título em maiúsculas que começa com numeral romano ou "DOS" vira seção', () => {
  assert.match(textoParaHtml('DOS PEDIDOS'), /<h3>DOS PEDIDOS<\/h3>/);
  assert.match(textoParaHtml('III – DO DIREITO'), /<h3>III – DO DIREITO<\/h3>/);
});

test('contarColchetes conta só campos com texto a preencher', () => {
  assert.strictEqual(contarColchetes('CPF [CPF], mora em [endereço completo] e [a comprovar — não consta em documento]. Nota [1].'), 3);
  assert.strictEqual(contarColchetes(''), 0);
});

// ── versões ─────────────────────────────────────────────────────────────────

test('nomeVersaoDra e numeroDaVersao', () => {
  assert.strictEqual(nomeVersaoDra('Petição Inicial — Maria Teste (v1)', 2), 'Petição Inicial — Maria Teste (v2 · edição da Dra.)');
  assert.strictEqual(nomeVersaoDra('Petição Inicial conjunta — Maria Teste', 3), 'Petição Inicial conjunta — Maria Teste (v3 · edição da Dra.)');
  assert.strictEqual(numeroDaVersao('Petição Inicial — X (v3 · edição da Dra.)'), 3);
  assert.strictEqual(numeroDaVersao('Petição Inicial — X'), 1);
});

test('compararTextos mostra só os trechos que mudaram, palavra a palavra', () => {
  const a = 'EXCELENTÍSSIMO JUIZ DA VARA CÍVEL\n\n1. A autora contratou o cartão.\n\nTexto igual.';
  const b = 'EXCELENTÍSSIMO JUIZ DA VARA REGIONAL BANCÁRIA\n\nPrioridade de tramitação.\n\n1. A autora contratou o cartão.\n\nTexto igual.';
  const r = compararTextos(a, b);
  assert.strictEqual(r.iguais, 2);
  assert.strictEqual(r.pares.length, 1);
  const [p] = r.pares;
  const saiu = p.esq.filter((s) => s.tipo === 'saiu').map((s) => s.t).join('');
  const entrou = p.dir.filter((s) => s.tipo === 'entrou').map((s) => s.t).join('');
  assert.match(saiu, /CÍVEL/);
  assert.match(entrou, /REGIONAL BANCÁRIA/);
  assert.match(entrou, /Prioridade de tramitação/);
  assert.ok(p.esq.some((s) => s.tipo === 'igual' && /EXCELENTÍSSIMO/.test(s.t)));
});

test('compararTextos não picota a frase trocada em palavras soltas', () => {
  const { pares } = compararTextos('JUIZ DA VARA CÍVEL DA COMARCA', 'JUIZ DA VARA REGIONAL DE DIREITO BANCÁRIO DA COMARCA');
  const entrou = pares[0].dir.filter((s) => s.tipo === 'entrou');
  assert.strictEqual(entrou.length, 1);
  assert.strictEqual(entrou[0].t.trim(), 'REGIONAL DE DIREITO BANCÁRIO');
});

test('textoParaHtml separa título, lista e parágrafo que vêm sem linha em branco', () => {
  assert.strictEqual(textoParaHtml('## Fontes lidas\n- a.pdf\n- b.pdf\nTexto depois.'),
    '<h3>Fontes lidas</h3><ul><li>a.pdf</li><li>b.pdf</li></ul><p style="text-align:justify">Texto depois.</p>');
});

test('compararTextos: parágrafo só acrescentado aparece só do lado direito; textos iguais não têm pares', () => {
  const r = compararTextos('A.\n\nB.', 'A.\n\nNovo.\n\nB.');
  assert.strictEqual(r.pares.length, 1);
  assert.deepStrictEqual(r.pares[0].esq, []);
  assert.strictEqual(r.pares[0].dir[0].tipo, 'entrou');
  assert.strictEqual(compararTextos('igual', 'igual').pares.length, 0);
});

// ── etapas: começo, meio e fim ──────────────────────────────────────────────

const fatosBase = {
  stage: 'criacao_inicial', relato: true, partesContrarias: 1, checklist: { completos: 7, total: 8 }, documentos: 5,
  temPeticaoEquipe: true, colchetes: 4, temVersaoDra: true, revisaoDepoisDaEdicao: false, pendenciasAbertas: 2, temFinal: false, numeroProcesso: false,
};

test('etapasDaMesa: 7 etapas em 3 fases, com a atual e o que falta para avançar', () => {
  const r = etapasDaMesa(fatosBase);
  assert.strictEqual(r.etapas.length, 7);
  assert.strictEqual(r.atual, 2);
  assert.deepStrictEqual([...new Set(r.etapas.map((e) => e.faseNome))], ['Preparação', 'Produção', 'Protocolo']);
  assert.deepStrictEqual(r.etapas.map((e) => e.estado), ['feito', 'feito', 'atual', 'depois', 'depois', 'depois', 'depois']);
  const atual = r.etapas[2];
  assert.ok(atual.fazer.length > 20);
  assert.ok(atual.criterios.some((c) => !c.ok && /faltam 4/.test(c.txt)));
  assert.ok(atual.criterios.some((c) => c.ok && /equipe/i.test(c.txt)));
  assert.ok(r.etapas[1].criterios.some((c) => /7\/8/.test(c.txt)));
});

test('etapasDaMesa: caso recusado não tem etapa atual', () => {
  assert.strictEqual(etapasDaMesa({ ...fatosBase, stage: 'recusado' }).atual, -1);
});

// ── lições da equipe ────────────────────────────────────────────────────────

test('promptLicoes leva os trechos alterados e pede regra geral, não dado do caso', () => {
  const pares = compararTextos('VARA CÍVEL', 'VARA REGIONAL BANCÁRIA').pares;
  const p = promptLicoes('consumidor', pares);
  assert.match(p, /ANTES \(equipe\): VARA ⟦CÍVEL⟧/);
  assert.match(p, /DEPOIS \(advogada\): VARA ⟦REGIONAL BANCÁRIA⟧/);
  assert.match(p, /"licoes"/);
  assert.match(p, /CPF/);
});

test('parseLicoes aceita JSON com texto em volta e limita a 8 lições completas', () => {
  const l = parseLicoes('ok {"licoes":[{"titulo":"Endereçamento","mudou":"Vara Cível para Regional","regra":"Bancário em Vitória: Vara Regional"},{"titulo":"sem regra"}]}');
  assert.deepStrictEqual(l, [{ titulo: 'Endereçamento', mudou: 'Vara Cível para Regional', regra: 'Bancário em Vitória: Vara Regional' }]);
  assert.deepStrictEqual(parseLicoes('nada'), []);
});

test('SQL da mesa não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(['src/routes/mesa.ts', 'src/services/esteiraPecaMysql.ts']);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});
