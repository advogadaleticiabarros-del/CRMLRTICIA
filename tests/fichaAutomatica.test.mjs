// tests/fichaAutomatica.test.mjs — o que o lead/cliente manda vira cadastro sozinho (sem atropelar o que já existe)
import { test } from 'node:test';
import assert from 'node:assert';
import {
  extrairDoTexto, normalizarCampo, parseFichaConversa, juntarSugestoes, decidir, nomeMaisCompleto, resumoFicha, promptFichaConversa, CAMPOS_FICHA,
} from '../dist/services/fichaAutomatica.js';

test('extrairDoTexto: CPF válido em qualquer formato, e-mail e CEP', () => {
  const r = extrairDoTexto('meu cpf é 52998224725, email Maria.Teste@Gmail.com cep 29100-000');
  assert.strictEqual(r.cpf, '529.982.247-25');
  assert.strictEqual(r.email, 'maria.teste@gmail.com');
  assert.strictEqual(r.cep, '29100-000');
  assert.strictEqual(extrairDoTexto('cpf 529.982.247-24').cpf, undefined, 'dígito errado não entra');
  assert.strictEqual(extrairDoTexto('processo 0001234-56.2026').cpf, undefined);
  assert.strictEqual(extrairDoTexto('protocolo 29100123').cep, undefined, '8 dígitos soltos não são CEP');
  assert.strictEqual(extrairDoTexto('meu 529.982.247-25 e do marido 111.444.777-35').cpf, undefined, 'dois CPFs: não sabe qual é o dela');
});

test('normalizarCampo: datas, estado civil, UF, CPF', () => {
  assert.strictEqual(normalizarCampo('data_nascimento', '5/3/1990'), '1990-03-05');
  assert.strictEqual(normalizarCampo('estado_civil', 'Casada'), 'casado');
  assert.strictEqual(normalizarCampo('estado_civil', 'união estável'), 'uniao_estavel');
  assert.strictEqual(normalizarCampo('estado_civil', 'Solteiro(a)'), 'solteiro');
  assert.strictEqual(normalizarCampo('state', 'es'), 'ES');
  assert.strictEqual(normalizarCampo('state', 'Espírito Santo'), 'ES');
  assert.strictEqual(normalizarCampo('state', 'Minas'), null, 'nome incompleto não vira UF');
  assert.strictEqual(normalizarCampo('cpf', '123'), null);
});

test('parseFichaConversa: só campos conhecidos e normalizados', () => {
  const r = parseFichaConversa('```json\n{"campos":{"nome":{"valor":"Maria Aparecida Teste","confianca":"alta"},"estado_civil":{"valor":"casada","confianca":"alta"},"xyz":{"valor":"1"},"city":{"valor":"Vitória","confianca":"baixa"}}}\n```');
  assert.deepStrictEqual(Object.keys(r).sort(), ['city', 'estado_civil', 'nome']);
  assert.strictEqual(r.estado_civil.valor, 'casado');
  assert.strictEqual(r.city.confianca, 'baixa');
  assert.deepStrictEqual(parseFichaConversa('nada'), {});
});

test('nomeMaisCompleto: o nome do WhatsApp vira o completo; outro nome não', () => {
  assert.ok(nomeMaisCompleto('Maria', 'Maria Aparecida de Souza'));
  assert.ok(nomeMaisCompleto('Maria Souza', 'Maria Aparecida de Souza'));
  assert.ok(!nomeMaisCompleto('Maria Souza', 'Joana Souza Lima'));
  assert.ok(!nomeMaisCompleto('Maria Aparecida de Souza', 'Maria Souza'));
});

const doc = (valor, fontes = ['rg.jpg'], confianca = 'alta', extra = {}) => ({ valor, confianca, fontes, alternativas: [], ...extra });

test('juntarSugestoes: documento manda; conversa divergente derruba a confiança', () => {
  const s = juntarSugestoes(
    { cpf: doc('529.982.247-25'), nome: doc('Maria Aparecida Teste') },
    { cpf: { valor: '111.444.777-35', confianca: 'alta' }, estado_civil: { valor: 'casado', confianca: 'alta' } },
    { email: 'maria@teste.com' },
  );
  assert.strictEqual(s.nome.confianca, 'alta');
  assert.strictEqual(s.cpf.confianca, 'baixa', 'documento e conversa discordam');
  assert.strictEqual(s.estado_civil.valor, 'casado');
  assert.strictEqual(s.email.confianca, 'alta');
});

