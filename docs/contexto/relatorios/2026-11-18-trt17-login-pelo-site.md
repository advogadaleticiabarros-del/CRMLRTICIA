# TRT17 com login direto pelo site do PJe-JT — 18/11/2026

## Pedido
Jessica: "não quero monitorar pelo email - quero fazer o login direto exatamente igual fizemos TJES"; "vou colocar o login e a senha lá no CRM". Depois de ouvir os riscos do robô (site muda sem aviso; código no celular ou captcha param o robô; zona cinzenta das regras de uso): "Podemos fazer esse".

## Achado
- O MNI do TRT17 (`/primeirograu|segundograu/servicosweb/mni222/intercomunicacao`) responde **403 "Request forbidden by administrative rules"** também do computador do escritório: não é bloqueio de IP como no TJES; exige credenciamento.
- O site do TRT17 (`pje.trt17.jus.br`) bloqueia o servidor do CRM (403), mas responde ao escritório. O login nacional (`sso.cloud.pje.jus.br`) responde aos dois.
- O login é um formulário simples de CPF e senha (Keycloak), **sem captcha** no formulário em 18/11/2026.
- No código público do site (`/pjekz`) estão as chamadas que a tela usa: painel do advogado "Meus Expedientes" (`tipoPainelAdvogado=2`), "Acervo geral" (`=1`), `/processos/id/{id}/expedientes` e `/processos/id/{id}/timeline`; autenticação pelos cookies `access_token` (JWT com o id) e `Xsrf-Token` (cabeçalho `X-XSRF-TOKEN`).

## Feito
- `src/services/pjeJt/navegador.ts`: cookies por site e caminho, redirecionamentos, proteção contra laço.
- `src/services/pjeJt/clientePjeJt.ts`: login nacional → sessão do PJe; intimações sem ciência de "Meus Expedientes"; andamentos dos processos do acervo da Dra. Mesma interface do cliente MNI, então a rodada (`monitoramento:tribunais-mni`), os avisos, a gravação e o desligamento por login recusado são os do TJES. Senha errada, código no celular ou ação pendente no site = login recusado (para e avisa).
- Ponte: `ponteEscritorio.requisitar` (pedido "web" com método e cookies, devolve os cabeçalhos); rota `/api/mni-ponte/respostas` aceita `location`, `set-cookie` e `content-type`; `ponte.mjs` do escritório abre só o site do TRT17 e o login nacional, só GET (POST só no envio do login), sem seguir redirecionamento. O MNI do TJES não mudou.
- Catálogo: `trt17_pje1g` e `trt17_pje2g` em Configurações → Ligação com os tribunais, com explicação própria na tela.
- Termômetro: TRT17 passa a ser "falta o login"/"ligado" (login do 1º grau).

## Verificado
- `npm run build` ok; lint sem erros; testes novos (`tests/pjeJt.test.mjs`, 11, com site falso; 4 novos em `tests/mniPonteEscritorio.test.mjs`) e suíte completa (ver commit).
- Do computador do escritório: a tela de login do TRT17 e o formulário do login nacional respondem; o MNI responde 403.

## Não verificado
- **Login real com a senha da Dra.** e o formato real das respostas do painel e da linha do tempo: os endereços vieram do código do site, não de uma sessão de verdade. A primeira tentativa acontece quando ela salvar o login na tela. Se o formato for outro, a mensagem de erro diz o que faltou; o cliente guarda só os nomes dos campos (`diagnostico()`) para ajustar sem expor dados.
- Se o PJe entrega o cookie `access_token` já no login antigo (`/primeirograu`) ou só ao abrir `/pjekz/` (o cliente tenta os dois).

## Decisões
- Robô por JSON (as chamadas que a tela faz), sem navegador automatizado no escritório.
- Só leitura; nada de ciência, assinatura ou envio. Sem contornar código ou captcha.
- Push por e-mail continua como fonte extra.

## Pendente
- **Dra.:** em Configurações → Ligação com os tribunais, "Cadastrar login" no **TRT17 — PJe-JT 1º grau (site)** (e no 2º grau, se tiver processo lá) com o CPF e a senha do PJe, com o computador do escritório ligado. Uma tentativa só: conferir a senha antes.
- **Claude, depois do 1º login:** conferir o resultado da rodada e ajustar o formato se preciso.
- Continua valendo reconectar as conexões Google e, se quiser, o pedido de credenciamento do MNI.

## Próxima sessão
Depois que a Dra. salvar o login: ver `mni_credenciais` (ultimo_ok_em/ultimo_erro de `trt17_pje1g`) e o resumo do `monitoramento:tribunais-mni`; se falhar por formato, rodar o cliente com `diagnostico()` (só nomes de campos) e ajustar `clientePjeJt.ts`.
