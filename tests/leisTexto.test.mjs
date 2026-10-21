// tests/leisTexto.test.mjs — Pesquisa de Leis: regras puras (ler a norma, artigos, citações, busca)
import { test } from 'node:test';
import assert from 'node:assert';
import {
  lerNorma, dividirEmDispositivos, extrairCitacoes, interpretarPergunta, montarConsulta, normalizarArtigo,
  caminhoNoAcervo, ordenarResultados, formatarCitacao, avaliarCitacao, blocoFundamentos, relatorioConferencia, trechoRelevante,
} from '../dist/services/leisTexto.js';

const CLT = `---
titulo: "Decreto-Lei nº 5.452 de 01/05/1943"
tipo: "Decreto-Lei"
numero: "5452"
data: 1943-05-01
ementa: "Aprova a Consolidação das Leis do Trabalho."
revogada: false
versao_texto: "compilada (texto vigente)"
urn: "urn:lex:br:federal:decreto.lei:1943-05-01;5452"
fonte: "https://normas.leg.br/?urn=urn:lex:br:federal:decreto.lei:1943-05-01;5452"
baixado_em: 2026-10-13
---
# Decreto-Lei nº 5.452 de 01/05/1943

**DECRETO-LEI Nº 5.452, DE 1º DE MAIO DE 1943**

Aprova a Consolidação das Leis do Trabalho.

**Art. 1º** Fica aprovada a Consolidação das Leis do Trabalho.

**Art. 2º** O presente decreto-lei entrará em vigor em 10 de novembro de 1943.

> **Art. 1º** Esta Consolidação estatui as normas que regulam as relações individuais e coletivas de trabalho.

> **Art. 2º** Considera-se empregador a empresa, individual ou coletiva.

> **Art. 3º** Considera-se empregado toda pessoa física que prestar serviços de natureza não eventual.

> **Art. 477-A.** As dispensas imotivadas equiparam-se para todos os fins.

> **Art. 482.** Constituem justa causa para rescisão do contrato de trabalho pelo empregador:
  a) ato de improbidade;
  i) abandono de emprego;

**Art. 902.** *(Revogado pela Lei nº 7.033, de 5/10/1982)*

**Art. 1.025.** Artigo de numeração com ponto de milhar.
`;

const SUMULA = `---
titulo: "Súmula nº 331 do TST"
tribunal: "TST"
tipo: "Súmula"
numero: "331"
data: 2011-05-31
revogada: false
versao_texto: "caderno consolidado do tribunal"
fonte: "https://www.tst.jus.br/documents/10157/63003/Livro-Internet.pdf"
baixado_em: 2026-10-15
---
# Súmula nº 331 do TST

SUM-331 CONTRATO DE PRESTAÇÃO DE SERVIÇOS. LEGALIDADE
I - A contratação de trabalhadores por empresa interposta é ilegal.
IV - O inadimplemento das obrigações trabalhistas implica a responsabilidade subsidiária do tomador.
`;

test('lerNorma: cabeçalho, esfera pelo caminho, chave do tipo, ano e apelido conhecido', () => {
  const n = lerNorma('federal/decretos-lei/1943/del-5452-1943-05-01.md', CLT);
  assert.strictEqual(n.titulo, 'Decreto-Lei nº 5.452 de 01/05/1943');
  assert.strictEqual(n.tipoChave, 'dl');
  assert.strictEqual(n.numero, '5452');
  assert.strictEqual(n.ano, 1943);
  assert.strictEqual(n.esfera, 'federal');
  assert.strictEqual(n.revogada, false);
  assert.strictEqual(n.apelido, 'CLT');
  assert.match(n.fonte, /^https:\/\/normas\.leg\.br/);
  assert.ok(!n.corpo.includes('baixado_em'));
});

