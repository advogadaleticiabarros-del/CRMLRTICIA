// tests/esteiraPeca.test.mjs — esteira da petição inicial: cálculos de verdade,
// consolidação por parte contrária, ficha de fatos, escolha do modelo e orquestração.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  brl, parcelaPrice, calcularIndebito, compararJuros, calcularPeca,
} from '../dist/services/pecaCalculos.js';
import {
  normalizarNomeParte, mesmaParte, casosCorrelatos,
} from '../dist/services/pecaConsolidacao.js';
import {
  valorNumero, taxaNumero, parseFichaDeFatos, montarFontes, promptFichaDeFatos, parseEscolha,
  montarPromptRedacao, conferirValores, relatorioDossie,
} from '../dist/services/pecaDossie.js';
import { produzirPeticao, levantarContratos } from '../dist/services/esteiraPeca.js';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

test('SQL da esteira, da gravação e da revisão não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([
    'src/services/esteiraPecaMysql.ts', 'src/services/peticaoBuilder.ts', 'src/services/peticaoReviewer.ts',
  ]);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

// ── cálculos ────────────────────────────────────────────────────────────────

test('brl formata em reais com milhar e centavos', () => {
  assert.strictEqual(brl(1234.5), 'R$ 1.234,50');
  assert.strictEqual(brl(0), 'R$ 0,00');
  assert.strictEqual(brl(1000000), 'R$ 1.000.000,00');
  assert.strictEqual(brl(-12.345), '-R$ 12,35');
});

test('parcelaPrice: sem juros divide; uma parcela soma os juros', () => {
  assert.strictEqual(parcelaPrice(1200, 0, 12), 100);
  assert.strictEqual(parcelaPrice(1000, 0.02, 1), 1020);
  const p = parcelaPrice(10000, 0.02, 84);
  assert.ok(Math.abs(p - 246.76) < 0.02, `parcela ${p}`);
});

test('calcularIndebito: até 03/2021 devolve simples, depois em dobro (EAREsp 600.663)', () => {
  const r = calcularIndebito([
    { competencia: '2021-02', valor: 100, contrato: 'A' },
    { competencia: '2021-03', valor: 100, contrato: 'A' },
    { competencia: '2021-04', valor: 100, contrato: 'A' },
    { competencia: '2021-05', valor: 50.25, contrato: 'B' },
  ]);
  assert.strictEqual(r.total.descontado, 350.25);
  assert.strictEqual(r.total.restituirSimples, 200);
  assert.strictEqual(r.total.restituirDobro, 300.5);
  assert.strictEqual(r.total.restituir, 500.5);
  const a = r.porContrato.find((x) => x.contrato === 'A');
  assert.strictEqual(a.meses, 3);
  assert.strictEqual(a.simples.meses, 2);
  assert.strictEqual(a.dobro.meses, 1);
  assert.strictEqual(a.periodo, '02/2021 a 04/2021');
});

test('calcularIndebito: o mesmo mês do mesmo contrato lido em dois documentos conta uma vez', () => {
  const r = calcularIndebito([
    { competencia: '2022-01', valor: 80, contrato: '123' },
    { competencia: '2022-01', valor: 80, contrato: '123' },
    { competencia: '2022-01', valor: 80, contrato: '999' },
  ]);
  assert.strictEqual(r.total.descontado, 160);
  assert.strictEqual(r.repetidosIgnorados, 1);
});

test('compararJuros: recalcula a parcela pela taxa média e mede o que foi pago a mais', () => {
  const j = compararJuros({ valorLiberado: 10000, nParcelas: 84, taxaContratadaMensal: 4, taxaMediaMensal: 2, parcelasPagas: 10 });
  assert.strictEqual(j.razao, 2);
  assert.ok(j.parcelaContratada > j.parcelaRecalculada);
  assert.strictEqual(j.diferencaPorParcela, Math.round((j.parcelaContratada - j.parcelaRecalculada) * 100) / 100);
  assert.strictEqual(j.pagoAMais, Math.round(j.diferencaPorParcela * 10 * 100) / 100);
});

test('compararJuros: usa a parcela do contrato quando ela é conhecida', () => {
  const j = compararJuros({ valorLiberado: 1000, nParcelas: 1, taxaContratadaMensal: 5, taxaMediaMensal: 2, parcelaContratada: 1060, parcelasPagas: 1 });
  assert.strictEqual(j.parcelaContratada, 1060);
  assert.strictEqual(j.parcelaRecalculada, 1020);
  assert.strictEqual(j.pagoAMais, 40);
});

