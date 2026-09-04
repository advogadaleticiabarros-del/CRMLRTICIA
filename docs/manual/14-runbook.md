# 14 · Runbook — o que fazer quando algo quebra

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte e de incidentes reais) · **Última atualização:** 04/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** toda vez que um incidente novo acontecer, adicionar aqui — nunca deixar um bug real sem entrada

## TL;DR

Procedimento passo a passo pra reconhecer e resolver os problemas que já aconteceram de verdade neste sistema. Cada entrada tem sintoma, causa raiz e correção — pra qualquer pessoa ou IA resolver sem precisar investigar do zero.

## Contexto

Consulte assim que algo parecer errado (mensagem duplicada, deploy que não "pegou", processo que não sincroniza, WhatsApp fora do ar) — antes de investigar do zero, veja se já é um caso conhecido aqui.

## Regra de ouro

**Toda correção de bug real de produção vira uma entrada nova aqui**, mesmo pequena. Documentação sem isso é inútil na segunda vez que o mesmo problema acontece.

---

## Incidente: mensagem automática chegando duas vezes

**Sintoma:** o mesmo aviso (briefing de fechamento, lembrete, notificação) chega duplicado no WhatsApp/e-mail, no mesmo dia.

**Causa raiz (caso real, 03/09/2026):** dois servidores rodando o sistema ao mesmo tempo, cada um com seu próprio banco de dados e seus próprios robôs — o Railway (antigo) continuou de pé mesmo depois da migração pra VPS, sem receber atualizações de código, mas com os robôs internos ainda ativos e mandando mensagem em paralelo.

**Como confirmar:** `railway status` (CLI já autenticado) — se aparecer um serviço "Online" que você não reconhece como produção atual, é esse o caso. Confirme qual servidor é o de verdade checando pra onde o domínio aponta: `curl -sI https://crm.advogadaleticiabarros.com.br` e veja o IP/host que responde.

**Correção:** `railway down --service web` pra parar a instância antiga (reversível — não apaga nada, só derruba o processo). Depois disso, é seguro considerar excluir o projeto de vez.

**Prevenção:** nunca deixar um ambiente antigo "de lado" depois de migrar — ou desliga de vez, ou exclui. "Vou deixar aí sem mexer" é como isso aconteceu.

---

## Incidente: mudança pusheda no GitHub não aparece em produção

**Sintoma:** código commitado e enviado pro GitHub, mas o comportamento no site continua o antigo.

**Causa raiz nº1 (mais comum):** o deploy automático (GitHub Actions → SSH → build → `pm2 restart`) leva de **2 a 5 minutos** — checar logo depois do push e não ver a mudança ainda não é sinal de problema.

**Como confirmar:** `gh run list --workflow=deploy.yml --limit 3` — se o run mais recente pro seu commit está "in_progress", só esperar. Se está "success", o deploy já rodou — recarregue a página (Ctrl+Shift+R pra ignorar cache).

**Causa raiz nº2 (real, 03/09/2026):** instabilidade de rede passageira entre o GitHub e a VPS, na porta 22 (SSH) — o workflow tentava 2 vezes e as duas falhavam com `dial tcp ...:22: i/o timeout`, dentro da mesma janela de minutos.

**Como confirmar:** `gh run view <run-id> --log-failed` no run que falhou — procure por "dial tcp" no log.

**Correção:** já resolvido de forma permanente em 04/09/2026 — o workflow (`​.github/workflows/deploy.yml`) agora tenta **3 vezes** antes de desistir. Se mesmo assim falhar 3x seguidas, é queda de verdade — nesse caso, faça manualmente:
```
ssh root@179.199.128.68
cd /home/crmapp/app
git fetch origin main && git reset --hard origin/main
npm install --include=dev && npm run build && npm run migrate
pm2 restart crm-juridico && pm2 save
```

**Causa raiz nº3 (histórica, antes de 21/08/2026):** o projeto rodava no Railway, cujo trial expirou e bloqueou novos deploys silenciosamente — o site continuou no ar com a última versão de duas semanas antes, sem nenhum aviso. **Não se aplica mais** — produção é a VPS desde então (ver [Onde tudo roda](13-infraestrutura.md)), mas fica registrado porque foi o pior caso: ninguém percebeu por semanas.

**Prevenção:** depois de um push importante, sempre checar `gh run list --workflow=deploy.yml --limit 1` antes de considerar "no ar" — nunca assumir silenciosamente.

---