test('lerNorma: súmula do TST, lei estadual do ES e a Constituição sem cabeçalho', () => {
  const s = lerNorma('jurisprudencia/tst/sumulas/sumula-331.md', SUMULA);
  assert.strictEqual(s.esfera, 'jurisprudencia');
  assert.strictEqual(s.tipoChave, 'sumula');
  assert.strictEqual(s.tribunal, 'TST');
  assert.strictEqual(s.numero, '331');

  const es = lerNorma('estaduais/ES/leis-ordinarias/2010/lei-9999-2010.md', '---\ntitulo: "Lei nº 9.999 de 01/02/2010"\nuf: "ES"\ntipo: "Lei Ordinária"\nnumero: "9999"\ndata: 2010-02-01\nrevogada: true\nfonte: "https://x"\n---\n# Lei\n\nTexto.');
  assert.strictEqual(es.esfera, 'estadual');
  assert.strictEqual(es.uf, 'ES');
  assert.strictEqual(es.tipoChave, 'lei');
  assert.strictEqual(es.revogada, true);

  const cf = lerNorma('constituicao.md', '# Constituição da República Federativa do Brasil de 1988\n\nArt. 1º A República Federativa do Brasil...');
  assert.strictEqual(cf.esfera, 'constituicao');
  assert.strictEqual(cf.tipoChave, 'cf');
  assert.strictEqual(cf.apelido, 'CF');
  assert.strictEqual(cf.ano, 1988);
});

test('lerNorma: súmula/OJ cancelada só no texto (cabeçalho diz revogada: false) conta como cancelada', () => {
  const oj = lerNorma('jurisprudencia/tst/orientacoes-jurisprudenciais/oj-sdi1-88.md', '---\ntitulo: "Orientação Jurisprudencial SDI1-88 do TST"\ntribunal: "TST"\ntipo: "Orientação Jurisprudencial"\nnumero: "SDI1-88"\nrevogada: false\nfonte: "x"\n---\n# OJ SDI1-88\n\nOJ-SDI1-88 GESTANTE. ESTABILIDADE PROVISÓRIA (can-\ncelada em decorrência da nova redação conferida à Súmula nº 244) - Res. 129/2005');
  assert.strictEqual(oj.revogada, true);
  const viva = lerNorma('jurisprudencia/tst/sumulas/sumula-244.md', '---\ntitulo: "Súmula nº 244 do TST"\ntribunal: "TST"\ntipo: "Súmula"\nnumero: "244"\nrevogada: false\nfonte: "x"\n---\n# Súmula 244\n\nSUM-244 GESTANTE. ESTABILIDADE PROVISÓRIA (redação do item III alterada). ' + 'texto '.repeat(200) + ' (cancelada a OJ 88)');
  assert.strictEqual(viva.revogada, false, '"cancelada" lá no meio do texto (citando outra) não conta');
});

test('normalizarArtigo: ordinal, ponto de milhar, letra e "único"', () => {
  assert.strictEqual(normalizarArtigo('1º'), '1');
  assert.strictEqual(normalizarArtigo('1.025'), '1025');
  assert.strictEqual(normalizarArtigo('477-a'), '477-A');
  assert.strictEqual(normalizarArtigo('477 - A'), '477-A');
  assert.strictEqual(normalizarArtigo('único'), 'unico');
});

test('dividirEmDispositivos: um por artigo, preâmbulo fora, revogado marcado e a parte principal (CLT anexa)', () => {
  const n = lerNorma('federal/decretos-lei/1943/del-5452-1943-05-01.md', CLT);
  const d = dividirEmDispositivos(n);
  const rotulos = d.map((x) => x.rotulo);
  assert.deepStrictEqual(rotulos, ['Art. 1º', 'Art. 2º', 'Art. 1º', 'Art. 2º', 'Art. 3º', 'Art. 477-A', 'Art. 482', 'Art. 902', 'Art. 1.025']);
  const art482 = d.find((x) => x.numero === '482');
  assert.match(art482.texto, /abandono de emprego/);
  assert.ok(!art482.texto.includes('**'), 'sem marcação markdown');
  assert.strictEqual(d.find((x) => x.numero === '902').revogado, true);
  assert.strictEqual(art482.revogado, false);
  // o art. 1º "principal" é o da Consolidação (a parte com mais artigos), não o do decreto que a aprova
  const principais1 = d.filter((x) => x.numero === '1' && x.principal);
  assert.strictEqual(principais1.length, 1);
  assert.match(principais1[0].texto, /Esta Consolidação/);
  assert.strictEqual(d.find((x) => x.numero === '1025').numero, '1025');
});