test('calcularPeca: soma indébito e juros; sem dano moral informado, avisa em vez de inventar', () => {
  const c = calcularPeca({
    contratos: [
      { numero: 'A', tipo: 'rmc', valor_liberado: null, n_parcelas: null, taxa_mensal: null, taxa_media_mercado: null },
      { numero: 'E1', tipo: 'emprestimo', valor_liberado: 10000, n_parcelas: 84, parcelas_pagas: 10, taxa_mensal: 4, taxa_media_mercado: 2 },
    ],
    descontos: [{ competencia: '2022-01', valor: 100, contrato: 'A' }, { competencia: '2022-02', valor: 100, contrato: 'A' }],
    valores: [],
  });
  assert.strictEqual(c.indebito.total.restituir, 400);
  assert.strictEqual(c.juros.length, 1);
  assert.strictEqual(c.juros[0].contrato, 'E1');
  assert.strictEqual(c.valorDaCausa.danoMoral, null);
  assert.strictEqual(c.valorDaCausa.total, Math.round((400 + c.juros[0].pagoAMais) * 100) / 100);
  assert.ok(c.avisos.some((a) => /dano moral/i.test(a)));
});

test('calcularPeca: contrato com taxa mas sem a taxa média vira aviso, não número inventado', () => {
  const c = calcularPeca({ contratos: [{ numero: 'X', tipo: 'emprestimo', valor_liberado: 5000, n_parcelas: 48, taxa_mensal: 3.5, taxa_media_mercado: null }], descontos: [], valores: [] });
  assert.strictEqual(c.juros.length, 0);
  assert.ok(c.avisos.some((a) => /taxa média/i.test(a) && /X/.test(a)));
});

test('calcularPeca: contrato só com parcela e início do desconto vira meses estimados, com aviso', () => {
  const c = calcularPeca({ contratos: [{ numero: 'R1', tipo: 'rmc', parcela: 50, inicio_desconto: '2021-02', n_parcelas: 4 }], descontos: [], hoje: new Date('2026-10-21') });
  assert.strictEqual(c.indebito.total.descontado, 200);
  assert.strictEqual(c.indebito.total.restituir, 300);
  assert.ok(c.avisos.some((a) => /R1/.test(a) && /estimad/i.test(a)));
});

test('calcularPeca: sem fim nem número de parcelas, o desconto vai até o mês atual; com descontos lidos, não estima', () => {
  const c = calcularPeca({ contratos: [{ numero: 'R2', parcela: 10, inicio_desconto: '2026-08' }], descontos: [], hoje: new Date('2026-10-21') });
  assert.strictEqual(c.indebito.porContrato[0].meses, 3);
  const d = calcularPeca({ contratos: [{ numero: 'R3', parcela: 10, inicio_desconto: '2020-01' }], descontos: [{ competencia: '2020-01', valor: 10, contrato: 'R3' }], hoje: new Date('2026-10-21') });
  assert.strictEqual(d.indebito.porContrato[0].meses, 1);
});

// ── consolidação ────────────────────────────────────────────────────────────

test('normalizarNomeParte tira banco, S.A., LTDA e acentos', () => {
  assert.strictEqual(normalizarNomeParte('BANCO BMG S.A.'), 'bmg');
  assert.strictEqual(normalizarNomeParte('Banco Pan S/A'), 'pan');
  assert.strictEqual(normalizarNomeParte('Itaú Consignado S.A.'), 'itau consignado');
  assert.strictEqual(normalizarNomeParte('Banco do Brasil SA'), 'brasil');
});

test('mesmaParte: raiz do CNPJ ou nome normalizado; CNPJs diferentes são empresas diferentes', () => {
  assert.ok(mesmaParte({ nome: 'Banco BMG SA', cpf_cnpj: '61.186.680/0001-74' }, { nome: 'BMG', cpf_cnpj: '61186680000255' }));
  assert.ok(mesmaParte({ nome: 'BANCO PAN S.A.' }, { nome: 'Banco Pan' }));
  assert.ok(!mesmaParte({ nome: 'Banco Pan', cpf_cnpj: '59285411000113' }, { nome: 'Banco Pan', cpf_cnpj: '11111111000100' }));
  assert.ok(!mesmaParte({ nome: 'Banco Pan' }, { nome: 'Banco BMG' }));
  assert.ok(!mesmaParte({ nome: '' }, { nome: '' }));
});

