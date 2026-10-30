// e2e/essencial.spec.mjs — o essencial do CRM pelo navegador, como a Dra. usa.
// Falha se: o login não entra, alguma tela principal dá erro de JavaScript ou
// resposta 5xx, ou não dá para cadastrar um cliente.
import { test, expect } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL || 'ci@teste.local';
const SENHA = process.env.ADMIN_PASSWORD || 'Ci-Teste-123456';

/** Guarda erros de JavaScript e respostas 5xx da página. */
function vigiar(page) {
  const erros = [];
  page.on('pageerror', (e) => erros.push(`JavaScript: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) erros.push(`${r.status()} em ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  return erros;
}

async function entrar(page) {
  // A janela "Bem-vinda ao seu CRM" abre uma vez por aparelho, 0,9 s depois do
  // login, e ocupa o lugar de qualquer outra janela. O navegador do teste é
  // sempre novo: marca como já vista, como no computador da Dra.
  await page.addInitScript(() => { try { localStorage.setItem('crm_welcomed', '1'); } catch { /* sem storage */ } });
  await page.goto('/');
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill(SENHA);
  await page.locator('#login-form').evaluate((f) => f.requestSubmit());
  await expect(page.locator('#app-view')).toBeVisible({ timeout: 20_000 });
}

test('login: senha errada não entra; senha certa entra', async ({ page }) => {
  await page.goto('/');
  await page.locator('#login-email').fill(EMAIL);
  await page.locator('#login-password').fill('senha-errada-123');
  await page.locator('#login-form').evaluate((f) => f.requestSubmit());
  await expect(page.locator('#login-error')).not.toBeEmpty();
  await expect(page.locator('#app-view')).toBeHidden();
  await entrar(page);
});

const TELAS = ['hoje', 'dashboard', 'clients', 'leads', 'cases', 'propostas', 'agenda', 'financeiro', 'escritorio', 'leis'];

test('telas principais carregam de verdade, sem erro de JavaScript nem 5xx', async ({ page }) => {
  const erros = vigiar(page);
  await entrar(page);
  for (const tela of TELAS) {
    // Marca a tela anterior para não confundir o conteúdo velho com o novo.
    await page.evaluate(() => { const p = document.querySelector('#page'); if (p) p.innerHTML = ''; });
    await page.evaluate((t) => { location.hash = '#' + t; }, tela);
    // Tela que carregou tem título (.page-header h2); se a tela falha, o router
    // troca tudo por <div class="empty">mensagem</div> e não há título.
    await expect(page.locator('#page .page-header h2').first(), `tela ${tela} não carregou`).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#page .spinner'), `tela ${tela} ficou carregando`).toHaveCount(0, { timeout: 20_000 });
  }
  expect(erros, erros.join('\n')).toEqual([]);
});

test('página inicial: pesquisar o cliente e abrir tudo dele', async ({ page }) => {
  const erros = vigiar(page);
  await entrar(page);
  await page.evaluate(() => { location.hash = '#dashboard'; });
  const busca = page.locator('#vc-busca');
  await expect(busca).toBeVisible({ timeout: 20_000 });
  await busca.fill('Cliente Fictício');
  const resultado = page.locator('#vc-resultados [data-id]').first();
  await expect(resultado).toBeVisible({ timeout: 15_000 });
  await resultado.click();
  await expect(page.locator('#modal-title')).toContainText('Cliente Fictício CI', { timeout: 15_000 });
  for (const aba of ['processos', 'financeiro', 'acordos', 'movimentacoes', 'prazos', 'propostas', 'documentos', 'linha', 'cadastro']) {
    await page.locator(`#vc-abas [data-aba="${aba}"]`).click();
    await expect(page.locator('#vc-conteudo'), `aba ${aba}`).not.toBeEmpty();
  }
  expect(erros, erros.join('\n')).toEqual([]);
});

// Relato de 21/10/2026: "preciso passar o card para a coluna ao lado sem precisar
// descer até o último card". O quadro esticava a página (main.content sem
// min-width:0), nunca rolava para o lado e a roda do mouse não descia os cards.
test('Peças em produção: quadro na tela, roda desce a coluna e arrastar na borda anda o quadro', async ({ page }) => {
  const erros = vigiar(page);
  const etapas = ['em_analise', 'separacao_documentos', 'criacao_inicial', 'revisao_inicial', 'aguardando_protocolo', 'protocolado', 'concluido'];
  const linhas = [];
  etapas.forEach((etapa, i) => {
    for (let n = 0; n < (i === 0 ? 30 : 3); n++) linhas.push({ id: 9000 + linhas.length, production_stage: etapa, client_name: `Cliente Quadro ${linhas.length}`, title: 'Reclamação trabalhista', legal_area: 'trabalhista', sla_days: 1, pendencias: 0, production_labels: '[]' });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/cases/production-board', (r) => r.fulfill({ json: linhas }));
  // Soltar o card não pode mexer em caso de verdade no banco do CI.
  await page.route('**/api/cases/*/production-stage', (r) => r.fulfill({ json: { success: true } }));
  await entrar(page);
  await page.evaluate(() => { location.hash = '#producao'; });
  const board = page.locator('#prod-board');
  await expect(board.locator('.kf-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);

  const medidas = await page.evaluate(() => {
    const b = document.querySelector('#prod-board');
    return { base: b.getBoundingClientRect().bottom, alturaTela: innerHeight, larguraQuadro: b.clientWidth, larguraTotal: b.scrollWidth, larguraPagina: document.documentElement.clientWidth };
  });
  expect(medidas.base, 'a barra lateral do quadro aparece sem descer a página').toBeLessThanOrEqual(medidas.alturaTela);
  expect(medidas.larguraQuadro, 'o quadro cabe na tela').toBeLessThan(medidas.larguraPagina);
  expect(medidas.larguraTotal, 'e rola para o lado').toBeGreaterThan(medidas.larguraQuadro);

  const lista = board.locator('.kf-cards[data-stage="em_analise"]');
  const card = await board.locator('.kf-col[data-stage="em_analise"] .kf-card').first().boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => lista.evaluate((l) => l.scrollTop), { message: 'a roda desce os cards da coluna' }).toBeGreaterThan(0);

  await lista.evaluate((l) => { l.scrollTop = 0; }); // a roda desceu a coluna: volta o 1º card à vista
  const caixa = await board.boundingBox();
  const primeiro = await board.locator('.kf-col[data-stage="em_analise"] .kf-card').first().boundingBox();
  await page.mouse.move(primeiro.x + 40, primeiro.y + 20);
  await page.mouse.down();
  await page.mouse.move(primeiro.x + 60, primeiro.y + 30, { steps: 5 });
  for (let i = 0; i < 25; i++) { await page.mouse.move(caixa.x + caixa.width - 30 + (i % 2), primeiro.y + 20, { steps: 2 }); await page.waitForTimeout(60); }
  const rolou = await board.evaluate((b) => b.scrollLeft);
  await page.mouse.up();
  expect(rolou, 'arrastar o card até a borda leva o quadro para a coluna seguinte').toBeGreaterThan(0);
  expect(erros, erros.join('\n')).toEqual([]);
});

// Pedido de 22/10/2026: "preciso estar imersa caso a caso [...] e poder usar o CRM
// plenamente, sem precisar sair de lá de dentro, a não ser para copiar a versão
// final e conferir dentro do Jusbrasil". O card abre a Mesa do caso; editar a
// versão da equipe cria a versão da Dra. e a da equipe fica intacta para comparar.
test('Mesa do caso: abre pelo card, edita a peça, cria a versão da Dra. e compara', async ({ page }) => {
  const erros = vigiar(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await entrar(page);
  const nome = `Cliente Mesa ${Date.now()}`;
  await page.evaluate(async (nomeCliente) => {
    const cl = await api('/api/clients', { method: 'POST', body: JSON.stringify({ name: nomeCliente, email: 'mesa.e2e@teste.local' }) });
    const cs = await api('/api/cases', { method: 'POST', body: JSON.stringify({ client_id: cl.id, title: 'RMC × Banco Teste', legal_area: 'consumidor' }) });
    await api(`/api/cases/${cs.id}/production-stage`, { method: 'PATCH', body: JSON.stringify({ stage: 'em_analise' }) });
    await api('/api/documents', { method: 'POST', body: JSON.stringify({
      client_id: cl.id, case_id: cs.id, type: 'ia', folder: 'processos', name: `Petição Inicial — ${nomeCliente} (v1)`,
      content: 'EXCELENTÍSSIMO SENHOR JUIZ DA VARA CÍVEL\n\nA autora, CPF [CPF], vem propor a presente ação.',
    }) });
  }, nome);

  await page.evaluate(() => { location.hash = '#producao'; });
  const card = page.locator('#prod-board .kf-card', { hasText: nome });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  const mesa = page.locator('.mesa');
  await expect(mesa.locator('.mesa-quem h1')).toHaveText(nome, { timeout: 15_000 });
  await expect(mesa.locator('.mesa-passo.atual')).toContainText('Em análise');
  // Em análise, a mesa abre no caso (relato e análise dos documentos), não na peça.
  await expect(mesa.locator('.mesa-aba.on')).toContainText('Caso');
  await expect(mesa.locator('.mesa-secao h3').first()).toContainText('Relato do cliente');
  await mesa.locator('[data-acao="aba"][data-aba="docs"].mesa-aba').click();
  await expect(mesa.locator('.mesa-envio')).toBeVisible();
  await mesa.locator('[data-acao="aba"][data-aba="peca"]').click();
  await expect(mesa.locator('.mesa-papel mark.mesa-colchete')).toHaveCount(1, { timeout: 15_000 });
  await expect(mesa.locator('.mesa-campos-n')).toContainText('1 campo a preencher');

  const papel = mesa.locator('.mesa-papel');
  await papel.click();
  await papel.press('Control+End');
  await page.keyboard.type(' Texto acrescentado pela Dra.');
  await expect(mesa.locator('.mesa-status')).toContainText('Salvo às', { timeout: 15_000 });
  await expect(mesa.locator('.mesa-seg button')).toHaveCount(2);
  await expect(mesa.locator('.mesa-seg button.on')).toContainText('sua edição');

  await mesa.locator('[data-acao="comparar"]').click();
  await expect(mesa.locator('.mesa-cmp .mesa-entrou').first()).toContainText('Texto acrescentado', { timeout: 15_000 });

  await page.keyboard.press('Escape');
  await expect(mesa).toHaveCount(0);
  expect(erros, erros.join('\n')).toEqual([]);
});

// Regra de 22/10/2026: mesmo cliente + mesmo banco + mesma família de tese = um
// processo só (a Dra. confirma). Empréstimo pessoal nunca junta com cartão consignado.
test('Processo único: o quadro sugere juntar RMC e RCC do mesmo banco e deixa o empréstimo pessoal de fora', async ({ page }) => {
  const erros = vigiar(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await entrar(page);
  const nome = `Cliente Juncao ${Date.now()}`;
  await page.evaluate(async (nomeCliente) => {
    const cl = await api('/api/clients', { method: 'POST', body: JSON.stringify({ name: nomeCliente }) });
    for (const title of ['RCC — Banco Teste', 'RMC — Banco Teste', 'Empréstimo pessoal — Banco Teste']) {
      const cs = await api('/api/cases', { method: 'POST', body: JSON.stringify({ client_id: cl.id, title, legal_area: 'consumidor' }) });
      await api(`/api/cases/${cs.id}/production-stage`, { method: 'PATCH', body: JSON.stringify({ stage: 'em_analise' }) });
    }
  }, nome);

  await page.evaluate(() => { location.hash = '#producao'; });
  // Card único do cliente (30/10/2026): as 3 ações do mesmo cliente são UM card no quadro.
  const cardCliente = page.locator('#prod-board .kf-card-lote', { hasText: nome });
  await expect(cardCliente).toHaveCount(1, { timeout: 20_000 });
  await expect(cardCliente).toContainText('3 ações');
  await page.locator('#prod-juncao-ver').click();
  const grupo = page.locator('.juncao-grupo', { hasText: nome });
  await expect(grupo).toContainText('Cartão consignado');
  await expect(grupo.locator('.juncao-item')).toHaveCount(2);
  await expect(grupo).not.toContainText('Empréstimo pessoal');
  await grupo.locator('button', { hasText: 'Juntar em um processo' }).click();
  await expect(cardCliente).toContainText('2 ações', { timeout: 15_000 });
  await expect(page.locator('#prod-board .kf-card', { hasText: nome })).toHaveCount(1);
  expect(erros, erros.join('\n')).toEqual([]);
});

// Pedido de 30/10/2026: "tudo centralizado em um único card... documentos renomeados
// e as peças prontas para que eu revise e protocole um a um".
test('Card do cliente: ações por banco, o que trava, kit de protocolo e protocolar uma a uma', async ({ page }) => {
  const erros = vigiar(page);
  await page.setViewportSize({ width: 1366, height: 800 });
  await entrar(page);
  const nome = `Cliente Lote ${Date.now()}`;
  await page.evaluate(async (nomeCliente) => {
    const cl = await api('/api/clients', { method: 'POST', body: JSON.stringify({ name: nomeCliente }) });
    for (const title of ['Empréstimo consignado — Banco Alfa S.A.', 'RMC — Beta Financeira S.A.']) {
      const cs = await api('/api/cases', { method: 'POST', body: JSON.stringify({ client_id: cl.id, title, legal_area: 'consumidor' }) });
      await api(`/api/cases/${cs.id}/production-stage`, { method: 'PATCH', body: JSON.stringify({ stage: 'em_analise' }) });
    }
    // Procuração guardada como arquivo, com o nome com que chegou.
    await api('/api/documents', { method: 'POST', body: JSON.stringify({ client_id: cl.id, name: 'PROCURACAO_ASSINADA.pdf', type: 'anexo', folder: 'processos', file_base64: btoa('%PDF-1.4 teste'), mime: 'application/pdf' }) });
  }, nome);

  await page.evaluate(() => { location.hash = '#producao'; });
  const cardCliente = page.locator('#prod-board .kf-card-lote', { hasText: nome });
  await expect(cardCliente).toContainText('2 ações', { timeout: 20_000 });
  await cardCliente.click();
  const tela = page.locator('.lote-cli');
  await expect(tela.locator('.lote-acao')).toHaveCount(2, { timeout: 15_000 });
  await expect(tela.locator('.lote-trava')).toContainText('Extrato de empréstimos consignados do INSS');
  await expect(tela).toContainText(`Procuração - ${nome}.pdf`);

  // Kit da ação: .zip com a procuração já renomeada.
  const [download] = await Promise.all([page.waitForEvent('download'), tela.locator('.lote-acao').first().locator('[data-acao="kit"]').click()]);
  expect(download.suggestedFilename()).toMatch(/^Kit .* x Banco Alfa S\.A\.\.zip$/);

  // Dar o nome padrão: o nome com que chegou fica guardado.
  await tela.locator('[data-acao="padronizar"]').click();
  await expect(tela.locator('[data-acao="padronizar"]')).toHaveCount(0, { timeout: 15_000 });

  // A Dra. revisou e cola a peça: vira a versão final no papel timbrado e a ação fica pronta.
  await tela.locator('.lote-acao').first().locator('[data-acao="colar"]').click();
  const folha = page.locator('.lote-colar-folha');
  await expect(folha).toBeVisible();
  await folha.evaluate((f) => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<p align=center><b>EXCELENTÍSSIMO SENHOR JUIZ</b></p><p>Peça <i>revisada</i> pela Dra.</p><p>Nestes termos, pede deferimento.</p>');
    f.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(folha.locator('p')).toHaveCount(3);
  await page.locator('.lote-colar [data-acao="guardar"]').click();
  await expect(tela.locator('.lote-acao').first()).toContainText('Pronta para protocolar', { timeout: 15_000 });
  await expect(tela.locator('.lote-acao').first()).toContainText('versão final');
  const [peca] = await Promise.all([page.waitForEvent('download'), tela.locator('.lote-acao').first().locator('[data-acao="peca"]').click()]);
  expect(peca.suggestedFilename()).toMatch(/^Petição inicial - .* \(v\d+ final\)\.docx$/);

  // Protocolar a 1ª (já pronta: só pede o nº do processo).
  await tela.locator('.lote-acao').first().locator('[data-acao="protocolar"]').click();
  await page.locator('#uid-input').fill('5000001-00.2026.8.08.0001');
  await page.keyboard.press('Enter');
  await expect(tela.locator('.lote-acao').first()).toContainText('Protocolada', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  expect(erros, erros.join('\n')).toEqual([]);
});

// Caso real de 28/10/2026: a peça contra o Itaú citou contratos do PAN e da FACTA,
// lidos no extrato do INSS. A mesa lista os contratos do cliente por banco, diz o
// que entra na peça e a Dra. associa cada um ao processo certo.
test('Mesa do caso: contratos de outro banco ficam fora da peça e a Dra. associa ao processo certo', async ({ page }) => {
  const erros = vigiar(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await entrar(page);
  const nome = `Cliente Contratos ${Date.now()}`;
  const ids = await page.evaluate(async (nomeCliente) => {
    const cl = await api('/api/clients', { method: 'POST', body: JSON.stringify({ name: nomeCliente }) });
    const out = { cliente: cl.id };
    for (const [k, title] of [['itau', 'Empréstimo consignado — Banco Itaú S.A.'], ['facta', 'RMC — Facta Financeira']]) {
      const cs = await api('/api/cases', { method: 'POST', body: JSON.stringify({ client_id: cl.id, title, legal_area: 'consumidor' }) });
      await api(`/api/cases/${cs.id}/production-stage`, { method: 'PATCH', body: JSON.stringify({ stage: 'em_analise' }) });
      out[k] = cs.id;
    }
    return out;
  }, nome);
  // A leitura usa IA: no teste, os contratos entram direto no banco descartável.
  const mysql = (await import('mysql2/promise')).default;
  const con = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const contrato = (numero, tipo, banco) => ({ numero, tipo, banco, data: '16/11/2022', parcela: 89.2, situacao: 'ativo', fonte: 'hiscon.pdf' });
  for (const [chave, c] of [['n:123456', contrato('123456', 'emprestimo_consignado', 'ITAU CONSIGNADO S.A.')], ['n:7666596452', contrato('766659645-2', 'emprestimo_consignado', 'BANCO PAN S.A.')], ['n:59967160', contrato('0059967160', 'rmc', 'FACTA FINANCEIRA S.A.')]]) {
    await con.query('INSERT INTO cliente_contratos (client_id, chave, numero, tipo, banco, dados) VALUES (?, ?, ?, ?, ?, ?)', [ids.cliente, chave, c.numero, c.tipo, c.banco, JSON.stringify(c)]);
  }
  await con.end();

  await page.evaluate((id) => mesaDoCaso(id), ids.itau);
  const sec = page.locator('.mesa .mesa-contratos');
  await expect(sec).toContainText('Nesta peça: 1 de 3', { timeout: 15_000 });
  await expect(sec.locator('.mesa-contratos-banco').first()).toContainText('réu deste processo');
  const pan = sec.locator('.mesa-doc', { hasText: '766659645-2' });
  await expect(pan).toContainText('Fora desta peça');
  await expect(pan).toContainText('outro banco');

  // A FACTA vai para o processo dela; o PAN, a Dra. decide pôr nesta peça.
  await sec.locator('.mesa-doc', { hasText: '0059967160' }).locator('select').selectOption(String(ids.facta));
  await expect(sec.locator('.mesa-doc', { hasText: '0059967160' })).toContainText(`associou ao caso #${ids.facta}`, { timeout: 15_000 });
  await sec.locator('.mesa-doc', { hasText: '766659645-2' }).locator('select').selectOption(String(ids.itau));
  await expect(sec).toContainText('Nesta peça: 2 de 3', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  expect(erros, erros.join('\n')).toEqual([]);
});

test('cadastrar um cliente pela tela e ele aparecer na lista', async ({ page }) => {
  const erros = vigiar(page);
  await entrar(page);
  await page.evaluate(() => { location.hash = '#clients'; });
  await page.locator('#new-client').click();
  const nome = `Cliente Teste E2E ${Date.now()}`;
  await page.locator('#modal-body [name=name]').fill(nome);
  await page.locator('#modal-body [name=email]').fill('cliente.e2e@teste.local');
  await page.locator('#modal-body form').evaluate((f) => f.requestSubmit());
  await expect(page.locator('#toast')).toContainText('Cliente cadastrado', { timeout: 15_000 });
  await page.evaluate(() => { location.hash = '#dashboard'; });
  await page.evaluate(() => { location.hash = '#clients'; });
  await expect(page.locator('main.content')).toContainText(nome, { timeout: 15_000 });
  expect(erros, erros.join('\n')).toEqual([]);
});