test('dividirEmDispositivos: artigo citado entre aspas (redação dada por outra lei) não abre artigo novo', () => {
  const n = lerNorma('federal/leis-ordinarias/2017/lei-13467-2017-07-13.md', '---\ntitulo: "Lei nº 13.467"\ntipo: "Lei Ordinária"\nnumero: "13467"\ndata: 2017-07-13\nfonte: "x"\n---\n# Lei\n\n**Art. 1º** A CLT passa a vigorar com as seguintes alterações:\n\n"Art. 2º Considera-se empregador..."\n\n**Art. 2º** Esta Lei entra em vigor após 120 dias.');
  const d = dividirEmDispositivos(n);
  assert.deepStrictEqual(d.map((x) => x.rotulo), ['Art. 1º', 'Art. 2º']);
  assert.match(d[0].texto, /Considera-se empregador/);
});

test('dividirEmDispositivos: "**Art**. 1º" (negrito só na palavra), fim de linha do Windows e "Art. único"', () => {
  const md = '---\r\ntitulo: "Lei nº 9.450 de 14/03/1997"\r\ntipo: "Lei Ordinária"\r\nnumero: "9450"\r\ndata: 1997-03-14\r\nfonte: "x"\r\n---\r\n# Lei\r\n\r\n**Art**. 1º O art. 75 passa a vigorar acrescido:\r\n\r\n"**Art**.75......"\r\n\r\n**Art**. 2º Ficam convalidados os atos.\r\n\r\nArtigo único. Esta Lei entra em vigor.';
  const n = lerNorma('federal/leis-ordinarias/1997/lei-9450-1997-03-14.md', md);
  assert.strictEqual(n.titulo, 'Lei nº 9.450 de 14/03/1997');
  assert.strictEqual(n.numero, '9450');
  const d = dividirEmDispositivos(n);
  assert.deepStrictEqual(d.map((x) => x.numero), ['1', '2', 'unico']);
  assert.strictEqual(d[2].rotulo, 'Art. único');
});

test('lerNorma: tipos da jurisprudência (OJ, temas, súmula vinculante) e dos órgãos (IN do INSS)', () => {
  const cab = (tipo, numero, tribunal) => `---\ntitulo: "x"\n${tribunal ? `tribunal: "${tribunal}"\n` : ''}tipo: "${tipo}"\nnumero: "${numero}"\ndata:\nfonte: "x"\n---\n# x\n\ntexto`;
  assert.strictEqual(lerNorma('jurisprudencia/tst/orientacoes-jurisprudenciais/oj-sdi1-394.md', cab('Orientação Jurisprudencial', 'SDI1-394', 'TST')).tipoChave, 'oj');
  assert.strictEqual(lerNorma('jurisprudencia/stf/repercussao-geral/tema-1046.md', cab('Tema de repercussão geral', '1046', 'STF')).tipoChave, 'tema_rg');
  assert.strictEqual(lerNorma('jurisprudencia/stj/repetitivos/tema-1031.md', cab('Tema repetitivo', '1031', 'STJ')).tipoChave, 'tema_rep');
  assert.strictEqual(lerNorma('jurisprudencia/stf/sumulas-vinculantes/sumula-vinculante-4.md', cab('Súmula vinculante', '4', 'STF')).tipoChave, 'sumula_vinculante');
  const inss = lerNorma('reguladores/inss/instrucoes-normativas/2022/in-128.md', cab('Instrução Normativa', '128'));
  assert.strictEqual(inss.tipoChave, 'in');
  assert.strictEqual(inss.esfera, 'regulador');
  assert.strictEqual(inss.orgao, 'INSS');
  assert.strictEqual(lerNorma('jurisprudencia/stf/sumulas-vinculantes/x.md', cab('Súmula vinculante', '4', 'STF')).ano, null, 'data vazia → sem ano');
});

test('extrairCitacoes: OJ da SDI-1, tema de repercussão geral do STF e repetitivo do STJ', () => {
  const c = extrairCitacoes('Ver a OJ nº 394 da SBDI-1 do TST, o Tema 1.046 do STF e o Tema Repetitivo 1031 do STJ.');
  assert.deepStrictEqual(c.map((x) => `${x.tipo}:${x.tribunal}:${x.numero}`), ['oj:TST:SDI1-394', 'tema_rg:STF:1046', 'tema_rep:STJ:1031']);
});

test('dividirEmDispositivos: súmula (sem artigos) vira um dispositivo só, com o texto inteiro', () => {
  const d = dividirEmDispositivos(lerNorma('jurisprudencia/tst/sumulas/sumula-331.md', SUMULA));
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].rotulo, 'Súmula nº 331 do TST');
  assert.match(d[0].texto, /responsabilidade subsidiária/);
});