test('casosCorrelatos: mesmo cliente, mesma área, mesma parte contrária, mesma família e ainda antes do protocolo', () => {
  const alvo = { id: 1, client_id: 7, legal_area: 'consumidor', production_stage: 'criacao_inicial', familia: 'cartao_consignado', partes: [{ nome: 'Banco Pan S.A.' }] };
  const outros = [
    { id: 2, client_id: 7, legal_area: 'consumidor', production_stage: 'em_analise', familia: 'cartao_consignado', partes: [{ nome: 'BANCO PAN' }] },
    { id: 3, client_id: 7, legal_area: 'consumidor', production_stage: 'protocolado', familia: 'cartao_consignado', partes: [{ nome: 'Banco Pan' }] },
    { id: 4, client_id: 8, legal_area: 'consumidor', production_stage: 'em_analise', familia: 'cartao_consignado', partes: [{ nome: 'Banco Pan' }] },
    { id: 5, client_id: 7, legal_area: 'trabalhista', production_stage: 'em_analise', familia: 'cartao_consignado', partes: [{ nome: 'Banco Pan' }] },
    { id: 6, client_id: 7, legal_area: 'consumidor', production_stage: 'separacao_documentos', familia: 'cartao_consignado', partes: [{ nome: 'Banco BMG' }] },
    { id: 1, client_id: 7, legal_area: 'consumidor', production_stage: 'criacao_inicial', familia: 'cartao_consignado', partes: [{ nome: 'Banco Pan' }] },
  ];
  assert.deepStrictEqual(casosCorrelatos(alvo, outros).map((c) => c.id), [2]);
});

// ── ficha de fatos e prompts ────────────────────────────────────────────────

test('valorNumero e taxaNumero entendem o formato brasileiro', () => {
  assert.strictEqual(valorNumero('R$ 1.234,56'), 1234.56);
  assert.strictEqual(valorNumero('987,1'), 987.1);
  assert.strictEqual(valorNumero(55), 55);
  assert.strictEqual(valorNumero('1234.5'), 1234.5);
  assert.strictEqual(valorNumero('não informado'), null);
  assert.strictEqual(valorNumero('1.500'), 1500);
  assert.strictEqual(taxaNumero('2,14% a.m.'), 2.14);
  assert.strictEqual(taxaNumero('2.14% a.m.'), 2.14);
  assert.strictEqual(taxaNumero(null), null);
});

test('parseFichaDeFatos aceita JSON com texto em volta e normaliza valores e competências', () => {
  const f = parseFichaDeFatos(`Segue:\n\`\`\`json
{"reus":[{"nome":"Banco Pan S.A.","cnpj":"59.285.411/0001-13","fonte":"contrato.pdf"}],
 "contratos":[{"numero":"123","tipo":"RMC","valor_liberado":"R$ 1.500,00","taxa_mensal":"3,5%","fonte":"hiscon.pdf"}],
 "descontos":[{"competencia":"05/2020","valor":"R$ 62,50","contrato":"123","fonte":"hiscon.pdf"},{"competencia":"x","valor":"10"}],
 "triagem":{"houve_saque":false,"recebeu_cartao":"não"},
 "lacunas":["data do contrato"]}
\`\`\``);
  assert.strictEqual(f.reus[0].nome, 'Banco Pan S.A.');
  assert.strictEqual(f.contratos[0].tipo, 'rmc');
  assert.strictEqual(f.contratos[0].valor_liberado, 1500);
  assert.strictEqual(f.contratos[0].taxa_mensal, 3.5);
  assert.deepStrictEqual(f.descontos, [{ competencia: '2020-05', valor: 62.5, contrato: '123', fonte: 'hiscon.pdf' }]);
  assert.strictEqual(f.triagem.houve_saque, false);
  assert.strictEqual(f.triagem.recebeu_cartao, false);
  assert.deepStrictEqual(f.lacunas, ['data do contrato']);
});

test('parseFichaDeFatos com texto quebrado devolve ficha vazia com a lacuna registrada', () => {
  const f = parseFichaDeFatos('não consegui');
  assert.deepStrictEqual(f.contratos, []);
  assert.ok(f.lacunas.some((l) => /leitura/i.test(l)));
});

