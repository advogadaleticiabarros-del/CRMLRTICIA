// tests/contratoAvisoIa.test.mjs — todo contrato padrão informa o uso de IA
// (Recomendação 001/2024 do CFOAB: transparência com o cliente; decisão da Dra. em 14/10/2026).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildTemplate, buildTemplateFamiliaPensao, buildTemplateMenor, AVISO_USO_IA,
} from '../dist/services/contractTemplates.js';

const temAviso = (txt) => txt.includes(AVISO_USO_IA);

test('AVISO_USO_IA: deixa claro que a IA é apoio e a advogada revisa e responde', () => {
  assert.match(AVISO_USO_IA, /inteligência artificial/);
  assert.match(AVISO_USO_IA, /revis/);
  assert.match(AVISO_USO_IA, /responsab/);
  assert.match(AVISO_USO_IA, /sigilo/);
});

test('contrato trabalhista traz o aviso de uso de IA', () => {
  assert.ok(temAviso(buildTemplate({ clientName: 'Fulana Teste', area: 'trabalhista' })));
});

test('contrato de pensão alimentícia traz o aviso de uso de IA', () => {
  assert.ok(temAviso(buildTemplateFamiliaPensao({ clientName: 'Fulana Teste' })));
});

test('contrato genérico (consumidor, previdenciário) traz o aviso de uso de IA', () => {
  assert.ok(temAviso(buildTemplate({ clientName: 'Fulana Teste', area: 'consumidor' })));
  assert.ok(temAviso(buildTemplate({ clientName: 'Fulana Teste', area: 'previdenciario' })));
});

test('contrato de representação de menor traz o aviso de uso de IA', () => {
  assert.ok(temAviso(buildTemplateMenor({})));
});