test('dividirEmDispositivos: jurisprudência nunca quebra por "Art." citado no precedente; tira bloco de dados e junta hifenização do PDF', () => {
  const md = '---\ntitulo: "Súmula nº 309 do STJ"\ntribunal: "STJ"\ntipo: "Súmula"\nnumero: "309"\nfonte: "x"\n---\n# Súmula nº 309 do STJ\n\nO débito alimentar que autoriza a prisão civil do alimen-\ntante é o que compreende as três prestações anteriores.\n\nArt. 733 do CPC/73 citado no precedente.\n\n```json\n{"highlight": "duplicado"}\n```\n';
  const d = dividirEmDispositivos(lerNorma('jurisprudencia/stj/sumulas/sumula-309.md', md));
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].rotulo, 'Súmula nº 309 do STJ');
  assert.match(d[0].texto, /alimentante/);
  assert.match(d[0].texto, /Art\. 733/);
  assert.doesNotMatch(d[0].texto, /highlight/);
});

test('dividirEmDispositivos: texto longo sem artigos é cortado em trechos', () => {
  const corpo = Array.from({ length: 40 }, (_, i) => `Parágrafo ${i} ` + 'palavra '.repeat(80)).join('\n\n');
  const d = dividirEmDispositivos(lerNorma('reguladores/inss/x.md', `---\ntitulo: "Portaria"\ntipo: "Portaria"\nnumero: "1"\nfonte: "x"\n---\n# Portaria\n\n${corpo}`));
  assert.ok(d.length > 3);
  assert.ok(d.every((x) => x.texto.length <= 4200));
  assert.strictEqual(d[0].rotulo, 'Trecho 1');
});

test('extrairCitacoes: artigo com apelido (CLT, CF/88, CPC, Código Civil), com inciso e lista de artigos', () => {
  const c = extrairCitacoes('Nos termos do art. 482, alínea "i", da CLT e do art. 7º, XXIX, da CF/88, bem como dos arts. 319 e 320 do CPC e do art. 186 do Código Civil.');
  const resumo = c.map((x) => `${x.norma.apelido || x.norma.tipo + ' ' + x.norma.numero}:${x.artigos.join(',')}`);
  assert.deepStrictEqual(resumo, ['CLT:482', 'CF:7', 'CPC:319,320', 'CC:186']);
  assert.strictEqual(c[0].tipo, 'artigo');
  assert.match(c[1].detalhe, /XXIX/);
});

test('extrairCitacoes: lei por número e ano (curto e longo), norma antes do artigo, LC e decreto', () => {
  const c = extrairCitacoes('Aplica-se o art. 42 da Lei nº 8.213/91; também a Lei 8.213, de 24 de julho de 1991, art. 59; o art. 1º da Lei Complementar nº 150/2015 e o art. 18 do Decreto nº 3.048/99.');
  const r = c.map((x) => `${x.norma.tipo}:${x.norma.numero}/${x.norma.ano}:${x.artigos.join(',')}`);
  assert.deepStrictEqual(r, ['lei:8213/1991:42', 'lei:8213/1991:59', 'lc:150/2015:1', 'decreto:3048/1999:18']);
});

test('extrairCitacoes: súmulas, súmula vinculante, OJ e lei citada sem artigo', () => {
  const c = extrairCitacoes('Conforme a Súmula 331, IV, do TST, a Súmula Vinculante nº 4, a Súmula nº 106 do STJ, a OJ 394 da SDI-1 do TST e a Lei nº 13.467/2017.');
  const r = c.map((x) => x.tipo === 'norma' ? `norma:${x.norma.numero}/${x.norma.ano}` : `${x.tipo}:${x.tribunal}:${x.numero}`);
  assert.deepStrictEqual(r, ['sumula:TST:331', 'sumula_vinculante:STF:4', 'sumula:STJ:106', 'oj:TST:SDI1-394', 'norma:13467/2017']);
});

test('extrairCitacoes: "desta Lei" e artigo sem norma não viram citação conferível', () => {
  assert.deepStrictEqual(extrairCitacoes('na forma do art. 5º desta Lei e do artigo anterior.'), []);
});