## Incidente: demanda dativa (ou processo) duplicado

**Sintoma:** o mesmo processo/assistido aparece duas vezes — uma vez cadastrada manualmente, outra com origem "auto_djen".

**Causa raiz (caso real, corrigido 03/09/2026):** a comparação de número de processo pra evitar duplicata era exata (`=`), mas o cadastro manual guarda o número formatado (`0000000-00.0000.8.08.0000`) enquanto o DJEN manda só os dígitos — a comparação nunca batia, e a proteção contra duplicata falhava silenciosamente.

**Como confirmar:** já corrigido na raiz (`src/services/monitoringService.ts`, comparação agora ignora pontuação) — uma duplicata nova só aconteceria por um bug diferente. Se acontecer, comparar os dois `process_number` das linhas duplicadas.

**Correção manual se acontecer de novo:** identifique qual é a automática pelo campo `origem` (`manual` × `auto_djen`), confira que não tem audiência/pagamento/documento vinculado à automática, e apague-a (`DELETE FROM dative_cases WHERE id = ?` ou pela tela).

---

## Incidente: aviso de WhatsApp de processo chegando repetido

**Sintoma:** o mesmo "Sentença publicada"/"Acórdão publicado" chega mais de uma vez pro mesmo processo.

**Causa raiz (corrigido 03/09/2026):** o aviso disparava a cada movimentação nova que batesse no gatilho, sem checar se aquele processo já tinha avisado antes — se o mesmo evento chegava por DataJud E DJEN como movimentações tecnicamente distintas, ou era republicado pelo tribunal, cada uma gerava um novo envio.

**Correção:** tabela `marco_processual_avisos` (processo + tipo de marco, chave única) — antes de mandar, o sistema tenta inserir uma marca; se já existe, não manda de novo. Ver [Processos e prazos](04-processos.md).

## Incidente: aviso de "movimentação por e-mail" sem nome do cliente

**Sintoma:** WhatsApp "📧 Movimentação encontrada por e-mail (não veio pelo DJEN)" só mostra número do processo e um trecho — mesmo quando o processo já tem cliente vinculado no CRM (confirmado em produção 04/09/2026: 3 processos reportados, os 3 já tinham cliente cadastrado).

**Causa raiz (corrigido 04/09/2026):** a correção de nome de cliente feita em 03/09/2026 (ver incidente de marco processual acima) só cobriu o fluxo do DJEN (`monitoringService.ts`) — o fluxo separado de e-mail (`courtEmailMonitorService.ts`, "Plano B" quando a movimentação não vem pelo DJEN) tem sua própria montagem de mensagem, que nunca buscava o nome do cliente, mesmo já tendo `client_id` disponível.

**Correção:** `courtEmailMonitorService.ts` agora busca `clients.name` pelo `client_id` do processo antes de montar a mensagem, mesmo padrão do DJEN — mostra "Cliente: X" quando vinculado, ou avisa explicitamente que o processo ainda não tem cliente, nunca fica mudo.

**Se acontecer de novo (fluxo de aviso novo):** use `buscarNomeCliente(clientId)`, exportado de `monitoringService.ts` (extraído em 04/09/2026 depois da 2ª vez que essa mesma lógica foi copiada) — nunca reescreva a consulta na mão de novo.

---

## Incidente: texto de movimentação bagunçado (HTML, entidades soltas)

**Sintoma:** movimentação aparece com `&aacute;`, `&ordm;` no lugar de acentos, ou até tags `<table><tr><td>` inteiras no texto.

**Causa raiz (corrigido 03/09/2026):** o DJEN e e-mails de monitoramento às vezes mandam o texto como HTML bruto, e a limpeza antiga só colapsava espaços — não decodificava entidade nem removia tag.

**Correção:** `src/services/textCleanup.ts` (`limparTextoJudicial`) aplicado na entrada. Movimentações antigas já sujas foram corrigidas uma vez por `src/scripts/backfillLimparMovimentacoes.ts` (324 linhas corrigidas em 03/09/2026) — não precisa rodar de novo a menos que apareça sujeira nova (nesse caso, é sinal de que uma fonte nova de dado não está passando pela limpeza).

---

## Incidente: campo de valor em R$ rejeita centavos ("insira um valor válido")

**Sintoma:** ao digitar um valor com centavos (ex.: `595.19`) num campo de "Valor (R$)", o navegador recusa com a mensagem "Insira um valor válido. Os dois valores válidos mais próximos são 595 e 596" — só aceita número redondo.

