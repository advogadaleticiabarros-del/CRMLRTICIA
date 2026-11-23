// tests/corpoMidiaWhatsapp.test.mjs — mídia com legenda que falha precisa poder ser recuperada (23/11/2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corpoComFalhaDeMidia, corpoMidiaRecuperada } from '../dist/services/corpoMidiaWhatsapp.js';

test('falha com legenda: guarda a legenda E a marca que a varredura procura', () => {
  const c = corpoComFalhaDeMidia('segue meu laudo', false, 'DocumentMessage');
  assert.match(c, /^segue meu laudo\n/);
  assert.match(c, /falhou ao baixar \(tipo: DocumentMessage\)/); // LIKE '%falhou ao baixar%' + tipo para tentar de novo
});

test('falha sem legenda: só o aviso; enviada pela equipe diz "por você"', () => {
  assert.equal(corpoComFalhaDeMidia('', false, 'image'), '⚠️ Mídia recebida, mas falhou ao baixar (tipo: image)');
  assert.match(corpoComFalhaDeMidia(null, true, 'ptt'), /enviada por você/);
});

test('recuperada: a legenda volta inteira; sem legenda vira o rótulo do arquivo', () => {
  assert.equal(corpoMidiaRecuperada(corpoComFalhaDeMidia('segue meu laudo', false, 'DocumentMessage'), 'Documento'), 'segue meu laudo');
  assert.equal(corpoMidiaRecuperada(corpoComFalhaDeMidia('', false, 'image'), 'Imagem'), '📎 Imagem');
});
