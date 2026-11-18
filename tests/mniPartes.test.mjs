// Partes do processo pelo MNI → completar a ficha do cliente — 18/11/2026.
// Nomes, CPFs (válidos, mas inventados) e endereços FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerProcesso } from '../dist/services/mni/cliente.js';
import { dadosParaCompletar } from '../dist/services/mni/fichaPeloTribunal.js';

const XML = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns2:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/" xmlns="http://www.cnj.jus.br/intercomunicacao-2.2.2">
<sucesso>true</sucesso><mensagem>ok</mensagem>
<processo><dadosBasicos numero="50000011120268080024" classeProcessual="436" valorCausa="12345.67">
  <polo polo="AT"><parte assistenciaJudiciaria="true">
    <pessoa nome="MARIA EXEMPLO DA SILVA" sexo="F" numeroDocumentoPrincipal="52998224725" tipoPessoa="fisica" dataNascimento="19800215">
      <documento codigoDocumento="1234567" emissorDocumento="SSP" tipoDocumento="CI"/>
      <endereco cep="29000000"><logradouro>Rua das Flores</logradouro><numero>10</numero><complemento>apto 2</complemento><bairro>Centro</bairro><cidade>Vitória</cidade><estado>ES</estado><pais>BR</pais></endereco>
    </pessoa>
    <advogado nome="ADVOGADA EXEMPLO" inscricao="ES00000" numeroDocumentoPrincipal="11144477735" intimacao="true" tipoRepresentante="A">
      <endereco cep="29111111"><logradouro>Av. do Escritório</logradouro><numero>1</numero><cidade>Vitória</cidade><estado>ES</estado></endereco>
    </advogado>
  </parte></polo>
  <polo polo="PA"><parte><pessoa nome="BANCO EXEMPLO S.A." numeroDocumentoPrincipal="11222333000181" tipoPessoa="juridica"/></parte></polo>
  <orgaoJulgador codigoOrgao="1" nomeOrgao="1º Juizado Especial Cível de Vitória"/>
