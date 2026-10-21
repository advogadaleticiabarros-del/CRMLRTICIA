// tests/leisAcervo.test.mjs — Pesquisa de Leis: índice SQLite (gravar, buscar, localizar, conferir, fundamentos)
import { test } from 'node:test';
import assert from 'node:assert';
import { abrirAcervo } from '../dist/services/leisAcervo.js';

const cab = (campos) => '---\n' + Object.entries(campos).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`).join('\n') + '\n---\n';

const CLT = cab({ titulo: 'Decreto-Lei nº 5.452 de 01/05/1943', tipo: 'Decreto-Lei', numero: '5452', data: '1943-05-01', ementa: 'Aprova a Consolidação das Leis do Trabalho.', revogada: false, fonte: 'https://normas.leg.br/clt' })
  + `# Decreto-Lei nº 5.452 de 01/05/1943

**Art. 1º** Fica aprovada a Consolidação das Leis do Trabalho.

**Art. 2º** Este decreto-lei entra em vigor em 10 de novembro de 1943.

> **Art. 1º** Esta Consolidação estatui as normas que regulam as relações individuais e coletivas de trabalho.

> **Art. 2º** Considera-se empregador a empresa que assume os riscos da atividade econômica.

> **Art. 3º** Considera-se empregado toda pessoa física que prestar serviços de natureza não eventual a empregador.

> **Art. 477.** Na extinção do contrato de trabalho, o empregador deverá pagar as verbas rescisórias no prazo de dez dias.

> **Art. 482.** Constituem justa causa para rescisão do contrato de trabalho pelo empregador:
  a) ato de improbidade;
  i) abandono de emprego;

**Art. 902.** *(Revogado pela Lei nº 7.033, de 5/10/1982)*
`;

const LEI_8213 = cab({ titulo: 'Lei nº 8.213 de 24/07/1991', tipo: 'Lei Ordinária', numero: '8213', data: '1991-07-24', ementa: 'Dispõe sobre os Planos de Benefícios da Previdência Social.', revogada: false, fonte: 'https://normas.leg.br/8213' })
  + `# Lei nº 8.213

**Art. 42.** A aposentadoria por invalidez será devida ao segurado que for considerado incapaz para o trabalho.

**Art. 59.** O auxílio-doença será devido ao segurado que ficar incapacitado para o seu trabalho por mais de 15 dias consecutivos.
`;

const CF = `# Constituição da República Federativa do Brasil de 1988

**Art. 1º** A República Federativa do Brasil constitui-se em Estado Democrático de Direito.

**Art. 7º** São direitos dos trabalhadores urbanos e rurais:
XXIX - ação, quanto aos créditos resultantes das relações de trabalho, com prazo prescricional de cinco anos, até o limite de dois anos após a extinção do contrato de trabalho;

**Art. 10.** É assegurada a participação dos trabalhadores nos colegiados dos órgãos públicos.

## ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS

**Art. 1º** O Presidente da República prestará o compromisso.