**Causa raiz (corrigido 04/09/2026):** o helper compartilhado de formulário (`field()`, em `public/app.js`) gerava `<input type="number">` sem o atributo `step` — o padrão do HTML pra esse atributo é `1`, ou seja, só inteiro. Afetava todo campo de dinheiro construído com esse helper (financeiro, propostas, acordos, dativo, parcerias — qualquer "Valor (R$)" do sistema).

**Correção:** `field()` agora detecta campo de dinheiro pelo próprio texto do label (contém "R$" ou a palavra "Valor") e aplica `step="0.01"` automaticamente — sem precisar listar campo por campo, e sem afetar campos de contagem (nº de parcelas, meses, %, dias), que continuam aceitando só inteiro como antes.

**Se acontecer de novo (campo novo, fora do padrão):** confira se o campo usa `field(label, name, { type: 'number' })` — se sim, o label precisa conter "R$" ou "Valor" pra ganhar `step="0.01"` sozinho; senão, passe `step: '0.01'` explicitamente na chamada.

## Incidente: dropdown de multi-seleção não fecha ao clicar fora

**Sintoma:** o painel do filtro de "Pagador" (Correspondente) abre e fica preso aberto — clicar em qualquer outro lugar da tela não fecha.

**Causa raiz (corrigido 04/09/2026):** o listener de "clique fora" do componente (`multiSelectDropdown()`, `public/app.js`) estava registrado na fase de **bubble** (`document.addEventListener('click', fn)`). Várias telas do sistema chamam `event.stopPropagation()` no próprio clique (ex.: botões de ação em linha de tabela) — isso impede o evento de sequer chegar em `document` na fase de bubble, então o listener nunca era notificado quando o clique acontecia num desses lugares.

**Correção:** listener movido pra fase de **captura** (`addEventListener('click', fn, true)`) — captura roda de fora pra dentro, ANTES de qualquer `stopPropagation()` de um elemento descendente, então sempre é notificado. Também passou a se auto-remover quando o widget sai do DOM (evita acumular listener morto a cada re-render da tela).

**Se acontecer de novo (outro componente com "fechar ao clicar fora"):** sempre registrar esse tipo de listener em fase de captura (terceiro argumento `true`) neste projeto — nunca em bubble, por causa do padrão de `stopPropagation()` já espalhado em várias telas.

## Incidente: quadro Kanban com muitas colunas fica ilegível/inacessível

**Sintoma:** num quadro com várias etapas (Produção tem 8, Fases 6, Leads 9), as colunas mais à direita ficam cortadas na borda da tela sem nenhuma forma visível de rolar até elas — ou, no caso do quadro de Leads, quebram pra uma segunda linha desalinhada com os rótulos da primeira. Relatado como "não consigo ver os dados urgentes" e "erro besta que não deveria ter em nenhuma tela".

**Causa raiz (corrigido 04/09/2026):**
- **Produção e Fases dos processos** (`#prod-board`, `#fases-board`): usam `.kanban-fases` (flex + `overflow-x: auto`, rolagem horizontal real), mas sem nenhuma seta de navegação — e rolar a roda do mouse **sobre uma coluna** move os cards daquela coluna (scroll vertical), não desliza o quadro inteiro. Sem soltar o mouse numa área vazia bem específica, não tinha como descobrir que dava pra rolar. Essa exata combinação de causa já tinha sido resolvida antes, mas só no quadro de Contatos do WhatsApp (`wc-board`) — nunca foi replicada aqui.
- **Leads** (`#board`): usava `display: grid; grid-template-columns: repeat(5, 1fr)` fixo — com as 9 etapas reais do funil, as 4 últimas ("Negociação" em diante) quebravam pra uma 2ª linha da grade, sem nenhuma relação visual com a coluna de cima. Não é um problema de rolagem, é layout genuinamente quebrado.

**Correção:** as 3 telas agora usam o mesmo padrão — quadro com rolagem horizontal (`overflow-x: auto`, barra sempre visível) **+ duas setas fixas** (`◀ ▶`) que rolam uma coluna inteira por clique, funcionando não importa onde o mouse esteja. Um helper único e reutilizável (`wireKanbanNav(boardId)`, `public/app.js`) liga esse comportamento — qualquer quadro novo no sistema deve chamar essa função em vez de reinventar.

