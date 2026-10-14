// tests/leitorDecisao.test.mjs — Leitor de sentença/acórdão + Secretária particular
import { test } from 'node:test';
import assert from 'node:assert';
import {
  justicaDoNumero, ehJuizado, recursosCabiveis, parseLeituraDecisao, lerDecisaoEAvisar, TEXTO_MINIMO_LEITURA, chaveLeitura,
} from '../dist/services/leitorDecisao.js';
import { montarMensagemDecisao } from '../dist/services/secretariaParticular.js';

// ── Regras fixas: justiça, juizado, recurso cabível ─────────────────────────

test('justicaDoNumero: lê o segmento J do número CNJ (com ou sem máscara)', () => {
  assert.strictEqual(justicaDoNumero('0001437-33.2026.5.17.0013'), 'trabalho');
  assert.strictEqual(justicaDoNumero('50012345620264025001'), 'federal');
  assert.strictEqual(justicaDoNumero('0012345-67.2025.8.08.0024'), 'estadual');
  assert.strictEqual(justicaDoNumero('123'), 'outra');
});

test('ehJuizado: reconhece juizado pelo órgão ou pelo texto da sentença', () => {
  assert.strictEqual(ehJuizado('1º Juizado Especial Federal de Vitória', ''), true);
  assert.strictEqual(ehJuizado(null, 'Dispensado o relatório (art. 38 da Lei 9.099/95).'), true);
  assert.strictEqual(ehJuizado('2ª Vara Cível de Vila Velha', 'Julgo procedente o pedido.'), false);
});

test('recursosCabiveis: trabalhista — sentença dá RO de 8 dias, embargos 5', () => {
  const r = recursosCabiveis({ justica: 'trabalho', juizado: false, tipo: 'sentenca' });
  assert.deepStrictEqual(r, [
    { nome: 'Embargos de declaração', dias: 5 },
    { nome: 'Recurso ordinário', dias: 8 },
  ]);
});

test('recursosCabiveis: trabalhista — acórdão do TRT dá recurso de revista de 8 dias', () => {
  const r = recursosCabiveis({ justica: 'trabalho', juizado: false, tipo: 'acordao' });
  assert.deepStrictEqual(r.map((x) => x.nome), ['Embargos de declaração', 'Recurso de revista']);
  assert.strictEqual(r[1].dias, 8);
});

test('recursosCabiveis: juizado (JEF/JEC) — sentença dá recurso inominado de 10 dias', () => {
  const r = recursosCabiveis({ justica: 'federal', juizado: true, tipo: 'sentenca' });
  assert.deepStrictEqual(r, [
    { nome: 'Embargos de declaração', dias: 5 },
    { nome: 'Recurso inominado', dias: 10 },
  ]);
});

test('recursosCabiveis: JEF — acórdão da Turma Recursal dá pedido de uniformização de 15 dias', () => {
  const r = recursosCabiveis({ justica: 'federal', juizado: true, tipo: 'acordao' });
  assert.strictEqual(r[1].nome, 'Pedido de uniformização (TNU)');
  assert.strictEqual(r[1].dias, 15);
});

test('recursosCabiveis: rito comum — sentença dá apelação de 15 dias', () => {
  const r = recursosCabiveis({ justica: 'estadual', juizado: false, tipo: 'sentenca' });
  assert.deepStrictEqual(r, [
    { nome: 'Embargos de declaração', dias: 5 },
    { nome: 'Apelação', dias: 15 },
  ]);
});

test('recursosCabiveis: rito comum — acórdão dá REsp/RE de 15 dias', () => {
  const r = recursosCabiveis({ justica: 'estadual', juizado: false, tipo: 'acordao' });
  assert.strictEqual(r[1].nome, 'Recurso especial / extraordinário');
  assert.strictEqual(r[1].dias, 15);
});

// ── Resposta da IA em formato fixo ──────────────────────────────────────────