</dadosBasicos>
<movimento dataHora="20261110120000" identificadorMovimento="1"><movimentoNacional codigoNacional="85"/></movimento>
</processo></ns2:consultarProcessoResposta></soap:Body></soap:Envelope>`;

test('lerProcesso: partes com polo, CPF, nascimento e endereço (sem pegar o do advogado)', () => {
  const p = lerProcesso(XML);
  assert.equal(p.movimentos.length, 1);
  assert.equal(p.partes.length, 2);
  const [autora, reu] = p.partes;
  assert.deepEqual(autora, {
    polo: 'AT', nome: 'MARIA EXEMPLO DA SILVA', documento: '52998224725', tipoPessoa: 'fisica',
    dataNascimento: '1980-02-15', endereco: 'Rua das Flores, 10, apto 2 - Centro - Vitória/ES - CEP 29000-000',
  });
  assert.equal(reu.polo, 'PA');
  assert.equal(reu.documento, '11222333000181');
  assert.equal(reu.endereco, null);
  assert.equal(p.valorCausa, 12345.67);
});

const partes = lerProcesso(XML).partes;

test('completar ficha: só campo vazio e só quando o nome bate com uma parte', () => {
  const vazia = { name: 'Maria Exemplo da Silva', cpf_cnpj: null, birth_date: null, address: '' };
  assert.deepEqual(dadosParaCompletar(vazia, partes), {
    cpf_cnpj: '529.982.247-25', birth_date: '1980-02-15', address: 'Rua das Flores, 10, apto 2 - Centro - Vitória/ES - CEP 29000-000',
  });
  const cheia = { name: 'MARIA EXEMPLO DA SILVA', cpf_cnpj: '000', birth_date: '1980-01-01', address: 'Outro endereço' };
  assert.deepEqual(dadosParaCompletar(cheia, partes), {}, 'nunca sobrescreve');
  assert.deepEqual(dadosParaCompletar({ name: 'Maria Exemplo', cpf_cnpj: null, birth_date: null, address: null }, partes), {}, 'nome parecido não basta');
  assert.deepEqual(dadosParaCompletar({ name: 'Banco Exemplo S.A.', cpf_cnpj: null, birth_date: null, address: null }, partes),
    { cpf_cnpj: '11.222.333/0001-81' }, 'pessoa jurídica: só CNPJ');
});

test('completar ficha: CPF inválido não entra; nome em dois polos (homônimo) não completa', () => {
  const ruim = [{ ...partes[0], documento: '11111111111' }];
  assert.equal(dadosParaCompletar({ name: 'Maria Exemplo da Silva', cpf_cnpj: null, birth_date: null, address: null }, ruim).cpf_cnpj, undefined);
  const dois = [partes[0], { ...partes[0], polo: 'PA', documento: '11144477735' }];
  assert.deepEqual(dadosParaCompletar({ name: 'Maria Exemplo da Silva', cpf_cnpj: null, birth_date: null, address: null }, dois), {});
});

test('rodada do MNI entrega as partes de cada processo para completar a ficha', async () => {
  const { rodarMonitoramentoMni } = await import('../dist/services/mni/monitorMni.js');
  const chamadas = [];
  const r = await rodarMonitoramentoMni({
    credenciaisAtivas: async () => [{ sistema: 'tjes_pje1g', cpf: '52998224725', senha: 'x' }],
    cliente: () => ({ avisosPendentes: async () => [], consultarProcesso: async () => lerProcesso(XML) }),
    nomeMovimento: async () => 'Distribuído',
    processosMonitorados: async () => [{ id: 7, process_number: '5000001-11.2026.8.08.0024' }],
    garantirProcesso: async () => ({ id: 7, criado: false }),
    gravarMovimentos: async () => 0,
    registrarAvisos: async () => ({ novos: 0, resolvidos: 0, listaNovos: [] }),
    marcarOk: async () => {}, marcarErro: async () => {}, avisarEquipe: async () => {},
    completarFicha: async (id, ps) => { chamadas.push([id, ps.length]); return 3; },
  });
  assert.deepEqual(chamadas, [[7, 2]]);
  assert.equal(r.sistemas[0].camposDeFichaCompletados, 3);
});

test('resumo das partes para a tela: sem CPF, endereço nem nascimento; agrupa por polo e não repete', async () => {
  const { resumoDasPartes } = await import('../dist/services/mni/fichaPeloTribunal.js');
  const r = resumoDasPartes([...partes, partes[0]]);
  assert.equal(r.length, 2);
  for (const p of r) assert.deepEqual(Object.keys(p).sort(), ['nome', 'polo', 'tipo']);
  assert.equal(r[0].polo, 'ativo');
  assert.equal(r[1].polo, 'passivo');
});

test('rodada do MNI guarda valor da causa e partes do processo', async () => {
  const { rodarMonitoramentoMni } = await import('../dist/services/mni/monitorMni.js');
  const guardados = [];
  await rodarMonitoramentoMni({
    credenciaisAtivas: async () => [{ sistema: 'tjes_pje1g', cpf: '52998224725', senha: 'x' }],
    cliente: () => ({ avisosPendentes: async () => [], consultarProcesso: async () => lerProcesso(XML) }),
    nomeMovimento: async () => 'Distribuído',
    processosMonitorados: async () => [{ id: 7, process_number: '5000001-11.2026.8.08.0024' }],
    garantirProcesso: async () => ({ id: 7, criado: false }),
    gravarMovimentos: async () => 0,
    registrarAvisos: async () => ({ novos: 0, resolvidos: 0, listaNovos: [] }),
    marcarOk: async () => {}, marcarErro: async () => {}, avisarEquipe: async () => {},
    guardarDadosDoProcesso: async (id, d) => { guardados.push([id, d.valorCausa, d.partes.length]); },
  });
  assert.deepEqual(guardados, [[7, 12345.67, 2]]);
});
