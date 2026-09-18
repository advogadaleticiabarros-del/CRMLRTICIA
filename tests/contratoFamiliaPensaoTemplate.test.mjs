// Padrão fixo do escritório: toda causa de "família" cujo tipo_causa mencione
// "pensão" usa a minuta de 19 cláusulas de família/pensão alimentícia (pedido
// da Letícia em 2026-09-18), com honorários de êxito só sobre as diferenças
// retroativas. Cláusulas fixas — só mudam dados do cliente e valores.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/contractTemplates.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}

const { buildTemplate, buildTemplateFamiliaPensao, isPensaoAlimenticia } = await import('../dist/services/contractTemplates.js');

test('isPensaoAlimenticia reconhece área família + tipo de causa com "pensão" (com ou sem acento)', () => {
  assert.equal(isPensaoAlimenticia('familia', 'Pensão alimentícia'), true);
  assert.equal(isPensaoAlimenticia('familia', 'pensao alimenticia'), true);
  assert.equal(isPensaoAlimenticia('familia', 'Divórcio'), false);
  assert.equal(isPensaoAlimenticia('civel', 'Pensão alimentícia'), false);
});

test('buildTemplate roteia família + pensão para a minuta fixa de 19 cláusulas', () => {
  const content = buildTemplate({
    area: 'familia',
    tipoCausa: 'Pensão alimentícia',
    party: { name: 'Maryani Vitória Pereira Lopes', cpf: '157.840.897-06', profissao: 'Tec em Seg do trabalho', endereco: 'Merlo, 11, Vitoria/ES', email: 'maryanivitoria6@gmail.com', phone: '27996642408' },
    honorarios: { parcelamento: { total: 5000, entrada: 800, entrada_data: '2026-09-18', parcelas: 8, valor_parcela: 466.66, ultima_parcela: 466.72, primeiro_vencimento: '2026-10-10' } },
  });
  assert.match(content, /Maryani Vitória Pereira Lopes/);
  assert.match(content, /157\.840\.897-06/);
  assert.match(content, /HONORÁRIOS DE ÊXITO SOBRE AS DIFERENÇAS RETROATIVAS/);
  assert.match(content, /CLÁUSULA DÉCIMA NONA – DO FORO/);
  assert.match(content, /800,00/);
  assert.match(content, /466,66/);
  assert.match(content, /30% \(trinta por cento\)/);
});

test('buildTemplate NÃO usa a minuta de pensão para outras causas de família (ex.: divórcio)', () => {
  const content = buildTemplate({ area: 'familia', tipoCausa: 'Divórcio', party: { name: 'Cliente Teste' } });
  assert.doesNotMatch(content, /HONORÁRIOS DE ÊXITO SOBRE AS DIFERENÇAS RETROATIVAS/);
});

test('buildTemplateFamiliaPensao usa êxito padrão de 30% quando a proposta não define percentual', () => {
  const content = buildTemplateFamiliaPensao({ party: { name: 'Cliente Teste' } });
  assert.match(content, /30% \(trinta por cento\)/);
});

test('buildTemplateFamiliaPensao respeita o percentual de êxito definido na proposta', () => {
  const content = buildTemplateFamiliaPensao({ party: { name: 'Cliente Teste' }, honorarios: { values: { exito: 20 } } });
  assert.match(content, /20% \(vinte por cento\)/);
});