test('montarFontes: nenhuma fonte some; as grandes são cortadas e marcadas', () => {
  const fontes = montarFontes([
    { nome: 'a.pdf', texto: 'x'.repeat(50000) },
    { nome: 'b.pdf', texto: 'conteúdo b' },
    { nome: 'vazio.pdf', texto: '' },
  ], { porFonte: 1000, total: 5000 });
  assert.match(fontes.texto, /=== a\.pdf ===/);
  assert.match(fontes.texto, /=== b\.pdf ===/);
  assert.match(fontes.texto, /trecho cortado/);
  assert.deepStrictEqual(fontes.lidas, ['a.pdf', 'b.pdf']);
  assert.deepStrictEqual(fontes.semTexto, ['vazio.pdf']);
});

test('promptFichaDeFatos pede JSON só com o que está nas fontes, com a fonte de cada dado', () => {
  const p = promptFichaDeFatos({ area: 'consumidor', cliente: 'Fulana Teste', casos: ['Caso 1: RMC'] }, '=== a.pdf ===\ntexto');
  assert.match(p, /"descontos"/);
  assert.match(p, /"fonte"/);
  assert.match(p, /NUNCA invente/i);
  assert.match(p, /a\.pdf/);
  assert.match(p, /Caso 1: RMC/);
});

test('parseEscolha só aceita modelos que existem no catálogo do cofre', () => {
  const catalogo = [{ titulo: 'Nulidade de RMC e RCC contra Banco PAN (peça real — TJMA)' }, { titulo: 'Conversão do cartão consignado em empréstimo consignado padrão' }];
  const e = parseEscolha('{"estrategia":"nulidade","modelos":["nulidade de rmc e rcc contra banco pan (peça real — tjma)","Modelo inventado"],"teses":["Venda casada — cartão consignado (RMC-RCC)"],"motivo":"não sacou"}', catalogo);
  assert.strictEqual(e.estrategia, 'nulidade');
  assert.deepStrictEqual(e.modelos, ['Nulidade de RMC e RCC contra Banco PAN (peça real — TJMA)']);
  assert.deepStrictEqual(e.teses, ['Venda casada — cartão consignado (RMC-RCC)']);
  assert.strictEqual(parseEscolha('lixo', catalogo).modelos.length, 0);
});

test('montarPromptRedacao leva os cálculos prontos, os casos juntos, o modelo e as teses', () => {
  const calculo = calcularPeca({ contratos: [], descontos: [{ competencia: '2022-01', valor: 100, contrato: 'A' }], valores: [] });
  const p = montarPromptRedacao({
    qualificacao: 'Nome: Fulana Teste', area: 'consumidor', advogada: 'Dra. Teste, OAB/ES nº 0',
    casos: [{ id: 1, titulo: 'RMC' }, { id: 2, titulo: 'Juros abusivos' }],
    partesContrarias: [{ nome: 'Banco Pan S.A.', cpf_cnpj: '59285411000113' }],
    ficha: parseFichaDeFatos('{}'), calculo, fontesTexto: '=== a.pdf ===\nx',
    escolha: { estrategia: 'nulidade', modelos: ['M1'], teses: ['T1'], motivo: 'porque sim' },
    modelos: [{ titulo: 'M1', conteudo: 'TEXTO DO MODELO' }], teses: [{ titulo: 'T1', texto: 'TEXTO DA TESE' }],
    fundamentos: 'FUNDAMENTOS JULIA', relato: 'relato da cliente',
  });
  assert.match(p, /R\$ 200,00/);
  assert.match(p, /use exatamente/i);
  assert.match(p, /UMA ÚNICA petição/i);
  assert.match(p, /Juros abusivos/);
  assert.match(p, /TEXTO DO MODELO/);
  assert.match(p, /TEXTO DA TESE/);
  assert.match(p, /FUNDAMENTOS JULIA/);
  assert.match(p, /Banco Pan S\.A\./);
});

test('conferirValores aponta o total calculado que não aparece na peça', () => {
  const calculo = calcularPeca({ contratos: [], descontos: [{ competencia: '2022-01', valor: 100, contrato: 'A' }], valores: [] });
  const ok = conferirValores('pede a restituição de R$ 200,00 e valor da causa de R$ 200,00', calculo);
  assert.ok(ok.every((c) => c.presente));
  const falta = conferirValores('pede a restituição de R$ 150,00', calculo);
  assert.ok(falta.some((c) => !c.presente));
});

