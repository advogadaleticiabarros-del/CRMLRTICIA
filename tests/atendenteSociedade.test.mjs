// tests/atendenteSociedade.test.mjs — tom de voz da Dra., atendente (Dra. Lívia) e sociedade dos agentes
import { test } from 'node:test';
import assert from 'node:assert';
import { ehMensagemHumana, mascararDadosPessoais, trechosDeConversa, parseGuia, guiaEmTexto } from '../dist/services/tomDeVoz.js';
import { PERGUNTAS_POR_AREA, deveResponder, montarPromptAtendente, parseRespostaAtendente, alertasDaResposta } from '../dist/services/atendente.js';
import { conversaDeAcao, parseReuniao, AGENTES_DA_SOCIEDADE } from '../dist/services/sociedadeAgentes.js';

// ── Tom de voz ──────────────────────────────────────────────────────────────

test('ehMensagemHumana: digitada pela equipe ou no celular sim; automática e de agente não', () => {
  assert.strictEqual(ehMensagemHumana(null), true);
  assert.strictEqual(ehMensagemHumana('Jessica'), true);
  for (const s of ['Automático — aceite de proposta', 'Agente Coletor de documentos', 'Envio automático', 'Assistente WhatsApp (5544…)', 'Lembrete'])
    assert.strictEqual(ehMensagemHumana(s), false, s);
});

test('mascararDadosPessoais: CPF, CNPJ, telefone, e-mail e número de processo somem', () => {
  const t = mascararDadosPessoais('CPF 123.456.789-09, CNPJ 12.345.678/0001-90, fone (27) 99999-8888, a@b.com, proc 0001234-56.2026.5.17.0003');
  assert.doesNotMatch(t, /123\.456|12\.345|99999|a@b\.com|0001234/);
  assert.match(t, /\[cpf\]/); assert.match(t, /\[telefone\]/); assert.match(t, /\[e-mail\]/);
});

test('trechosDeConversa: só conversas com resposta humana, em ordem, sem números dos comandantes', () => {
  const msgs = [
    { phone: '5527911110000', from_me: 0, body: 'Boa tarde, Dra., fui demitida', sent_by: null, msg_time: '2026-10-10T10:00:00Z' },
    { phone: '5527911110000', from_me: 1, body: 'Oi, querida! Me conta com calma o que aconteceu 😊', sent_by: null, msg_time: '2026-10-10T10:05:00Z' },
    { phone: '5527922220000', from_me: 1, body: 'Lembrete da sua parcela', sent_by: 'Automático — cobrança', msg_time: '2026-10-10T11:00:00Z' },
    { phone: '5544991011402', from_me: 0, body: 'agenda de amanhã', sent_by: null, msg_time: '2026-10-10T12:00:00Z' },
  ];
  const t = trechosDeConversa(msgs, ['5544991011402']);
  assert.strictEqual(t.length, 1);
  assert.match(t[0], /Cliente: Boa tarde[\s\S]*Escritório: Oi, querida/);
});

const GUIA = JSON.stringify({
  resumo: 'Acolhedora, próxima e objetiva.', tratamento: 'você, chama pelo primeiro nome',
  saudacoes: ['Oi, querida!'], despedidas: ['Qualquer coisa, me chama 😊'], emojis: 'poucos, 😊 e 🙏',
  tamanho: 'mensagens curtas', expressoes: ['com calma', 'fica tranquila'], como_pede_documentos: 'em lista, com carinho',
  como_explica: 'linguagem simples', evita: ['juridiquês'], exemplos: ['Oi, querida! Me conta com calma o que aconteceu 😊'],
});