**Art. 10.** Até que seja promulgada a lei complementar a que se refere o art. 7º, I, da Constituição, fica vedada a dispensa arbitrária da empregada gestante.
`;

const SUMULA = cab({ titulo: 'Súmula nº 331 do TST', tribunal: 'TST', tipo: 'Súmula', numero: '331', data: '2011-05-31', revogada: false, fonte: 'https://tst.jus.br/sumulas' })
  + '# Súmula nº 331 do TST\n\nIV - O inadimplemento das obrigações trabalhistas implica a responsabilidade subsidiária do tomador dos serviços.\n';

const LEI_ES = cab({ titulo: 'Lei Ordinária nº 9949/2012', uf: 'ES', tipo: 'Lei Ordinária', numero: '9949', data: '2012-12-06', ementa: 'Denomina quadra de esportes.', revogada: true, fonte: 'https://al.es.gov.br/9949' })
  + '# Lei 9949\n\n**Art. 1º** Fica denominada a quadra de esportes por justa causa de homenagem.\n';

function acervoDeTeste() {
  const a = abrirAcervo(':memory:');
  a.indexarArquivo('federal/decretos-lei/1943/del-5452-1943-05-01.md', CLT);
  a.indexarArquivo('federal/leis-ordinarias/1991/lei-8213-1991-07-24.md', LEI_8213);
  a.indexarArquivo('constituicao.md', CF);
  a.indexarArquivo('jurisprudencia/tst/sumulas/sumula-331.md', SUMULA);
  a.indexarArquivo('estaduais/ES/leis-ordinarias/2012/lei-9949-2012.md', LEI_ES);
  return a;
}

test('indexarArquivo: novo, igual (mesmo conteúdo) e atualizado; resumo conta normas e dispositivos', () => {
  const a = acervoDeTeste();
  assert.strictEqual(a.indexarArquivo('jurisprudencia/tst/sumulas/sumula-331.md', SUMULA), 'igual');
  assert.strictEqual(a.indexarArquivo('jurisprudencia/tst/sumulas/sumula-331.md', SUMULA + '\nV - novo item.'), 'atualizado');
  assert.strictEqual(a.indexarArquivo('README.md', '# x'), 'ignorado');
  const r = a.resumo();
  assert.strictEqual(r.normas, 5);
  assert.strictEqual(r.porEsfera.federal, 2);
  assert.strictEqual(r.porEsfera.jurisprudencia, 1);
  assert.ok(r.dispositivos >= 15);
});

test('buscar: palavras sem acento acham o artigo certo, com trecho marcado; CLT antes da lei estadual revogada', () => {
  const a = acervoDeTeste();
  const r = a.buscar('justa causa');
  assert.ok(r.length >= 2);
  assert.strictEqual(r[0].rotulo, 'Art. 482');
  assert.strictEqual(r[0].apelido, 'CLT');
  assert.match(r[0].trecho, /\[\[justa\]\] \[\[causa\]\]/i);
  assert.ok(r.findIndex((x) => x.esfera === 'estadual') > 0);
  assert.strictEqual(a.buscar('rescisao')[0].rotulo, 'Art. 482', 'acento não importa');
  assert.ok(a.buscar('verbas rescisórias prazo').some((x) => x.rotulo === 'Art. 477'));
});

test('buscar: artigo que fala do assunto vence artigo burocrático de lei cuja ementa fala do assunto', () => {
  const a = abrirAcervo(':memory:');
  a.indexarArquivo('federal/leis-complementares/2014/lcp-146-2014.md', cab({ titulo: 'Lei Complementar nº 146', tipo: 'Lei Complementar', numero: '146', data: '2014-06-25', ementa: 'Estende a estabilidade provisória da gestante.', fonte: 'x' })
    + '# LC\n\n**Art. 1º** O direito previsto no art. 10 do ADCT será assegurado a quem detiver a guarda do filho.\n\n**Art. 2º** Esta Lei Complementar entra em vigor na data de sua publicação.\n');
  a.indexarArquivo('jurisprudencia/tst/sumulas/sumula-244.md', cab({ titulo: 'Súmula nº 244 do TST', tribunal: 'TST', tipo: 'Súmula', numero: '244', fonte: 'x' })
    + '# Súmula nº 244 do TST\n\nGESTANTE. ESTABILIDADE PROVISÓRIA. O desconhecimento do estado gravídico não afasta o direito à estabilidade da gestante.\n');
  a.indexarArquivo('federal/leis-ordinarias/2000/lei-1-2000.md', cab({ titulo: 'Lei nº 1 de 01/01/2000', tipo: 'Lei Ordinária', numero: '1', data: '2000-01-01', ementa: 'Altera regras do trabalho.', fonte: 'x' })
    + '# Lei\n\n**Art. 1º** A confirmação do estado de gravidez garante à empregada gestante a estabilidade provisória.\n');
  const r = a.buscar('estabilidade gestante');
  const pos = (rotulo, titulo) => r.findIndex((x) => x.rotulo === rotulo && x.titulo.startsWith(titulo));
  assert.ok(pos('Art. 1º', 'Lei nº 1') < pos('Art. 2º', 'Lei Complementar'), 'quem trata do assunto no texto vem antes');
  assert.ok(pos('Súmula nº 244 do TST', 'Súmula') < pos('Art. 2º', 'Lei Complementar'));
});

test('buscar: filtros por esfera e só em vigor; palavra que não existe → vazio (sem erro de sintaxe)', () => {
  const a = acervoDeTeste();
  assert.ok(a.buscar('justa causa', { esferas: ['estadual'] }).every((x) => x.esfera === 'estadual'));
  assert.ok(a.buscar('justa causa', { vigentes: true }).every((x) => !x.normaRevogada && !x.revogado));
  assert.deepStrictEqual(a.buscar('xyzabc'), []);
  assert.deepStrictEqual(a.buscar('NEAR( "'), []);
});

test('buscar: citação digitada vai direto ao dispositivo ("art 482 clt", "sumula 331 tst", "art 10 adct")', () => {
  const a = acervoDeTeste();
  const r = a.buscar('art 482 clt');
  assert.strictEqual(r[0].rotulo, 'Art. 482');
  assert.strictEqual(r[0].exato, true);
  assert.strictEqual(a.buscar('sumula 331 tst')[0].titulo, 'Súmula nº 331 do TST');
  const adct = a.buscar('art. 10 do ADCT')[0];
  assert.match(adct.trecho, /gestante/);
  const cf10 = a.buscar('art. 10 da CF')[0];
  assert.match(cf10.trecho, /colegiados/);
});

test('norma e dispositivo: sumário da lei e texto integral do artigo', () => {
  const a = acervoDeTeste();
  const id = a.buscar('art 482 clt')[0].normaId;
  const n = a.norma(id);
  assert.strictEqual(n.apelido, 'CLT');
  assert.ok(n.dispositivos.some((d) => d.rotulo === 'Art. 482'));
  assert.ok(n.dispositivos.find((d) => d.numero === '902').revogado);
  const d = a.dispositivo(n.dispositivos.find((x) => x.numero === '482').id);
  assert.match(d.texto, /abandono de emprego/);
  assert.strictEqual(d.citacao, 'art. 482 da CLT (Decreto-Lei nº 5.452/1943)');
  assert.strictEqual(a.norma(999999), null);
});

test('conferir: cada citação da peça com a situação no acervo', () => {
  const a = acervoDeTeste();
  const r = a.conferir('Com base no art. 482 da CLT, no art. 902 da CLT, no art. 999 da CLT, no art. 42 da Lei nº 8.213/91, na Súmula 331, IV, do TST, na Súmula 9999 do TST, no art. 7º, XXIX, da CF/88 e na Lei 1.234/2099.');
  const s = Object.fromEntries(r.map((x) => [x.trecho, x.situacao]));
  assert.strictEqual(s['art. 482 da CLT'], 'confere');
  assert.strictEqual(s['art. 902 da CLT'], 'artigo_revogado');
  assert.strictEqual(s['art. 999 da CLT'], 'artigo_inexistente');
  assert.strictEqual(s['art. 42 da Lei nº 8.213/91'], 'confere');
  assert.strictEqual(s['Súmula 331, IV, do TST'], 'confere');
  assert.strictEqual(s['Súmula 9999 do TST'], 'fora_do_acervo');
  assert.strictEqual(s['art. 7º, XXIX, da CF/88'], 'confere');
  assert.strictEqual(s['Lei 1.234/2099'], 'fora_do_acervo');
  const art482 = r.find((x) => x.trecho === 'art. 482 da CLT');
  assert.match(art482.texto, /justa causa/);
  assert.strictEqual(art482.fonte, 'https://normas.leg.br/clt');
  assert.strictEqual(art482.citacao, 'art. 482 da CLT (Decreto-Lei nº 5.452/1943)');
});

test('conferir: a mesma citação repetida aparece uma vez só', () => {
  const a = acervoDeTeste();
  const r = a.conferir('art. 482 da CLT ... de novo o art. 482 da CLT.');
  assert.strictEqual(r.length, 1);
});

test('fundamentos: só o que confere vira fundamento, um por artigo, com texto e fonte', () => {
  const a = acervoDeTeste();
  const f = a.fundamentos(['arts. 42 e 59 da Lei 8.213/91', 'art. 999 da CLT', 'Súmula 331 do TST', 'art. 902 da CLT']);
  assert.deepStrictEqual(f.map((x) => x.citacao), ['art. 42 da Lei nº 8.213/1991', 'art. 59 da Lei nº 8.213/1991', 'Súmula nº 331 do TST']);
  assert.match(f[1].texto, /auxílio-doença/);
  assert.strictEqual(f[0].fonte, 'https://normas.leg.br/8213');
});

test('localizarNorma: pelo apelido/número (atalhos da tela) e nada quando não existe', () => {
  const a = acervoDeTeste();
  assert.strictEqual(a.localizarNorma({ tipo: 'dl', numero: '5452', ano: 1943 }).titulo, 'Decreto-Lei nº 5.452 de 01/05/1943');
  assert.match(a.localizarNorma({ tipo: 'cf' }).titulo, /Constituição/);
  assert.strictEqual(a.localizarNorma({ tipo: 'lei', numero: '8213' }).titulo, 'Lei nº 8.213 de 24/07/1991', 'sem ano: acha pelo número');
  assert.strictEqual(a.localizarNorma({ tipo: 'lei', numero: '13105', ano: 2015 }), null);
});

test('removerNorma: sai do índice e da busca; meta guarda o commit', () => {
  const a = acervoDeTeste();
  a.removerNorma('jurisprudencia/tst/sumulas/sumula-331.md');
  assert.deepStrictEqual(a.buscar('sumula 331 tst').filter((x) => x.exato), []);
  assert.strictEqual(a.resumo().normas, 4);
  a.definirMeta('commit', 'abc123');
  assert.strictEqual(a.lerMeta('commit'), 'abc123');
  assert.strictEqual(a.resumo().commit, 'abc123');
});