test('relatorioDossie mostra o que foi lido, os cálculos, o modelo e os casos juntos', () => {
  const calculo = calcularPeca({ contratos: [], descontos: [{ competencia: '2022-01', valor: 100, contrato: 'A' }], valores: [] });
  const r = relatorioDossie({
    cliente: 'Fulana Teste', casos: [{ id: 1, titulo: 'RMC' }, { id: 2, titulo: 'Juros' }],
    lidas: ['a.pdf', 'Conversa do WhatsApp'], semTexto: ['foto.heic'], ficha: parseFichaDeFatos('{"lacunas":["data do contrato"]}'),
    calculo, escolha: { estrategia: 'nulidade', modelos: ['M1'], teses: [], motivo: 'não sacou' }, conferencia: [],
  });
  assert.match(r, /a\.pdf/);
  assert.match(r, /foto\.heic/);
  assert.match(r, /R\$ 200,00/);
  assert.match(r, /M1/);
  assert.match(r, /#2/);
  assert.match(r, /data do contrato/);
});

// ── orquestração (agentes simulados) ────────────────────────────────────────

function fakeDeps(over = {}) {
  const chamadas = []; const acoes = [];
  const deps = {
    caso: async (id) => ({ id, client_id: 7, legal_area: 'consumidor', production_stage: 'criacao_inicial', titulo: id === 1 ? 'RMC' : 'Juros abusivos', cliente: 'Fulana Teste', qualificacao: 'Nome: Fulana Teste', advogada: 'Dra. Teste', relato: 'relato', partes: [{ nome: 'Banco Pan S.A.' }], phone: null }),
    candidatosCorrelatos: async () => [{ id: 2, client_id: 7, legal_area: 'consumidor', production_stage: 'em_analise', partes: [{ nome: 'BANCO PAN' }] }],
    fontes: async (ids) => ids.map((i) => ({ nome: `doc-caso-${i}.pdf`, texto: `conteúdo ${i}` })),
    catalogo: async () => ({ guia: 'GUIA COMO ESCOLHER', itens: [{ titulo: 'M1', resumo: 'nulidade' }] }),
    modelos: async (t) => t.map((titulo) => ({ titulo, conteudo: 'TEXTO M1' })),
    teses: async (t) => t.map((titulo) => ({ titulo, texto: 'TEXTO TESE' })),
    fundamentos: async () => 'FUNDAMENTOS',
    regras: async () => ['Ação bancária em Vitória: Vara Regional de Direito Bancário.'],
    ia: async (prompt, nivel) => {
      chamadas.push({ prompt, nivel });
      if (nivel === 'leitura') return { ok: true, text: '{"descontos":[{"competencia":"2022-01","valor":"100","contrato":"A","fonte":"doc-caso-1.pdf"}]}' };
      if (nivel === 'escolha') return { ok: true, text: '{"estrategia":"nulidade","modelos":["M1"],"teses":["T1"],"motivo":"x"}' };
      return { ok: true, text: 'PETIÇÃO ... restituição de R$ 200,00 ... valor da causa R$ 200,00' };
    },
    registrar: (agente, texto) => acoes.push({ agente, texto }),
    ...over,
  };
  return { deps, chamadas, acoes };
}

test('produzirPeticao: o Calculista atualiza os descontos e a peça cita a planilha anexa', async () => {
  const ipca = {}, selic = {}, inpc = {};
  for (let a = 2020; a <= 2026; a++) for (let m = 1; m <= 12; m++) { const c = `${a}-${String(m).padStart(2, '0')}`; if (c > '2026-09') break; inpc[c] = 0.5; ipca[c] = 0.5; selic[c] = 1; }
  const { deps, chamadas, acoes } = fakeDeps({ indices: async () => ({ indices: { inpc, ipca, selic }, avisos: [] }), hoje: () => new Date(2026, 9, 28) });
  const r = await produzirPeticao(1, deps);
  assert.strictEqual(r.ok, true);
  const a = r.calculo.atualizacao;
  assert.strictEqual(a.dataBase, '2026-09');
  assert.strictEqual(a.linhas.length, 1);
  assert.ok(a.total.total > 200, `atualizado ${a.total.total}`);
  assert.strictEqual(r.calculo.valorDaCausa.restituicao, a.total.total);
  const redacao = chamadas[chamadas.length - 1];
  assert.match(redacao.prompt, /PLANILHA DE CÁLCULOS que acompanha a petição/);
  assert.match(redacao.prompt, /atualizados até 09\/2026/);
  assert.ok(acoes.some((x) => x.agente === 'calculista' && /planilha/.test(x.texto)));
});

test('produzirPeticao: Bacen indisponível — planilha nominal, peça sai do mesmo jeito', async () => {
  const { deps } = fakeDeps({ indices: async () => { throw new Error('fora do ar'); } });
  const r = await produzirPeticao(1, deps);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calculo.atualizacao.dataBase, null);
  assert.strictEqual(r.calculo.valorDaCausa.restituicao, 200);
  assert.ok(r.calculo.avisos.some((x) => /sem correção/i.test(x)));
});