test('interpretarPergunta: o que se digita na busca vira citação ("art 482 clt", "clt 482", "sumula 331 tst")', () => {
  const r = (q) => interpretarPergunta(q).map((x) => x.tipo === 'artigo' ? `${x.norma.apelido || x.norma.numero}:${x.artigos.join(',')}` : `${x.tipo}:${x.tribunal}:${x.numero}`);
  assert.deepStrictEqual(r('art 482 clt'), ['CLT:482']);
  assert.deepStrictEqual(r('Art. 7º da CF'), ['CF:7']);
  assert.deepStrictEqual(r('clt 477'), ['CLT:477']);
  assert.deepStrictEqual(r('lei 8213/91 art 42'), ['8213:42']);
  assert.deepStrictEqual(r('sumula 331 tst'), ['sumula:TST:331']);
  assert.deepStrictEqual(r('tema 1046 stf'), ['tema_rg:STF:1046']);
  assert.deepStrictEqual(r('justa causa abandono'), []);
});

test('montarConsulta: tira acento e palavras vazias, prefixo nas palavras longas, frase entre aspas e só OU como alternativa', () => {
  assert.strictEqual(montarConsulta('Demissão por justa causa'), '"demissao"* "justa"* "causa"*');
  assert.strictEqual(montarConsulta('"justa causa" abandono'), '"justa causa" "abandono"*');
  assert.strictEqual(montarConsulta('demissão justa', { ou: true }), '"demissao"* OR "justa"*');
  assert.strictEqual(montarConsulta('de a o "'), '');
  assert.strictEqual(montarConsulta('NEAR(x) AND -y'), '"near"* "and"');
});

test('caminhoNoAcervo: só .md das pastas do acervo, sem pastas internas (_auditoria, _fonte)', () => {
  assert.strictEqual(caminhoNoAcervo('federal/leis-ordinarias/1991/lei-8213-1991-07-24.md'), true);
  assert.strictEqual(caminhoNoAcervo('constituicao.md'), true);
  assert.strictEqual(caminhoNoAcervo('estaduais/ES/leis-ordinarias/2010/a.md'), true);
  assert.strictEqual(caminhoNoAcervo('estaduais/SP/leis-ordinarias/2010/a.md'), false);
  assert.strictEqual(caminhoNoAcervo('federal/_fonte/x.md'), false);
  assert.strictEqual(caminhoNoAcervo('federal/leis-ordinarias/_falhas.jsonl'), false);
  assert.strictEqual(caminhoNoAcervo('README.md'), false);
});

test('ordenarResultados: Constituição e códigos sobem, revogado desce', () => {
  const base = { titulo: 't', rotulo: 'Art. 1', trecho: '', normaId: 1, dispositivoId: 1, fonte: '', uf: null, tribunal: null, tipoChave: 'lei', apelido: null, revogado: false, normaRevogada: false };
  const r = ordenarResultados([
    { ...base, dispositivoId: 1, esfera: 'estadual', relevancia: 10 },
    { ...base, dispositivoId: 2, esfera: 'federal', relevancia: 10, apelido: 'CLT' },
    { ...base, dispositivoId: 3, esfera: 'federal', relevancia: 12, revogado: true },
  ]);
  assert.deepStrictEqual(r.map((x) => x.dispositivoId), [2, 1, 3]);
});

test('formatarCitacao: forma de petição com apelido e com número/ano', () => {
  assert.strictEqual(formatarCitacao({ titulo: 'Decreto-Lei nº 5.452 de 01/05/1943', apelido: 'CLT', tipoChave: 'dl', numero: '5452', ano: 1943 }, { rotulo: 'Art. 482' }),
    'art. 482 da CLT (Decreto-Lei nº 5.452/1943)');
  assert.strictEqual(formatarCitacao({ titulo: 'Lei nº 8.213 de 24/07/1991', apelido: null, tipoChave: 'lei', numero: '8213', ano: 1991 }, { rotulo: 'Art. 42' }),
    'art. 42 da Lei nº 8.213/1991');
  assert.strictEqual(formatarCitacao({ titulo: 'Súmula nº 331 do TST', tipoChave: 'sumula', numero: '331', ano: 2011 }, null), 'Súmula nº 331 do TST');
});