test('decidir: grava só o vazio e confiável; o resto vira pendência', () => {
  const sugestoes = {
    nome: { valor: 'Maria Aparecida Teste', confianca: 'alta', fontes: ['rg.jpg'] },
    cpf: { valor: '529.982.247-25', confianca: 'alta', fontes: ['rg.jpg'] },
    email: { valor: 'novo@teste.com', confianca: 'alta', fontes: ['conversa'] },
    city: { valor: 'Vila Velha', confianca: 'baixa', fontes: ['conversa'] },
    profissao: { valor: 'auxiliar de cozinha', confianca: 'alta', fontes: ['conversa'] },
  };
  const atual = { nome: 'Maria', cpf: '', email: 'antigo@teste.com', city: null, profissao: null };
  const { gravar, pendencias } = decidir(atual, sugestoes, CAMPOS_FICHA);
  assert.deepStrictEqual(gravar, { nome: 'Maria Aparecida Teste', cpf: '529.982.247-25', profissao: 'auxiliar de cozinha' });
  assert.deepStrictEqual(pendencias.map((p) => p.campo).sort(), ['city', 'email']);
  assert.match(pendencias.find((p) => p.campo === 'email').motivo, /outro valor/);
});

test('decidir: nome diferente nunca troca sozinho; mesmo valor não gera nada', () => {
  const { gravar, pendencias } = decidir({ nome: 'Joana Lima', cpf: '529.982.247-25' },
    { nome: { valor: 'Maria Aparecida Teste', confianca: 'alta', fontes: ['rg.jpg'] }, cpf: { valor: '52998224725', confianca: 'alta', fontes: ['rg.jpg'] } }, CAMPOS_FICHA);
  assert.deepStrictEqual(gravar, {});
  assert.strictEqual(pendencias.length, 1);
  assert.match(pendencias[0].motivo, /nome diferente/);
});

test('decidir: respeita os campos que o cadastro tem (cliente não tem RG nem profissão)', () => {
  const { gravar } = decidir({}, { rg: { valor: '1234567', confianca: 'alta', fontes: ['rg.jpg'] }, email: { valor: 'a@b.com', confianca: 'alta', fontes: ['conversa'] } }, ['nome', 'cpf', 'email']);
  assert.deepStrictEqual(gravar, { email: 'a@b.com' });
});

test('documentoDoContato: RG do marido não vira a ficha; nome curto do WhatsApp aceita', async () => {
  const { documentoDoContato } = await import('../dist/services/fichaAutomatica.js');
  assert.strictEqual(documentoDoContato('Maria Aparecida Teste', 'MARIA APARECIDA TESTE'), true);
  assert.strictEqual(documentoDoContato('Maria Teste', 'Maria Aparecida de Souza'), true);
  assert.strictEqual(documentoDoContato('Maria Teste', 'José Carlos Lima'), false);
  assert.strictEqual(documentoDoContato('Mãe', 'José Carlos Lima'), true, 'não dá para julgar');
  assert.strictEqual(documentoDoContato('Maria Teste', null), true);
});

test('removerDadosDoEscritorio: nome da Dra. e dados que o escritório escreveu não viram ficha do cliente', async () => {
  const { removerDadosDoEscritorio } = await import('../dist/services/fichaAutomatica.js');
  const s = (valor) => ({ valor, confianca: 'alta', fontes: ['conversa'] });
  const sugestoes = { nome: s('Letícia Elias Barros'), cpf: s('529.982.247-25'), email: s('escritorio@teste.com'), cep: s('29100-000'), city: s('Vitória') };
  const r = removerDadosDoEscritorio(sugestoes, 'Pix da Dra.: 52998224725. Contato: Escritorio@Teste.com');
  assert.strictEqual(r.nome, undefined, 'nome da advogada');
  assert.strictEqual(r.cpf, undefined, 'CPF que o escritório mandou');
  assert.strictEqual(r.email, undefined, 'e-mail que o escritório mandou');
  assert.strictEqual(r.cep.valor, '29100-000', 'o que o escritório não escreveu fica');
  assert.strictEqual(r.city.valor, 'Vitória');
  const ok = removerDadosDoEscritorio({ nome: s('Maria Aparecida Teste') }, 'Olá! Aqui é do escritório da Dra. Letícia.');
  assert.strictEqual(ok.nome.valor, 'Maria Aparecida Teste');
});

test('resumoFicha e prompt', () => {
  const t = resumoFicha('Maria', ['cpf', 'email'], [{ campo: 'city', atual: null, sugerido: 'X', fontes: [], motivo: 'leitura incerta' }]);
  assert.match(t, /CPF, e-mail/);
  assert.match(t, /cidade \(leitura incerta\)/);
  assert.match(promptFichaConversa(['meu cpf é 1']), /DADOS CADASTRAIS DELA MESMA/);
});
