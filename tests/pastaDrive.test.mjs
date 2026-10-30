// tests/pastaDrive.test.mjs — pasta do Drive do caso (30/10/2026, caso do Valmirio):
// a pasta é lida com as subpastas, só entra arquivo novo, e o erro do Google aparece
// (antes virava "pasta vazia" em silêncio).
import { test } from 'node:test';
import assert from 'node:assert';
import { idDaPasta, listarPasta, sincronizarPasta, erroDoDrive } from '../dist/services/pastaDrive.js';

const PASTA = 'application/vnd.google-apps.folder';
const arvore = {
  raiz: [
    { id: 'a1', name: 'RG.pdf', mimeType: 'application/pdf' },
    { id: 'sub', name: 'Extratos', mimeType: PASTA },
  ],
  sub: [{ id: 'a2', name: 'HISCON.pdf', mimeType: 'application/pdf' }],
};
const listarFilhos = async (id) => arvore[id] || [];

test('idDaPasta: aceita o link com /u/0/ e o id puro', () => {
  assert.strictEqual(idDaPasta('https://drive.google.com/drive/u/0/folders/1_mdX_vExC70sC0JPtQQpKcckao5AHcjl'), '1_mdX_vExC70sC0JPtQQpKcckao5AHcjl');
  assert.strictEqual(idDaPasta('https://drive.google.com/drive/folders/abcABC123_-xyzXYZ9876?usp=sharing'), 'abcABC123_-xyzXYZ9876');
  assert.strictEqual(idDaPasta('texto qualquer'), null);
});

test('listarPasta: entra nas subpastas e devolve só arquivos', async () => {
  const r = await listarPasta(listarFilhos, 'raiz');
  assert.deepStrictEqual(r.map((f) => f.name).sort(), ['HISCON.pdf', 'RG.pdf']);
});

test('sincronizarPasta: grava só o que é novo, com o texto lido', async () => {
  const gravados = [];
  const deps = {
    listarFilhos,
    jaTem: async (_caseId, nome) => nome === 'RG.pdf',
    ler: async (f) => `texto de ${f.name}`,
    gravar: async (d) => { gravados.push(d); },
  };
  const r = await sincronizarPasta(deps, { caseId: 115, clientId: 9, folderUrl: 'https://drive.google.com/drive/folders/raizraizraizraizraiz00', actorId: 1, pastaId: 'raiz' });
  assert.deepStrictEqual(r.novos, ['HISCON.pdf']);
  assert.strictEqual(r.erro, undefined);
  assert.strictEqual(gravados.length, 1);
  assert.strictEqual(gravados[0].link, 'https://drive.google.com/file/d/a2/view');
  assert.strictEqual(gravados[0].conteudo, 'texto de HISCON.pdf');
});

test('sincronizarPasta: falha do Google vira mensagem clara, não "pasta vazia"', async () => {
  const deps = {
    listarFilhos: async () => { const e = new Error('File not found: x.'); e.code = 404; throw e; },
    jaTem: async () => false, ler: async () => null, gravar: async () => {},
  };
  const r = await sincronizarPasta(deps, { caseId: 1, clientId: 1, folderUrl: 'https://drive.google.com/drive/folders/abcABC123_-xyzXYZ9876', actorId: 1 }, 'crm@exemplo.com');
  assert.deepStrictEqual(r.novos, []);
  assert.match(r.erro, /não está compartilhada/);
  assert.match(r.erro, /crm@exemplo\.com/);
});

test('sincronizarPasta: link que não é de pasta avisa', async () => {
  const r = await sincronizarPasta({ listarFilhos, jaTem: async () => false, ler: async () => null, gravar: async () => {} },
    { caseId: 1, clientId: 1, folderUrl: 'https://exemplo.com', actorId: 1 });
  assert.match(r.erro, /link da pasta/);
});

test('erroDoDrive: permissão insuficiente e conexão expirada', () => {
  assert.match(erroDoDrive({ code: 403, message: 'Request had insufficient authentication scopes.' }), /reconect/i);
  assert.match(erroDoDrive({ message: 'invalid_grant' }), /reconect/i);
  assert.match(erroDoDrive(new Error('Gmail da parceria não conectado')), /não está conectado/);
});

test('sincronizarPasta: um arquivo que falha não impede os outros', async () => {
  const gravados = [];
  const deps = {
    listarFilhos, jaTem: async () => false,
    ler: async (f) => { if (f.name === 'RG.pdf') throw new Error('IA fora'); return 'ok'; },
    gravar: async (d) => { gravados.push(d.nome); },
  };
  const r = await sincronizarPasta(deps, { caseId: 1, clientId: 1, folderUrl: '', actorId: 1, pastaId: 'raiz' });
  assert.deepStrictEqual(gravados.sort(), ['HISCON.pdf', 'RG.pdf']); // RG entra só com o link, sem texto
  assert.strictEqual(r.novos.length, 2);
});

test('sincronizarPasta: avisa o andamento arquivo a arquivo (barra da tela, 30/10/2026)', async () => {
  const passos = [];
  const deps = { listarFilhos, jaTem: async (_c, nome) => nome === 'RG.pdf', ler: async () => 'texto', gravar: async () => {} };
  await sincronizarPasta(deps, { caseId: 1, clientId: 2, folderUrl: 'raiz', actorId: 1, pastaId: 'raiz' }, null,
    (feito, total, nome) => passos.push([feito, total, nome]));
  assert.deepStrictEqual(passos[0], [0, 2, null], 'primeiro: quantos arquivos há na pasta');
  assert.deepStrictEqual(passos.at(-1), [2, 2, null], 'por último: todos vistos');
  assert.ok(passos.some(([, , n]) => n === 'HISCON.pdf'), 'mostra o nome do arquivo que está lendo');
});
