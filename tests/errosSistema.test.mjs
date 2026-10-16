// tests/errosSistema.test.mjs — rastreador de erros do CRM (sem serviço de fora)
import { test } from 'node:test';
import assert from 'node:assert';
import { mascarar, assinaturaErro, localDoErro, deveAvisar, ehRuido, mensagemAvisoErro, HORAS_ENTRE_AVISOS } from '../dist/services/errosSistema.js';

test('mascarar: CPF, CNPJ, processo, e-mail, telefone e token somem', () => {
  const t = mascarar('cpf 529.982.247-25 cnpj 11.222.333/0001-81 proc 0001234-56.2026.5.17.0003 a@b.com (27) 99999-8888 Bearer eyJabc.def.ghi');
  assert.doesNotMatch(t, /529\.982|11\.222|0001234|a@b\.com|99999|eyJ/);
  for (const x of ['[cpf]', '[cnpj]', '[processo]', '[e-mail]', '[telefone]', '[token]']) assert.ok(t.includes(x), x);
});

test('assinaturaErro: o mesmo erro com ids e datas diferentes agrupa; erros diferentes não', () => {
  const a = assinaturaErro('servidor', 'Cliente 123 não encontrado em 2026-10-16T10:00:00Z', '/api/clients/:id');
  const b = assinaturaErro('servidor', 'Cliente 987 não encontrado em 2026-10-17T11:30:00Z', '/api/clients/:id');
  const c = assinaturaErro('servidor', 'Unknown column x', '/api/clients/:id');
  const d = assinaturaErro('tela', 'Cliente 123 não encontrado em 2026-10-16T10:00:00Z', '/api/clients/:id');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.notStrictEqual(a, d);
});

test('localDoErro: rota sem ids nem query; sem rota, a 1ª linha útil da pilha', () => {
  assert.strictEqual(localDoErro('/api/clients/45/cases/9?x=1', null), '/api/clients/:id/cases/:id');
  const pilha = 'TypeError: x\n    at fn (node:internal/x)\n    at handler (C:\\app\\dist\\routes\\clients.js:10:5)';
  assert.match(localDoErro(null, pilha), /dist\/routes\/clients\.js:10:5/);
  assert.strictEqual(localDoErro(null, ''), '');
});

test('deveAvisar: na 1ª vez sim; repetindo, só a cada 6 horas', () => {
  const agora = new Date('2026-10-16T12:00:00Z');
  assert.strictEqual(deveAvisar({ vezes: 1, avisadoEm: null }, agora), true);
  assert.strictEqual(deveAvisar({ vezes: 5, avisadoEm: new Date(agora.getTime() - 3600000) }, agora), false);
  assert.strictEqual(deveAvisar({ vezes: 9, avisadoEm: new Date(agora.getTime() - HORAS_ENTRE_AVISOS * 3600000) }, agora), true);
});

test('ehRuido: rede caída e extensão do navegador não são bug do CRM', () => {
  for (const m of ['TypeError: Failed to fetch', 'NetworkError when attempting to fetch resource.', 'ResizeObserver loop limit exceeded', 'Script error.', 'Sessão expirada'])
    assert.strictEqual(ehRuido('tela', m), true, m);
  assert.strictEqual(ehRuido('tela', "Cannot read properties of undefined (reading 'id')"), false);
  assert.strictEqual(ehRuido('servidor', 'Failed to fetch'), false);
});

test('mensagemAvisoErro: diz onde, o quê, quantas vezes, sem dado pessoal', () => {
  const m = mensagemAvisoErro({ origem: 'tela', mensagem: 'Falhou para 529.982.247-25', local: 'public/app.js:10', vezes: 3, usuario: 'Jessica' });
  assert.match(m.titulo, /tela/);
  assert.match(m.texto, /3 vezes/);
  assert.match(m.texto, /Jessica/);
  assert.doesNotMatch(m.texto, /529\.982/);
});
