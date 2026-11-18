// TRT17 pelo login no site do PJe-JT (robô pela ponte do escritório) — 18/11/2026.
// O TRT17 recusa o MNI sem credenciamento; o robô entra no site com o login da
// Dra. (CPF e senha, plataforma nacional PDPJ) e lê o que ela veria na tela.
// Site FALSO abaixo; números, nomes e senhas FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarClientePjeJt, dataPjeParaIso } from '../dist/services/pjeJt/clientePjeJt.js';
import { criarNavegador } from '../dist/services/pjeJt/navegador.js';
import { ErroLoginMni, ErroRespostaMni } from '../dist/services/mni/cliente.js';
import { codigoTotp } from '../dist/services/pjeJt/totp.js';

const CHAVE_TOTP = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const AGORA = 1_234_567_890_000;

const CRED = { cpf: '00000000191', senha: 'senha-certa' };
const NUM = '0000004-44.2026.5.17.0001';
const NUM_DIG = NUM.replace(/\D/g, '');
const PJE = 'https://pje.trt17.jus.br';
const KC = 'https://sso.cloud.pje.jus.br/auth/realms/pje';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'none' })}.${b64({ id: 77, instancia: 1 })}.x`;

function formLogin(extra = '') {
  return `<html><body>${extra}<form id="kc-form-login" action="${KC}/login-actions/authenticate?session_code=sc&amp;execution=ex&amp;client_id=pje-trt17-1g&amp;tab_id=t" method="post">
    <input id="username" name="username" type="text"><input id="password" name="password" type="password">
    <input type="hidden" id="id-hidden-input" name="credentialId" value=""><input name="login" type="submit" value="Entrar"></form></body></html>`;
}

/** Site falso: login nacional (Keycloak) + PJe-JT. */
function siteFalso(opts = {}) {
  const log = [];
  const grau = opts.grau || 'primeirograu';
  const http = async (p) => {
    log.push(p);
    const u = new URL(p.url);
    const ck = p.cabecalhos.Cookie || p.cabecalhos.cookie || '';
    const json = (obj, status = 200) => ({ status, corpo: JSON.stringify(obj), cabecalhos: { 'content-type': 'application/json' } });
    if (u.host === 'pje.trt17.jus.br' && u.pathname === `/${grau}/authenticateSSO.seam` && !u.searchParams.get('code')) {
      return { status: 302, corpo: '', cabecalhos: { location: `${KC}/protocol/openid-connect/auth?client_id=pje-trt17-1g&state=s1` } };
    }
    if (u.host === 'sso.cloud.pje.jus.br' && u.pathname.endsWith('/openid-connect/auth')) {
      return { status: 200, corpo: formLogin(), cabecalhos: { 'set-cookie': ['AUTH_SESSION_ID=abc; Path=/auth/realms/pje/; Secure; HttpOnly'] } };
    }
    if (u.host === 'sso.cloud.pje.jus.br' && u.pathname.endsWith('/login-actions/authenticate') && u.searchParams.get('execution') === 'otp') {
      const f = new URLSearchParams(p.corpo);
      log.otp = f.get('otp'); log.dispositivo = f.get('selectedCredentialId');
      if (f.get('otp') !== codigoTotp(CHAVE_TOTP, AGORA)) {
        return { status: 200, corpo: '<span id="input-error">Código inválido.</span><form id="kc-otp-login-form" action="x"><input name="otp"></form>', cabecalhos: {} };
      }
      return { status: 302, corpo: '', cabecalhos: { location: `${PJE}/${grau}/authenticateSSO.seam?state=s1&code=c1` } };
    }
    if (u.host === 'sso.cloud.pje.jus.br' && u.pathname.endsWith('/login-actions/authenticate')) {
      assert.equal(p.metodo, 'POST');
      assert.match(ck, /AUTH_SESSION_ID=abc/, 'a sessão do login nacional volta no envio');
      const f = new URLSearchParams(p.corpo);
      if (opts.pedeOtp) {
        return { status: 200, corpo: `<form id="kc-otp-login-form" action="${KC}/login-actions/authenticate?session_code=sc2&amp;execution=otp" method="post">
          <input type="radio" name="selectedCredentialId" value="cel" checked><input type="radio" name="selectedCredentialId" value="outro">
          <input id="otp" name="otp" autocomplete="off" type="text"><input name="login" type="submit" value="Entrar"></form>`, cabecalhos: {} };
      }
      if (f.get('username') !== CRED.cpf || f.get('password') !== CRED.senha) {
        return { status: 200, corpo: formLogin('<span id="input-error" class="kc-feedback-text">Usuário ou senha inválidos.</span>'), cabecalhos: {} };
      }
      return { status: 302, corpo: '', cabecalhos: { location: `${PJE}/${grau}/authenticateSSO.seam?state=s1&code=c1` } };
    }
    if (u.pathname === `/${grau}/authenticateSSO.seam` && u.searchParams.get('code') === 'c1') {
      const cookies = [`JSESSIONID=j1; Path=/${grau}; HttpOnly`];
      if (!opts.semToken) cookies.push(`access_token=${JWT}; Path=/; Secure`, 'Xsrf-Token=xs1; Path=/');
      return { status: 302, corpo: '', cabecalhos: { location: `/${grau}/Painel/painel_usuario/advogado.seam`, 'set-cookie': cookies } };
    }
    if (u.pathname.startsWith(`/${grau}/Painel/`)) return { status: 200, corpo: '<html>painel</html>', cabecalhos: {} };
    if (u.pathname.startsWith('/pje-comum-api/api/')) {
      if (!/access_token=/.test(ck) || p.cabecalhos['X-XSRF-TOKEN'] !== 'xs1') return json({ erro: 'nao autenticado' }, 401);
      assert.doesNotMatch(ck, /JSESSIONID|AUTH_SESSION_ID/, 'cookie de outro caminho/site não vai para a API');
      const rota = u.pathname.replace('/pje-comum-api/api', '');
      if (rota === '/paineladvogado/77/processos') {
        const tipo = u.searchParams.get('tipoPainelAdvogado');
        if (tipo === '2') {
          return json({ totalRegistros: 1, resultado: [{ idProcesso: 501, numeroProcesso: NUM, descricaoOrgaoJulgador: '1ª Vara do Trabalho de Vitória', idProcessoParteExpediente: 9001, dataPrazoFinal: '2026-11-30T23:59:59' }] });
        }
        if (tipo === '1') {
          const pag = Number(u.searchParams.get('pagina'));
          return json(pag === 1 ? { totalRegistros: 1, resultado: [{ idProcesso: 501, numeroProcesso: NUM }] } : { totalRegistros: 1, resultado: [] });
        }
      }
      if (rota === '/processos/id/501/expedientes') {
        return json([
          { id: 9001, tipoExpediente: 'Intimação', dataCriacao: '2026-11-10T10:00:00', dataCiencia: null, fimDoPrazoLegal: '2026-11-30T23:59:59' },
          { id: 9002, tipoExpediente: 'Notificação', dataCriacao: '2026-11-11T10:00:00', nomePessoaParte: 'EMPRESA RÉ' },
        ]);
      }
      if (rota === '/processos/id/501/timeline') {
        assert.equal(u.searchParams.get('buscarMovimentos'), 'true');
        return json([
          { id: 1, titulo: 'Juntada a petição de Manifestação', data: '2026-11-17T14:32:05.000' },
          { id: 2, titulo: 'Conclusos para despacho', data: '2026-11-18T09:00:00' },
          { id: 3, titulo: '', data: '2026-11-18T09:00:00' },
        ]);
      }
      return json({ erro: 'nao existe' }, 404);
    }
    return { status: 404, corpo: '', cabecalhos: {} };
  };
  return { http, log };
}

const posts = (log) => log.filter((p) => p.metodo === 'POST').length;

test('entra pelo login nacional e lê as intimações da Dra. (Meus Expedientes)', async () => {
  const { http } = siteFalso();
  const cli = criarClientePjeJt({ grau: 'primeirograu', http });
  const avisos = await cli.avisosPendentes(CRED);
  assert.deepEqual(avisos, [{
    idAviso: '9001', tipoComunicacao: 'Intimação', numeroProcesso: NUM_DIG,
    orgaoJulgador: '1ª Vara do Trabalho de Vitória', disponibilizadoEm: '2026-11-10T10:00:00',
  }]);
});

test('lê os andamentos do processo pelo número (a lista de processos vem do painel da Dra.)', async () => {
  const { http, log } = siteFalso();
  const cli = criarClientePjeJt({ grau: 'primeirograu', http });
  const p = await cli.consultarProcesso(CRED, NUM_DIG);
  assert.equal(p.numero, NUM_DIG);
  assert.deepEqual(p.movimentos.map((m) => [m.dataHora, m.descricao]), [
    ['2026-11-17T14:32:05', 'Juntada a petição de Manifestação'],
    ['2026-11-18T09:00:00', 'Conclusos para despacho'],
  ]);
  // Login uma vez só por rodada, mesmo com várias consultas.
  await cli.avisosPendentes(CRED);
  await cli.consultarProcesso(CRED, NUM_DIG);
  assert.equal(posts(log), 1);
});

test('processo que não está no painel da Dra. → erro de resposta (a rodada segue)', async () => {
  const { http } = siteFalso();
  const cli = criarClientePjeJt({ grau: 'primeirograu', http });
  await assert.rejects(cli.consultarProcesso(CRED, '00000099920265170001'), ErroRespostaMni);
});

test('senha errada vira login recusado (o CRM para de tentar)', async () => {
  const { http, log } = siteFalso();
  const cli = criarClientePjeJt({ grau: 'primeirograu', http });
  await assert.rejects(cli.avisosPendentes({ ...CRED, senha: 'errada' }), (e) => e instanceof ErroLoginMni && /usuário ou senha/i.test(e.message));
  assert.equal(posts(log), 1, 'uma tentativa só');
});

test('pedido de código (2 fatores) sem a chave do autenticador: para e explica onde cadastrar', async () => {
  const { http } = siteFalso({ pedeOtp: true });
  const cli = criarClientePjeJt({ grau: 'primeirograu', http });
  await assert.rejects(cli.avisosPendentes(CRED), (e) => e instanceof ErroLoginMni && /chave do autenticador/i.test(e.message));
});

test('com a chave do autenticador, o robô gera o código e entra (dispositivo marcado na tela)', async () => {
  const { http, log } = siteFalso({ pedeOtp: true });
  const cli = criarClientePjeJt({ grau: 'primeirograu', http, agora: () => AGORA });
  const avisos = await cli.avisosPendentes({ ...CRED, totp: CHAVE_TOTP });
  assert.equal(avisos.length, 1);
  assert.equal(log.otp, '005924');
  assert.equal(log.dispositivo, 'cel');
});

test('código recusado vira login recusado (não fica tentando)', async () => {
  const { http, log } = siteFalso({ pedeOtp: true });
  const cli = criarClientePjeJt({ grau: 'primeirograu', http, agora: () => AGORA + 3_600_000 });
  await assert.rejects(cli.avisosPendentes({ ...CRED, totp: CHAVE_TOTP }), (e) => e instanceof ErroLoginMni && /código/i.test(e.message));
  assert.equal(posts(log), 2, 'senha + um código, nada mais');
});

test('login aceito mas sem a chave de acesso do site → erro claro (formato do site mudou)', async () => {
  const { http } = siteFalso({ semToken: true });
  const cli = criarClientePjeJt({ grau: 'primeirograu', http });
  await assert.rejects(cli.avisosPendentes(CRED), (e) => e instanceof ErroRespostaMni && /chave de acesso/i.test(e.message));
});

test('entrar() só faz o login (usado no "Salvar e testar" da tela)', async () => {
  const { http, log } = siteFalso();
  const cli = criarClientePjeJt({ grau: 'primeirograu', http });
  await cli.entrar(CRED);
  assert.equal(posts(log), 1);
  assert.equal(log.some((p) => p.url.includes('/pje-comum-api/')), false);
});

test('2º grau usa o endereço do 2º grau', async () => {
  const { http, log } = siteFalso({ grau: 'segundograu' });
  const cli = criarClientePjeJt({ grau: 'segundograu', http });
  await cli.entrar(CRED);
  assert.ok(log[0].url.startsWith(`${PJE}/segundograu/authenticateSSO.seam`));
});

test('data do PJe vira horário local do tribunal (AAAA-MM-DDThh:mm:ss)', () => {
  assert.equal(dataPjeParaIso('2026-11-17T14:32:05.123'), '2026-11-17T14:32:05');
  assert.equal(dataPjeParaIso('2026-11-17T14:32'), '2026-11-17T14:32:00');
  assert.equal(dataPjeParaIso('2026-11-17T17:32:05Z'), '2026-11-17T14:32:05');
  assert.equal(dataPjeParaIso(Date.UTC(2026, 10, 17, 17, 32, 5)), '2026-11-17T14:32:05');
  assert.equal(dataPjeParaIso('2026-11-17'), '2026-11-17T00:00:00');
  assert.equal(dataPjeParaIso(null), null);
  assert.equal(dataPjeParaIso('lixo'), null);
});

// ── Navegador (cookies e redirecionamentos) ────────────────────────────────

test('navegador segue redirecionamento, guarda cookie por site e caminho e apaga cookie vencido', async () => {
  const vistos = [];
  const nav = criarNavegador(async (p) => {
    vistos.push({ url: p.url, metodo: p.metodo, cookie: p.cabecalhos.Cookie || '' });
    if (p.url === 'https://a.jus.br/x') return { status: 302, corpo: '', cabecalhos: { location: '/y', 'set-cookie': ['s=1; Path=/', 'k=2; Path=/so-k'] } };
    if (p.url === 'https://a.jus.br/y') return { status: 303, corpo: '', cabecalhos: { location: 'https://b.jus.br/z' } };
    if (p.url === 'https://b.jus.br/z') return { status: 200, corpo: 'fim', cabecalhos: {} };
    if (p.url === 'https://a.jus.br/so-k/1') return { status: 200, corpo: '', cabecalhos: { 'set-cookie': 's=; Path=/; Max-Age=0' } };
    return { status: 200, corpo: '', cabecalhos: {} };
  });
  const r = await nav.ir('https://a.jus.br/x', { metodo: 'POST', corpo: 'a=1' });
  assert.equal(r.url, 'https://b.jus.br/z');
  assert.equal(r.corpo, 'fim');
  assert.deepEqual(vistos.map((v) => v.metodo), ['POST', 'GET', 'GET'], '302/303 depois de POST vira GET');
  assert.equal(vistos[1].cookie, 's=1');
  assert.equal(vistos[2].cookie, '', 'cookie do site A não vai para o site B');
  await nav.ir('https://a.jus.br/so-k/1');
  assert.equal(vistos[3].cookie, 's=1; k=2');
  assert.equal(nav.cookie('a.jus.br', 's'), null, 'Max-Age=0 apaga');
});

test('navegador não entra em laço de redirecionamento', async () => {
  const nav = criarNavegador(async () => ({ status: 302, corpo: '', cabecalhos: { location: 'https://a.jus.br/x' } }));
  await assert.rejects(nav.ir('https://a.jus.br/x'), /redirecionamentos/);
});
