// tests/papelTimbrado.test.mjs — a Dra. cola a peça revisada e o CRM devolve no papel timbrado,
// na formatação das peças (pedido de 30/10/2026: "eu só quero colar lá, para que deixe no papel
// timbrado e deixe na formatação correta para peças"). Formatação cobrada por ela: Times 12,
// espaçamento 1,5, justificado, recuo de 2,5 cm na 1ª linha; endereçamento e títulos em negrito
// e centralizados; fecho, data e assinatura presos, sem quebrar de página.
import { test } from 'node:test';
import assert from 'node:assert';
import JSZip from 'jszip';
import { formatarPeca, paragrafosDoTexto, validarParagrafos, docxNoTimbrado } from '../dist/services/papelTimbrado.js';

const p = (texto, extra = {}) => ({ tipo: 'p', alinhamento: '', runs: [{ t: texto }], ...extra });

test('texto colado: cada linha vira parágrafo; **negrito** vira negrito', () => {
  const ps = paragrafosDoTexto('EXCELENTÍSSIMO SENHOR JUIZ\n\nFulano, **já qualificado**, vem propor.\n');
  assert.strictEqual(ps.length, 2);
  assert.deepStrictEqual(ps[1].runs, [{ t: 'Fulano, ' }, { t: 'já qualificado', b: true }, { t: ', vem propor.' }]);
});

test('formatação das peças: endereçamento e títulos centralizados em negrito; corpo justificado com recuo de 2,5 cm', () => {
  const f = formatarPeca([
    p('EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DO JUIZADO ESPECIAL CÍVEL DE VITÓRIA/ES'),
    p('Fulano, brasileiro, aposentado, vem propor a presente AÇÃO DECLARATÓRIA em face do Banco Teste S.A.'),
    p('I – DOS FATOS'),
    p('O autor percebeu descontos.'),
  ]);
  assert.strictEqual(f[0].estilo, 'titulo');
  assert.strictEqual(f[1].estilo, 'corpo', 'texto longo com palavra em maiúsculas continua corpo');
  assert.strictEqual(f[2].estilo, 'titulo');
  assert.strictEqual(f[3].estilo, 'corpo');
});

test('formatação: citação (recuo de 4 cm, letra menor) e alinhamento escolhido pela Dra. é respeitado', () => {
  const f = formatarPeca([p('Art. 42. O consumidor cobrado em quantia indevida...', { tipo: 'citacao' }), p('texto à direita', { alinhamento: 'right' })]);
  assert.strictEqual(f[0].estilo, 'citacao');
  assert.strictEqual(f[1].alinhamento, 'right');
});

test('formatação: do fecho até a assinatura fica tudo preso (não quebra de página) e centralizado', () => {
  const f = formatarPeca([
    p('Ante o exposto, requer a procedência.'),
    p('Nestes termos, pede deferimento.'),
    p('Vitória/ES, 30 de outubro de 2026.'),
    p('LETÍCIA ELIAS BARROS'),
    p('Advogada'),
    p('OAB/ES nº 39.948'),
  ]);
  assert.strictEqual(f[0].estilo, 'corpo');
  assert.ok(f.slice(1).every((x) => x.estilo === 'fecho'), JSON.stringify(f.map((x) => x.estilo)));
  assert.ok(f.slice(1, -1).every((x) => x.prender), 'cada linha do fecho prende na seguinte');
  assert.strictEqual(f[f.length - 1].prender, false);
  assert.ok(f[3].espacoAssinatura, 'espaço para assinar antes do nome');
});

test('validação do que vem da tela: só texto e marcações conhecidas; limites de tamanho', () => {
  assert.throws(() => validarParagrafos('x'), /lista/);
  assert.throws(() => validarParagrafos([]), /vazia/);
  const v = validarParagrafos([{ tipo: 'script', alinhamento: 'evil', runs: [{ t: 'a', b: 'sim', x: 1 }, { t: 5 }] }]);
  assert.deepStrictEqual(v, [{ tipo: 'p', alinhamento: '', runs: [{ t: 'a', b: true }] }]);
});

test('docx no papel timbrado: mantém o cabeçalho e a página do timbrado e escreve a peça em Times 12, 1,5', async () => {
  const buf = await docxNoTimbrado(formatarPeca([p('EXCELENTÍSSIMO SENHOR JUIZ'), p('Corpo com <tag> & "aspas".'), p('Nestes termos, pede deferimento.')]));
  const z = await JSZip.loadAsync(buf);
  assert.ok(z.file('word/header1.xml'), 'cabeçalho do timbrado');
  assert.ok(z.file('word/media/image1.png'), 'imagem do timbrado');
  const xml = await z.file('word/document.xml').async('string');
  assert.ok(xml.includes('<w:headerReference'), 'a seção continua usando o cabeçalho');
  assert.ok(xml.includes('Times New Roman') && xml.includes('w:sz w:val="24"') && xml.includes('w:line="360"'));
  assert.ok(xml.includes('w:firstLine="1417"'), 'recuo de 2,5 cm');
  assert.ok(xml.includes('Corpo com &lt;tag&gt; &amp; &quot;aspas&quot;.'), 'texto escapado');
  assert.ok(xml.includes('<w:keepNext/>'));
  assert.ok(!/ADRIANA|FACTA/.test(xml), 'o modelo guardado não traz peça de cliente');
});