const RESPOSTA_OK = JSON.stringify({
  tipo: 'sentenca',
  resultado: 'parcialmente_procedente',
  favoravel_ao_cliente: 'parcial',
  resumo: 'A juíza reconheceu as horas extras, mas negou o dano moral.',
  ganhamos: ['Horas extras com reflexos', 'Multa do art. 477'],
  perdemos: ['Dano moral'],
  valor_condenacao: 'R$ 12.345,67',
  valor_texto: 'Valor provisório da condenação',
  honorarios_sucumbencia: '10% sobre o valor líquido',
  justica_gratuita: 'deferida',
  pontos_de_atencao: ['Não analisou o pedido de adicional noturno (cabe embargos)'],
  sugestao: 'Embargos pela omissão do adicional noturno; depois avaliar RO do dano moral.',
});

test('parseLeituraDecisao: aceita o JSON completo e converte o valor para número', () => {
  const l = parseLeituraDecisao(RESPOSTA_OK);
  assert.ok(l);
  assert.strictEqual(l.tipo, 'sentenca');
  assert.strictEqual(l.resultado, 'parcialmente_procedente');
  assert.strictEqual(l.favoravel_ao_cliente, 'parcial');
  assert.strictEqual(l.valor_condenacao, 12345.67);
  assert.deepStrictEqual(l.ganhamos, ['Horas extras com reflexos', 'Multa do art. 477']);
  assert.deepStrictEqual(l.perdemos, ['Dano moral']);
  assert.strictEqual(l.justica_gratuita, 'deferida');
});

test('parseLeituraDecisao: tolera bloco ```json e valores fora da lista', () => {
  const l = parseLeituraDecisao('```json\n' + JSON.stringify({
    tipo: 'Acórdão', resultado: 'algo estranho', favoravel_ao_cliente: 'talvez',
    resumo: 'Turma manteve a sentença.', valor_condenacao: 3000, justica_gratuita: 'xyz',
  }) + '\n```');
  assert.ok(l);
  assert.strictEqual(l.tipo, 'acordao');
  assert.strictEqual(l.resultado, 'outro');
  assert.strictEqual(l.favoravel_ao_cliente, 'indefinido');
  assert.strictEqual(l.valor_condenacao, 3000);
  assert.strictEqual(l.justica_gratuita, null);
  assert.deepStrictEqual(l.ganhamos, []);
});

test('parseLeituraDecisao: sem resumo ou JSON inválido → null (falha visível, não inventa)', () => {
  assert.strictEqual(parseLeituraDecisao('{"tipo":"sentenca"}'), null);
  assert.strictEqual(parseLeituraDecisao('Resumo: procedente'), null);
  assert.strictEqual(parseLeituraDecisao(''), null);
});

// ── Mensagem da Secretária particular ───────────────────────────────────────

test('montarMensagemDecisao: traz cliente, resultado, ganhos/perdas, valor e prazos com data', () => {
  const leitura = parseLeituraDecisao(RESPOSTA_OK);
  const msg = montarMensagemDecisao({
    leitura,
    processo: '0001437-33.2026.5.17.0013',
    cliente: 'Maria Teste',
    orgao: '13ª Vara do Trabalho de Vitória',
    prazos: [
      { nome: 'Embargos de declaração', dias: 5, vencimento: '2026-10-21' },
      { nome: 'Recurso ordinário', dias: 8, vencimento: '2026-10-26' },
    ],
    publicadaEm: '2026-10-14',
  });
  assert.match(msg, /Sentença lida/);
  assert.match(msg, /Maria Teste/);
  assert.match(msg, /0001437-33\.2026\.5\.17\.0013/);
  assert.match(msg, /Parcialmente procedente/);
  assert.match(msg, /Horas extras com reflexos/);
  assert.match(msg, /Dano moral/);
  assert.match(msg, /R\$\s?12\.345,67/);
  assert.match(msg, /Embargos de declaração: 5 dias úteis → até 21\/10\/2026/);
  assert.match(msg, /Recurso ordinário: 8 dias úteis → até 26\/10\/2026/);
  assert.match(msg, /adicional noturno/);
  assert.match(msg, /confirme/i); // sempre lembra que o prazo é estimativa
});

