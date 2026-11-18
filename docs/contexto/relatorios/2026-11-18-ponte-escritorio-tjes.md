# Ponte do escritório para o TJES — 18/11/2026

## Pedido
Print de Configurações → Ligação com os tribunais: "Testar e salvar" no TJES — PJe 1º grau dava "O tribunal recusou a conexão (HTTP 403) — o serviço pode exigir credenciamento. Nada foi salvo." Jessica: "vamos resolver isso?". Entre as opções apresentadas, escolheu: "Fazer a consulta ao TJES a partir do computador do escritório [...] só funciona com o computador ligado".

## Feito
- **Causa:** o TJES (CloudFront da Amazon) responde "403 Request blocked" para o IP da VPS em qualquer endereço, até no WSDL, antes do login. Deste computador, 200. O eproc da JFES responde 200 da VPS. O teste de 17/11 tinha sido feito deste computador.
- Commit `abf6f56`:
  - `src/services/mni/ponteEscritorio.ts`: fila em memória com espera longa, mesmo formato do `fetch` do cliente MNI. Sem o computador conectado, falha na hora com mensagem clara.
  - `src/routes/mniPonte.ts` (`/api/mni-ponte/pedidos` e `/respostas/:id`): chave `MNI_PONTE_TOKEN`; sem a chave = 503.
  - `sistemas.ts`: `viaEscritorio: true` nos dois TJES. `index.ts`: rodada e "Testar e salvar" usam a ponte nesses sistemas; a situação mostra se o computador está conectado.
  - `scripts/ponte-escritorio/ponte.mjs` (programa do computador, só encaminha para os 2 endereços oficiais do TJES) e `instalar.ps1` (tarefa do Windows "CRM - ponte do TJES", ao fazer logon, sem janela).
  - Tela: linha "Consulta pelo computador do escritório: conectado/desligado".
  - Manual: 10-monitoramento (seção da ponte), 14-runbook (incidente), 16-ferramentas, 17-decision-log; espelho no Obsidian.
- Produção: `MNI_PONTE_TOKEN=<REMOVIDO>` no `.env` da VPS; mesma chave em `%USERPROFILE%\.crm-ponte-escritorio.json` neste computador; tarefa instalada e rodando.

## Verificado
- `tests/mniPonteEscritorio.test.mjs`: 12 testes (fila, sem conexão, prazo, erro de rede, login recusado pela ponte, lista fixa de endereços, cabeçalhos). `npm test`: 1521 ok, 0 falhas (34 pulados por falta de banco local). `npm run build` ok; `npm run lint` 0 erros.
- CI + deploy do `abf6f56`: sucesso. Na VPS: rota sem chave = 401; o computador busca a cada ~25 s com 200 (log do nginx e `%LOCALAPPDATA%\crm-ponte-escritorio\ponte.log`: "conexão com o CRM restabelecida").
- **Não verificado:** a consulta real ao TJES ida e volta pela ponte. Depende do login da Dra. em "Testar e salvar"; eu não testei com a senha dela para não gastar tentativa de login.

## Decisões e porquês
- Não driblar o bloqueio (trocar identificação do programa ou usar proxy): o firewall é do tribunal. A ponte usa a rede de onde a Dra. já acessa o PJe.
- Fila em memória, sem gravar o pedido (que leva o login): o CRM roda num processo só (PM2 fork, rotinas no mesmo processo).
- Programa copiado para `%LOCALAPPDATA%` para não depender do branch aberto na pasta do código.

## Pendente
- Dra./Jessica: em Configurações → Ligação com os tribunais, cadastrar o login do TJES 1º grau (com este computador ligado) e o do eproc.
- Só funciona com este computador ligado e a sessão do Windows aberta; as rodadas são às 7h10, 11h10, 15h10 e 19h10.
- Definitivo: pedir ao TJES a liberação do IP do servidor (texto a preparar, a Dra. envia); depois tirar `viaEscritorio`.

## Próxima sessão
Conferir em Configurações se o TJES 1º grau aparece "Ligado" e a ponte "conectado"; se der erro, ler `ponte.log` e `mni_credenciais.ultimo_erro`. Skills: `diagnosing-bugs`, `verification-before-completion`.