test('avaliarCitacao: confere, artigo revogado, norma revogada, artigo inexistente e fora do acervo', () => {
  const norma = { id: 1, titulo: 'Lei', revogada: false };
  assert.strictEqual(avaliarCitacao(norma, [{ numero: '42', revogado: false }], ['42']).situacao, 'confere');
  assert.strictEqual(avaliarCitacao(norma, [{ numero: '42', revogado: true }], ['42']).situacao, 'artigo_revogado');
  assert.strictEqual(avaliarCitacao({ ...norma, revogada: true }, [{ numero: '42', revogado: false }], ['42']).situacao, 'norma_revogada');
  assert.strictEqual(avaliarCitacao(norma, [], ['999']).situacao, 'artigo_inexistente');
  assert.strictEqual(avaliarCitacao(null, [], ['1']).situacao, 'fora_do_acervo');
  assert.strictEqual(avaliarCitacao(norma, [], []).situacao, 'confere', 'lei citada sem artigo: basta existir');
});

test('trechoRelevante: leva à IA o parágrafo, inciso ou item citado, e não só o começo do artigo', () => {
  const art = 'Art. 477. Na extinção do contrato, o empregador anotará a CTPS. ' + 'x '.repeat(900) + '\n§ 6º A entrega dos documentos e o pagamento das verbas deverão ser efetuados até dez dias.\n§ 7º (Revogado).';
  const t = trechoRelevante(art, '§ 6º', 600);
  assert.match(t, /^Art\. 477\./);
  assert.match(t, /§ 6º A entrega dos documentos/);
  assert.ok(t.length <= 900);
  const sum = 'SUM-331 CONTRATO DE PRESTAÇÃO DE SERVIÇOS\nI - A contratação por empresa interposta é ilegal. ' + 'y '.repeat(700) + '\nIV - O inadimplemento das obrigações trabalhistas implica a responsabilidade subsidiária do tomador.';
  assert.match(trechoRelevante(sum, 'IV', 600), /IV - O inadimplemento/);
  assert.match(trechoRelevante(sum, 'alínea "i"', 600), /^SUM-331/, 'sem achar o detalhe: o começo');
  assert.strictEqual(trechoRelevante('curto', '§ 1º', 600), 'curto');
});

test('dividirEmDispositivos: na jurisprudência, as marcas de título (## Questão) viram texto limpo', () => {
  const md = '---\ntitulo: "Tema de repercussão geral nº 1046 do STF"\ntribunal: "STF"\ntipo: "Tema de repercussão geral"\nnumero: "1046"\nfonte: "x"\n---\n# Tema 1046\n\n## Questão\n\nValidade de norma coletiva.\n\n## Tese\n\nSão constitucionais os acordos.';
  const d = dividirEmDispositivos(lerNorma('jurisprudencia/stf/repercussao-geral/tema-1046.md', md));
  assert.doesNotMatch(d[0].texto, /#/);
  assert.match(d[0].texto, /Tese/);
});

test('blocoFundamentos: texto oficial, fonte e a regra de só citar o que está na lista; vazio quando nada', () => {
  assert.strictEqual(blocoFundamentos([]), '');
  const b = blocoFundamentos([{ citacao: 'art. 482 da CLT (Decreto-Lei nº 5.452/1943)', texto: 'Constituem justa causa '.repeat(100), fonte: 'https://normas.leg.br/x' }]);
  assert.match(b, /FUNDAMENTOS LEGAIS CONFERIDOS/);
  assert.match(b, /art\. 482 da CLT/);
  assert.match(b, /https:\/\/normas\.leg\.br\/x/);
  assert.match(b, /\[conferir\]/);
  assert.ok(b.length < 1500, 'corta o texto de cada dispositivo');
});

test('relatorioConferencia: contagem por situação e o que fazer em cada problema', () => {
  const txt = relatorioConferencia([
    { trecho: 'art. 482 da CLT', situacao: 'confere', citacao: 'art. 482 da CLT', fonte: 'x', texto: 'Constituem justa causa' },
    { trecho: 'art. 999 da CLT', situacao: 'artigo_inexistente', citacao: 'CLT' },
    { trecho: 'Lei 1.234/2099', situacao: 'fora_do_acervo' },
  ]);
  assert.match(txt, /CONFERÊNCIA DAS CITAÇÕES/);
  assert.match(txt, /3 citação/);
  assert.match(txt, /1 confere/);
  assert.match(txt, /✗ art\. 999 da CLT/);
  assert.match(txt, /conferir manualmente/i);
  assert.strictEqual(relatorioConferencia([]), 'CONFERÊNCIA DAS CITAÇÕES (Dra. Vera): nenhuma citação de lei ou súmula encontrada na peça.');
});