test('montarMensagemDecisao: sem cliente vinculado avisa e não mostra listas vazias', () => {
  const leitura = parseLeituraDecisao(JSON.stringify({ tipo: 'acordao', resultado: 'nao_provido', resumo: 'Recurso da empresa negado.' }));
  const msg = montarMensagemDecisao({ leitura, processo: '123', cliente: null, orgao: null, prazos: [], publicadaEm: null });
  assert.match(msg, /Acórdão lido/);
  assert.match(msg, /sem cliente vinculado/i);
  assert.doesNotMatch(msg, /Ganhamos/);
  assert.doesNotMatch(msg, /Perdemos/);
});

// ── Orquestração (dependências injetadas) ───────────────────────────────────

const TEXTO_LONGO = 'SENTENÇA. Vistos etc. '.repeat(40) + 'Julgo parcialmente procedentes os pedidos.';

function depsFalsas({ respostaIa = RESPOSTA_OK, jaRegistrado = false } = {}) {
  const enviados = [];
  const registrados = [];
  return {
    enviados, registrados,
    deps: {
      ia: async () => respostaIa,
      registrar: async (chave, leitura) => { registrados.push({ chave, leitura }); return !jaRegistrado; },
      enviar: async (texto) => { enviados.push(texto); },
      hojeISO: () => '2026-10-14',
    },
  };
}

const ENTRADA = {
  processId: 7, processo: '0001437-33.2026.5.17.0013', cliente: 'Maria Teste',
  orgao: '13ª Vara do Trabalho de Vitória', tipo: 'sentenca', texto: TEXTO_LONGO, publicadaEm: '2026-10-14',
};

test('lerDecisaoEAvisar: lê, registra e manda a mensagem com prazos calculados', async () => {
  const f = depsFalsas();
  const r = await lerDecisaoEAvisar(ENTRADA, f.deps);
  assert.strictEqual(r, 'enviado');
  assert.strictEqual(f.registrados.length, 1);
  assert.strictEqual(f.enviados.length, 1);
  // 14/10/2026 (quarta) + 8 dias úteis: 15,16,19,20,21,22,23,26 → 26/10
  assert.match(f.enviados[0], /Recurso ordinário: 8 dias úteis → até 26\/10\/2026/);
});

test('lerDecisaoEAvisar: texto curto (só o nome do andamento) não chama a IA', async () => {
  let chamou = false;
  const f = depsFalsas();
  f.deps.ia = async () => { chamou = true; return RESPOSTA_OK; };
  const r = await lerDecisaoEAvisar({ ...ENTRADA, texto: 'Julgado procedente o pedido' }, f.deps);
  assert.strictEqual(r, 'sem_texto');
  assert.strictEqual(chamou, false);
  assert.ok(TEXTO_MINIMO_LEITURA > 'Julgado procedente o pedido'.length);
});

test('lerDecisaoEAvisar: IA fora do formato → não envia nada inventado', async () => {
  const f = depsFalsas({ respostaIa: 'não sei' });
  const r = await lerDecisaoEAvisar(ENTRADA, f.deps);
  assert.strictEqual(r, 'ia_falhou');
  assert.strictEqual(f.enviados.length, 0);
});

test('lerDecisaoEAvisar: mesma decisão já lida (republicação) → não manda de novo', async () => {
  const f = depsFalsas({ jaRegistrado: true });
  const r = await lerDecisaoEAvisar(ENTRADA, f.deps);
  assert.strictEqual(r, 'ja_lido');
  assert.strictEqual(f.enviados.length, 0);
});

test('chaveLeitura: é a mesma que o Leitor grava (permite pular decisão já lida sem chamar a IA)', async () => {
  const f = depsFalsas();
  await lerDecisaoEAvisar(ENTRADA, f.deps);
  assert.strictEqual(chaveLeitura(ENTRADA), f.registrados[0].chave);
});

test('lerDecisaoEAvisar: a chave de leitura é a mesma para o mesmo texto com espaços diferentes', async () => {
  const a = depsFalsas(); const b = depsFalsas();
  await lerDecisaoEAvisar(ENTRADA, a.deps);
  await lerDecisaoEAvisar({ ...ENTRADA, texto: TEXTO_LONGO.replace(/ /g, '  ') }, b.deps);
  assert.strictEqual(a.registrados[0].chave, b.registrados[0].chave);
});
