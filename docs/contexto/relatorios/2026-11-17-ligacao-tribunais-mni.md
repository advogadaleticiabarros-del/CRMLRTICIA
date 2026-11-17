# Ligação oficial com os tribunais (MNI) — 17/11/2026

## Pedido
"Precisamos melhorar os monitoramentos dos nossos processos, tem outros sistemas bem melhores que o meu" → quer tudo (andamento sem atraso, mais tribunais, ação nova contra cliente, tela de andamentos), "hoje não consigo trabalhar com o meu CRM". Depois: **sem custo**. Escolheu a ligação oficial com o PJe ("vamos fazer isso, com todos esses": SEEU, eproc ES, TRT17 1º/2º, TRE, Justiça Eleitoral 1º grau, Turmas Recursais, TJES) e, para começar, "só no PJe ES, TRT17" e "eproc também".

## Feito
- Pesquisa: o atraso vem de depender do DataJud/DJEN; sistemas pagos leem direto do tribunal (JUDIT publica preço por transação; Escavador e Codilo só sob orçamento). Caminho gratuito: MNI (CNJ), com o login da advogada.
- Endereços MNI conferidos (WSDL): TJES PJe 1º e 2º grau, TRE-ES, TSE, eproc JFES (`eproc-ws.jfes.jus.br`). TRT17 em `/primeirograu|segundograu/servicosweb/mni222/intercomunicacao` responde **403** (exige credenciamento, como TRT1/6/15 documentam). SEEU sem endereço achado.
- Teste de login pela própria Dra. (script local só leitura, senha não salva): **TJES 1º grau ok**, **eproc ok (2 avisos)**, TJES 2º grau senha recusada, TRT17 403.
- Esqueleto das respostas (sem dados pessoais) colhido para programar sobre o formato real. PJe manda só o código TPU do movimento; o nome vem do SGT do CNJ (gratuito).
- Código:
  - `src/services/mni/cliente.ts`: cliente SOAP com só `consultarAvisosPendentes` e `consultarProcesso` (sem documentos); login recusado = `ErroLoginMni`; CPF mascarado nas mensagens.
  - `src/services/mni/sistemas.ts`: catálogo (tjes_pje1g, tjes_pje2g, eproc_jfes), regra do número CNJ, ciência automática (+10 dias).
  - `src/services/mni/nomesMovimento.ts`: código → nome pelo SGT, com cache `tpu_movimentos`.
  - `src/services/mni/monitorMni.ts`: rodada com dependências injetadas; login recusado para o sistema, desliga a credencial e avisa.
  - `src/services/mni/index.ts`: banco, criptografia, sino; `salvarCredencial` testa uma vez antes de guardar.
  - `monitoringService.ts`: `mni_*` tratado como fonte só-nome (alerta, não prazo); `registrarMovimentacoesMni` (sem reimportar histórico e sem duplicar com DataJud, nos dois sentidos).
  - Migration 180 (`mni_credenciais`, `mni_avisos`, `tpu_movimentos`), rota `/api/mni` (admin), cron `monitoramento:tribunais-mni` (7h10, 11h10, 15h10, 19h10).
  - Configurações → "⚖️ Ligação com os tribunais": login por sistema (testar e salvar), situação, "Consultar agora" e tabela de intimações pendentes com a data da ciência automática.

## Verificado
- `tests/mniTribunais.test.mjs`: 15 testes (formato real PJe/eproc, mensagens reais de login recusado, 403, trava de só leitura, ciência automática, roteamento por número, cache SGT, rodada completa com login recusado).
- `npm run build` ok; `npm run lint` 0 erros; `npm test` 1483 ok, 0 falhas (34 pulados por falta de banco local; rodam no CI).
- Não verificado ainda: rodada real em produção (depende de a Dra. cadastrar o login na tela) e se a VPS alcança os tribunais.

## Decisões
- Gratuito e só leitura (decision log 17/11). Movimentação do MNI gera alerta, não prazo (não traz o teor). Intimação pendente não vira prazo: o prazo só conta da ciência; o CRM mostra a data da ciência automática.
- Senha nunca volta para a tela nem para logs; uma tentativa por ação dela; recusa desliga o sistema.

## Pendente
- Dra.: cadastrar o login do TJES 1º grau e do eproc em Configurações → Ligação com os tribunais e clicar "Consultar agora".
- TJES 2º grau/Turmas Recursais: senha própria do 2º grau.
- TRT17: pedido de credenciamento ao tribunal (texto a preparar, ela envia).
- TRE-ES, TSE 1º grau, SEEU: ligar depois (TRE bloqueia a senha após erros).
- Fases seguintes do pedido original: Central de andamentos (prévia antes), aviso de ação nova contra cliente (busca por nome no DJEN), audiência na agenda.

## Próxima sessão
Conferir em Configurações se a primeira rodada real trouxe avisos e movimentações (ver `job_runs` da rotina `monitoramento:tribunais-mni` e `mni_credenciais.ultimo_erro`).