test('produzirPeticao: lê as fontes dos casos juntos, calcula, escolhe o modelo e redige com raciocínio alto', async () => {
  const { deps, chamadas, acoes } = fakeDeps();
  const r = await produzirPeticao(1, deps);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.casos.map((c) => c.id), [1, 2]);
  const ficha = chamadas.find((c) => c.nivel === 'leitura');
  assert.match(ficha.prompt, /doc-caso-1\.pdf/);
  assert.match(ficha.prompt, /doc-caso-2\.pdf/);
  const escolha = chamadas.find((c) => c.nivel === 'escolha');
  assert.match(escolha.prompt, /GUIA COMO ESCOLHER/);
  const redacao = chamadas[chamadas.length - 1];
  assert.strictEqual(redacao.nivel, 'redacao');
  assert.match(redacao.prompt, /R\$ 200,00/);
  assert.match(redacao.prompt, /TEXTO M1/);
  assert.match(redacao.prompt, /TEXTO TESE/);
  assert.match(redacao.prompt, /REGRAS DO ESCRITÓRIO[\s\S]*Vara Regional de Direito Bancário/);
  assert.strictEqual(r.calculo.indebito.total.restituir, 200);
  assert.ok(r.conferencia.every((c) => c.presente));
  assert.match(r.dossie, /#2/);
  const quem = new Set(acoes.map((a) => a.agente));
  for (const a of ['analista', 'cerebro', 'estagiario']) assert.ok(quem.has(a), `faltou ação de ${a}`);
});

test('produzirPeticao: se a leitura falhar, segue com a lacuna e não inventa cálculo', async () => {
  const { deps } = fakeDeps({
    candidatosCorrelatos: async () => [],
    ia: async (_p, nivel) => (nivel === 'leitura' ? { ok: false, message: 'fora do ar' } : nivel === 'escolha' ? { ok: true, text: '{}' } : { ok: true, text: 'PETIÇÃO' }),
  });
  const r = await produzirPeticao(1, deps);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.calculo.indebito.total.restituir, 0);
  assert.ok(r.ficha.lacunas.some((l) => /leitura/i.test(l)));
});

test('produzirPeticao: se a redação falhar, devolve erro claro', async () => {
  const { deps } = fakeDeps({ ia: async (_p, nivel) => (nivel === 'redacao' ? { ok: false, message: 'sem cota' } : { ok: true, text: '{}' }) });
  const r = await produzirPeticao(1, deps);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /sem cota/);
});

// ── contratos do réu e da tese (caso real de 28/10/2026: PAN e FACTA na peça contra o Itaú) ──

const FICHA_VALMIRIO = JSON.stringify({
  reus: [{ nome: 'BANCO PAN S.A.', fonte: 'hiscon.pdf' }, { nome: 'Itaú Consignado S.A.', fonte: 'hiscon.pdf' }],
  contratos: [
    { numero: '766659645-2', tipo: 'emprestimo_consignado', banco: 'BANCO PAN S.A.', parcela: 89.2, fonte: 'hiscon.pdf' },
    { numero: '0059967160', tipo: 'rmc', banco: 'FACTA FINANCEIRA S.A.', parcela: 89.2, fonte: 'hiscon.pdf' },
    { numero: 'ITA-1', tipo: 'emprestimo_consignado', banco: 'Itaú Consignado S.A.', parcela: 50, fonte: 'hiscon.pdf' },
  ],
  descontos: [
    { competencia: '2023-01', valor: 89.2, contrato: '766659645-2', fonte: 'hiscre.pdf' },
    { competencia: '2023-01', valor: 50, contrato: 'ITA-1', fonte: 'hiscre.pdf' },
  ],
});