**Se acontecer de novo (quadro novo com muitas colunas):**
1. O container do quadro precisa da classe `kanban-fases` (ou, pro visual do funil comercial, `kanban`) — ambas já vêm com `overflow-x: auto` e largura de coluna fixa.
2. Envolva o quadro em `<div class="kanban-wrap"><button class="kanban-nav kanban-nav-esq">◀</button>...board...<button class="kanban-nav kanban-nav-dir">▶</button></div>`.
3. Chame `wireKanbanNav('id-do-board')` uma vez, logo depois de montar esse HTML — nunca a cada `load()`/recarregamento dos cards.
4. **Nunca** use `display: grid` com número de colunas fixo pra um quadro cuja quantidade de etapas pode crescer (leads, fases, status configuráveis) — sempre `flex` + rolagem.

## Incidente: espaço vazio DENTRO do quadro Kanban (colunas esticando pra igualar a mais cheia)

**Sintoma:** mesmo depois de corrigir a navegação entre colunas (incidente acima), o quadro de Produção continuava "horrível, cheio de espaço em branco" — uma coluna com poucos cards (ou nenhum, só "solte um card aqui") ficava com um vão enorme embaixo, sem nenhum card ali.

**Causa raiz:** `.kanban-fases`/`.kanban` são `display: flex` sem `align-items` declarado — o padrão do flexbox é `stretch`, que estica TODAS as colunas (`.kf-col`/`.kanban-col`) pra bater com a altura da coluna mais cheia da fileira. Isso já tinha sido notado antes em comentário no código ("como as colunas esticam pra altura da mais alta") mas nunca eliminado — só contornado localmente pro efeito não parecer tão ruim.

**Correção definitiva (04/09/2026):** `align-items: flex-start` na regra base de `.kanban-fases, .kanban` — cada coluna agora só cresce até onde o próprio conteúdo dela vai, independente das vizinhas. Corrige Produção, Fases e Leads de uma vez (as 3 usam essa mesma classe base).

**Se acontecer de novo (quadro Kanban novo):** nunca crie uma classe de quadro nova do zero — reaproveite `.kanban-fases` (ou `.kanban`, se for um funil no estilo comercial), que já vêm com scroll horizontal, largura de coluna e `align-items: flex-start` prontos.

## Incidente: tabelas cortadas sem rolagem (dezenas de telas, não só uma)

**Sintoma:** mesma família do incidente do Kanban acima — tabela larga (muitas colunas ou conteúdo comprido) fica com as últimas colunas cortadas dentro do card, sem nenhuma forma de rolar até elas. Já tinha acontecido antes (ranking da Controladoria, corrigido isoladamente) e continuava acontecendo de novo em outras telas.

**Causa raiz:** a correção anterior (classe `.table-scroll`) era **opt-in** — cada tela que renderiza uma tabela larga precisava lembrar de embrulhar ela manualmente. Na prática, só uma fração pequena das ~50 tabelas do sistema tinha isso; a maioria ficava exposta ao mesmo bug, um "ajuste de cada vez" sem fim. `.card` (o container mais comum ao redor de tabela) usa `overflow: hidden` por padrão — sem rolagem própria, o conteúdo que passa da largura do card simplesmente não existe pra quem olha a tela.

**Correção definitiva (04/09/2026), não mais uma-de-cada-vez:** regra CSS única usando `:has()` — `.card:has(table), .modal-card:has(table) { overflow-x: auto; }`. Qualquer card ou modal que contenha uma tabela, em qualquer profundidade, ganha rolagem horizontal sozinho, automaticamente — cobre as ~50 tabelas que já existem hoje **e** qualquer tabela nova que for criada depois, sem precisar de wrapper nenhum e sem depender de ninguém lembrar disso de novo.

**Se acontecer de novo:** não deveria — mas se acontecer, confirme que a tabela está dentro de um `.card` ou `.modal-card` (a regra só cobre esses dois containers). Se estiver num container solto sem uma dessas classes, ou dê a ele uma dessas classes, ou adicione o container à lista de seletores desta regra em `public/styles.css`.

## Incidente: botão de ação "flutuando" sozinho numa faixa própria

**Sintoma:** um botão (ex.: "+ Novo modelo", "+ Nova provisão", "+ Novo acordo") aparece isolado, numa faixa própria acima de um card, sem estar dentro de um cabeçalho, barra de ações ou agrupamento real — mesmo padrão do "+ Nova etapa" já corrigido antes na tela do WhatsApp.