test('parseGuia + guiaEmTexto: guia validado vira texto para o atendente e para o Cérebro', () => {
  const g = parseGuia(GUIA);
  assert.ok(g);
  assert.deepStrictEqual(g.saudacoes, ['Oi, querida!']);
  const txt = guiaEmTexto(g);
  assert.match(txt, /# Guia de tom de voz/);
  assert.match(txt, /Oi, querida!/);
  assert.match(txt, /juridiquês/);
  assert.strictEqual(parseGuia('{"resumo":""}'), null);
  assert.strictEqual(parseGuia('não sei'), null);
});

// ── Atendente ───────────────────────────────────────────────────────────────

test('PERGUNTAS_POR_AREA: perguntas certas por área (trabalhista pede datas, salário, como saiu)', () => {
  const t = PERGUNTAS_POR_AREA.trabalhista.join(' ');
  assert.match(t, /admiss/i); assert.match(t, /salário/i); assert.match(t, /como (foi a )?saída|como saiu/i);
  assert.ok(PERGUNTAS_POR_AREA.previdenciario.length && PERGUNTAS_POR_AREA.familia.length && PERGUNTAS_POR_AREA.geral.length);
});

test('deveResponder: não responde comandante, parceiro, figurinha nem conversa que uma pessoa assumiu', () => {
  const base = { comandante: false, parceiro: false, texto: 'Boa tarde, preciso de ajuda', ultimaHumanaHaMin: null };
  assert.strictEqual(deveResponder(base), true);
  assert.strictEqual(deveResponder({ ...base, comandante: true }), false);
  assert.strictEqual(deveResponder({ ...base, parceiro: true }), false);
  assert.strictEqual(deveResponder({ ...base, texto: '👍' }), false);
  assert.strictEqual(deveResponder({ ...base, ultimaHumanaHaMin: 30 }), false);
  assert.strictEqual(deveResponder({ ...base, ultimaHumanaHaMin: 300 }), true);
});

test('montarPromptAtendente: leva o guia, as correções da Dra., as perguntas da área e as regras', () => {
  const p = montarPromptAtendente({
    guia: '# Guia de tom de voz\nAcolhedora.', correcoes: ['Prefira "querida" a "senhora".'],
    contato: { tipo: 'cliente', nome: 'Maria Teste', area: 'trabalhista', processos: [{ numero: '0001234', ultimaMov: 'Audiência designada para 20/11' }] },
    conversa: ['Cliente: como está meu processo?'], perguntas: PERGUNTAS_POR_AREA.trabalhista,
  });
  assert.match(p, /Dra\. Lívia/);
  assert.match(p, /Acolhedora/);
  assert.match(p, /querida/);
  assert.match(p, /Audiência designada/);
  assert.match(p, /nunca/i);
  assert.match(p, /honorários|valores/i);
  assert.match(p, /JSON/);
});

test('parseRespostaAtendente: valida o JSON; intenção fora da lista vira "outro"', () => {
  const r = parseRespostaAtendente(JSON.stringify({ resposta: 'Oi, Maria! Me conta…', intencao: 'novo_caso', area: 'trabalhista', urgente: true, motivo_urgencia: 'demitida grávida', encaminhar: 'dra' }));
  assert.strictEqual(r.intencao, 'novo_caso'); assert.strictEqual(r.urgente, true); assert.strictEqual(r.encaminhar, 'dra');
  assert.strictEqual(parseRespostaAtendente(JSON.stringify({ resposta: 'Oi', intencao: 'xyz' })).intencao, 'outro');
  assert.strictEqual(parseRespostaAtendente('{"resposta":""}'), null);
});

test('alertasDaResposta: promessa de resultado e valores ficam marcados para a Dra. revisar', () => {
  assert.ok(alertasDaResposta('Fica tranquila, a senhora vai ganhar com certeza').length);
  assert.ok(alertasDaResposta('Os honorários são R$ 1.500,00').length);
  assert.deepStrictEqual(alertasDaResposta('Oi, Maria! Me conta com calma o que aconteceu?'), []);
});

// ── Sociedade dos agentes ───────────────────────────────────────────────────

test('conversaDeAcao: o trabalho real vira conversa entre colegas, com o fato da ação', () => {
  const c = conversaDeAcao({ id: 7, agente: 'leitor', texto: 'leu a sentença do proc. 0001234 e mandou à Dra.' });
  assert.strictEqual(c.de, 'leitor'); assert.strictEqual(c.para, 'prazos');
  assert.match(c.falas[0].texto, /0001234/);
  assert.strictEqual(c.falas[1].quem, 'prazos');
  const d = conversaDeAcao({ id: 8, agente: 'coletor', texto: 'reuniu todos os documentos de Maria Teste e escreveu o relato do cliente' });
  assert.strictEqual(d.para, 'estagiario');
  assert.match(d.falas[0].texto, /Maria Teste/);
  assert.strictEqual(conversaDeAcao({ id: 9, agente: 'guardiao', texto: 'cópia ok' }), null);
});

test('parseReuniao: só falas de agentes que existem e com texto; ideias e aprendizados separados', () => {
  const r = parseReuniao(JSON.stringify({
    ata: 'Dia movimentado: 2 sentenças lidas.',
    falas: [{ agente: 'leitor', texto: 'Li duas sentenças.' }, { agente: 'fantasma', texto: 'oi' }, { agente: 'prazos', texto: '' }],
    ideias: [{ agente: 'coletor', ideia: 'Pedir o FGTS já na primeira conversa.' }],
    aprendizados: [{ agente: 'atendente', texto: 'Clientes de gestante chegam ansiosas: acolher primeiro.' }],
  }));
  assert.strictEqual(r.falas.length, 1);
  assert.strictEqual(r.ideias[0].agente, 'coletor');
  assert.strictEqual(r.aprendizados.length, 1);
  assert.strictEqual(parseReuniao('{"ata":""}'), null);
  assert.ok(AGENTES_DA_SOCIEDADE.includes('atendente'));
});