function depsItau(over = {}) {
  const guardados = [];
  const base = fakeDeps({
    caso: async (id) => ({ id, client_id: 7, legal_area: 'consumidor', production_stage: 'criacao_inicial', titulo: 'empréstimo consignado — Banco Itaú S.A.', cliente: 'Fulano Teste', qualificacao: 'Nome: Fulano Teste', advogada: 'Dra. Teste', relato: 'relato', partes: [{ nome: 'Banco Itaú S.A.' }], phone: null }),
    candidatosCorrelatos: async () => [],
    guardarContratos: async (clientId, contratos) => { guardados.push({ clientId, contratos }); },
    contratosSalvos: async () => [],
    ...over,
  });
  const ia = base.deps.ia;
  base.deps.ia = async (prompt, nivel) => (nivel === 'leitura' ? (base.chamadas.push({ prompt, nivel }), { ok: true, text: FICHA_VALMIRIO }) : ia(prompt, nivel));
  return { ...base, guardados };
}

test('produzirPeticao: só os contratos do réu e da tese vão para o cálculo e para a ficha do redator', async () => {
  const { deps, chamadas, guardados } = depsItau();
  const r = await produzirPeticao(1, deps);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.ficha.contratos.map((c) => c.numero), ['ITA-1']);
  assert.strictEqual(r.calculo.indebito.total.descontado, 50);
  const redacao = chamadas[chamadas.length - 1].prompt;
  const ficha = redacao.slice(redacao.indexOf('FICHA DE FATOS ('), redacao.indexOf('Lacunas ('));
  assert.ok(!/766659645-2|FACTA|BANCO PAN/.test(ficha), 'a ficha do redator não leva contrato nem réu de outro banco');
  assert.match(redacao, /NÃO SÃO DESTA PEÇA[\s\S]*766659645-2[\s\S]*0059967160/);
  assert.match(r.dossie, /Ficaram fora desta peça[\s\S]*766659645-2[\s\S]*outro banco/);
  // Todos os contratos lidos ficam guardados no cliente, para a Dra. associar.
  assert.strictEqual(guardados[0].clientId, 7);
  assert.strictEqual(guardados[0].contratos.length, 3);
});

test('produzirPeticao: a escolha da Dra. (contratos do cliente) manda no que entra', async () => {
  const { deps } = depsItau({
    contratosSalvos: async () => [
      { id: 1, chave: 'n:7666596452', case_id: 1, fora: false, dados: { numero: '766659645-2', tipo: 'emprestimo_consignado', banco: 'BANCO PAN S.A.' } },
      { id: 2, chave: 'n:ITA1', case_id: null, fora: true, dados: { numero: 'ITA-1', tipo: 'emprestimo_consignado', banco: 'Itaú Consignado S.A.' } },
    ],
  });
  const r = await produzirPeticao(1, deps);
  assert.deepStrictEqual(r.ficha.contratos.map((c) => c.numero), ['766659645-2']);
  assert.ok(r.ficha.lacunas.some((l) => /polo passivo/i.test(l)));
});

test('levantarContratos: lê as fontes, guarda todos os contratos do cliente e não redige nada', async () => {
  const { deps, chamadas, guardados } = depsItau();
  const r = await levantarContratos(1, deps);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.contratos, 3);
  assert.strictEqual(guardados[0].contratos.length, 3);
  assert.ok(chamadas.every((c) => c.nivel === 'leitura'), 'só leitura, sem escolha de modelo nem redação');
  assert.match(chamadas[0].prompt, /"banco"/);
});

// Barra de progresso (30/10/2026): a esteira avisa cada etapa, na ordem, para a tela mostrar.
test('a esteira avisa as etapas na ordem (barra de progresso)', async () => {
  const { deps } = fakeDeps();
  const etapas = [];
  deps.etapa = (e) => etapas.push(e);
  const r = await produzirPeticao(1, deps);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(etapas, ['leitura', 'calculos', 'estrategia', 'fundamentos', 'redacao', 'conferencia']);
});