**Causa raiz:** em telas com abas (Documentos, Controladoria, Financeiro), cada função de aba desenhava seu próprio botão de ação numa `<div>` separada, porque o cabeçalho da tela (compartilhado entre todas as abas) não tinha um lugar pra recebê-lo.

**Correção definitiva (04/09/2026):** cada cabeçalho de tela-com-abas agora tem um slot de ação (`<div class="tab-action-slot">`, ex.: `#ged-action`, `#ctrl-action`, `#fin-action`) — vazio quando a aba atual não precisa de nenhum botão (`:empty{display:none}`, sem abrir espaço vazio). A função de aba só marca seu botão com a classe `tab-action` em vez de embrulhá-lo numa faixa própria; um helper único (`moveTabAction()`, `public/app.js`) o transplanta pro slot do cabeçalho automaticamente, toda vez que a aba troca.

**Se acontecer de novo (aba nova com botão de ação):** nunca desenhe o botão numa `<div>` própria dentro da função de aba — dê a ele a classe `tab-action` (sem wrapper), e garanta que o cabeçalho da tela-mãe tem um `.tab-action-slot` e chama `moveTabAction(c, slotEl)` depois de renderizar cada aba. Se for uma tela SEM abas (página única), o padrão já era outro: colocar o botão direto dentro do `.page-header` existente (ver o caso "Exportar CSV" em Prazos & Tarefas, corrigido do mesmo jeito).

## Incidente: WhatsApp desconectado / mensagem não sai

**Sintoma:** conversas param de atualizar, ou envio falha.

**Como confirmar:** tela WhatsApp → menu de auditoria → **Saúde do WhatsApp** — mostra status da conexão em tempo real e falhas recentes.

**Correção:** o robô `whatsapp:reconectar` já tenta reconectar sozinho a cada 5 minutos (ver [Monitoramento automático](10-monitoramento.md)). Se persistir além disso, é provável instabilidade do lado da Uazapi (provedor) — não há ação manual documentada além de aguardar/checar o painel da Uazapi.

## FAQ

**Como sei se um problema é "conhecido" ou preciso investigar do zero?** Procure o sintoma nesta página primeiro (Ctrl+F). Se não achar, siga a disciplina do CLAUDE.md (comportamento esperado → encontrado → causa provável → arquivos → risco → verificação) e, ao corrigir, **volte aqui e adicione a entrada**.

**Quem decide se algo vira entrada de Runbook?** Qualquer correção de bug real em produção — não é opcional, é regra do CLAUDE.md deste repositório desde 04/09/2026.

## Links relacionados
- [Onde tudo roda](13-infraestrutura.md) — infraestrutura por trás de todo incidente aqui
- [Monitoramento automático](10-monitoramento.md)
- [Processos e prazos](04-processos.md)
- [Ferramentas e acessos](16-ferramentas-acessos.md)

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 04/09/2026 | Claude | Criação do documento — 6 incidentes reais registrados a partir dos casos de 03/09/2026 |
| 04/09/2026 | Claude | +1 incidente: campo de Valor (R$) rejeitando centavos — corrigido no helper `field()` |
| 04/09/2026 | Claude | +1 incidente: dropdown de multi-seleção preso aberto — listener movido pra fase de captura |
| 04/09/2026 | Claude | +1 incidente: quadros Kanban (Produção, Fases, Leads) com colunas inacessíveis/quebradas — setas de navegação + rolagem horizontal padronizadas nas 3 telas |
| 04/09/2026 | Claude | +1 incidente: tabelas cortadas em dezenas de telas — regra CSS única (`:has()`) cobre todo `.card`/`.modal-card` com tabela, automaticamente, sem precisar de wrapper manual |
| 04/09/2026 | Claude | +1 incidente: botões de ação flutuando em telas com abas (Documentos, Controladoria, Financeiro) — slot de ação no cabeçalho + helper `moveTabAction()` únicos para as 3 telas |
| 04/09/2026 | Claude | +1 incidente: espaço vazio dentro do Kanban — colunas esticavam pra altura da mais cheia (`align-items:stretch` padrão do flex); `align-items:flex-start` corrige Produção/Fases/Leads de uma vez |
| 04/09/2026 | Claude | +1 incidente: aviso de "movimentação por e-mail" sem nome do cliente — mesmo fix do marco processual, agora extraído em `buscarNomeCliente()` compartilhado |

---
◀ [Onde tudo roda](13-infraestrutura.md) · [Visão geral](00-visao-geral.md) · Próximo: [Onboarding](15-onboarding.md) ▶
