// Ideia 8 (baixa) da auditoria de Processos e prazos (28/09/2026): regras
// determinísticas sem nenhum teste — fase sugerida do processo e escolha do
// tribunal pelo número CNJ. Compila as unidades puras em pasta temporária.
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'faseTrib-'));
execSync(`npx tsc src/utils/faseProcesso.ts src/services/datajud.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const carregar = async (f) => (await import(pathToFileURL(path.join(out, f)).href)).default;
const { faseSugeridaDoTexto, melhorFase } = await carregar('utils/faseProcesso.js');
const { tribunalSlugFromNumber, aliasFromProcessNumber, suggestCourtAlias } = await carregar('services/datajud.js');

test('fase sugerida por texto de movimentação', () => {
  assert.equal(faseSugeridaDoTexto('Trânsito em julgado certificado'), 'encerrado');
  assert.equal(faseSugeridaDoTexto('Processo arquivado definitivamente'), 'encerrado');
  assert.equal(faseSugeridaDoTexto('Início do cumprimento de sentença'), 'execucao');
  assert.equal(faseSugeridaDoTexto('Penhora via SISBAJUD'), 'execucao');
  assert.equal(faseSugeridaDoTexto('Acórdão publicado'), 'recurso');
  assert.equal(faseSugeridaDoTexto('Embargos de declaração opostos'), 'recurso');
  assert.equal(faseSugeridaDoTexto('Sentença de procedência'), 'sentenca');
  assert.equal(faseSugeridaDoTexto('Designada audiência de instrução'), 'instrucao');
  assert.equal(faseSugeridaDoTexto('Citação da parte ré'), 'inicial');
  assert.equal(faseSugeridaDoTexto('Juntada de petição'), null);
  assert.equal(faseSugeridaDoTexto(''), null);
});

test('mais avançada vence: cumprimento de sentença é execução, não sentença', () => {
  assert.equal(faseSugeridaDoTexto('Cumprimento de sentença iniciado'), 'execucao');
});

test('frases-padrão de intimação que só MENCIONAM recurso/sentença futura não mudam a fase (incidente 07/10/2026)', () => {
  // textos reais do DJEN (JFES) de processos que estavam na perícia
  assert.equal(faseSugeridaDoTexto('A apresentação dos quesitos, até a data da perícia, deverá ser feita por meio de recurso apropriado do e-Proc, disponível ao consultar o processo'), 'instrucao');
  assert.equal(faseSugeridaDoTexto('Se a parte é incapaz, dê-se vista ao Ministério Público Federal. Por fim, venham conclusos para sentença. ORIENTAÇÕES GERAIS SOBRE PERÍCIA'), 'instrucao');
  assert.equal(faseSugeridaDoTexto('cognição sumária determinando o pagamento do referido benefício, na hipótese de eventual sentença de improcedência, não há nada que indique'), null);
  assert.equal(faseSugeridaDoTexto('Em caso de eventual recurso, intime-se a parte contrária'), null);
  // e continuam valendo os atos reais
  assert.equal(faseSugeridaDoTexto('Julgado improcedente o pedido - tipo A'), 'sentenca');
  assert.equal(faseSugeridaDoTexto('RECURSO INOMINADO - Refer. ao Evento 30'), 'recurso');
  assert.equal(faseSugeridaDoTexto('Expedida intimação eletrônica - Contrarrazões ao recurso inominado'), 'recurso');
  assert.equal(faseSugeridaDoTexto('Conclusos para sentença'), 'sentenca');
  assert.equal(faseSugeridaDoTexto('SENTENÇA: Ante o exposto, JULGO PROCEDENTE o pedido'), 'sentenca');
});

test('melhorFase escolhe o estágio mais avançado entre todas as movimentações', () => {
  assert.equal(melhorFase(['Citação da ré', 'Audiência de instrução', 'Sentença']), 'sentenca');
  assert.equal(melhorFase(['Sentença', 'Citação da ré']), 'sentenca');
  assert.equal(melhorFase(['Juntada', 'Certidão']), null);
  assert.equal(melhorFase([]), null);
});

test('tribunal pelo número CNJ: justiça estadual, federal e trabalhista', () => {
  assert.equal(tribunalSlugFromNumber('0001234-56.2024.8.08.0001'), 'tjes');
  assert.equal(tribunalSlugFromNumber('0001234-56.2024.8.18.0001'), 'tjpr');
  assert.equal(tribunalSlugFromNumber('0001234-56.2024.8.07.0001'), 'tjdft');
  assert.equal(tribunalSlugFromNumber('0001234-56.2024.4.02.5001'), 'trf2');
  assert.equal(tribunalSlugFromNumber('0001234-56.2024.5.17.0001'), 'trt17');
  assert.equal(tribunalSlugFromNumber('00012345620248080001'), 'tjes'); // só dígitos
});

test('número curto/indecifrável ou código de tribunal desconhecido → null (nunca "tj" solto)', () => {
  assert.equal(tribunalSlugFromNumber('123'), null);
  assert.equal(tribunalSlugFromNumber(''), null);
  assert.equal(tribunalSlugFromNumber('0001234-56.2024.8.99.0001'), null);
  assert.equal(aliasFromProcessNumber('0001234-56.2024.8.99.0001'), null);
});

test('alias DataJud e sugestão de tribunal por área/UF', () => {
  assert.equal(aliasFromProcessNumber('0001234-56.2024.8.08.0001'), 'api_publica_tjes');
  assert.equal(suggestCourtAlias('trabalhista', 'ES'), 'api_publica_trt17');
  assert.equal(suggestCourtAlias('previdenciario', 'PR'), 'api_publica_trf4');
  assert.equal(suggestCourtAlias('civel', 'ES'), 'api_publica_tjes');
  assert.equal(suggestCourtAlias('civel', 'SP'), null);
});
