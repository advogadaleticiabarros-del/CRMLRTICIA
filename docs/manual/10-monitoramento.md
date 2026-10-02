# 10 · Monitoramento automático

**Área:** Automação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Robôs (rotinas agendadas, "cron jobs") que rodam sozinhos, várias vezes por dia, verificando processo, e-mail e OAB sem ninguém precisar clicar em nada. É a engrenagem por trás de [Processos e prazos](04-processos.md) e [Dativo](05-dativo.md) — aqui documentamos o "quando roda" e "como", não o "o que significa" (isso já está nos módulos de negócio).

## Contexto

Consulte quando precisar saber COM QUE FREQUÊNCIA algo roda sozinho, o que fazer se um robô parecer travado, ou a lista completa de rotinas automáticas do sistema.

## Rotinas e horários (horário de Brasília)

| Rotina | Quando roda | O que faz |
|---|---|---|
| `monitoramento:descoberta-oab` | 7h, 13h, 19h | Varre o DJEN atrás de publicações endereçadas à OAB cadastrada |
| `monitoramento:processos` | de hora em hora, 7h–20h | Sincroniza cada processo já cadastrado com sua fonte (DataJud/API do tribunal) |
| `monitoramento:processos-email` | 8h, 19h | Varre a caixa de e-mail conectada atrás de movimentação de tribunal fora do DJEN |
| `monitoramento:processos-pre-briefing` | 6h | Sincronização extra antes do briefing matinal, pra ele sair com dado fresco |
| `whatsapp:reconectar` | uma vez, na subida do servidor | Rearma o auto-envio se a sessão da Uazapi já estiver conectada — só isso, não vigia a conexão depois |
| `whatsapp:verificar-conexao` | a cada 20 minutos | **Novo (22/09/2026).** Checa se a instância continua conectada; se caiu, avisa no sino (throttle de 6h) em vez de depender de alguém abrir o Painel de Saúde ou tentar mandar mensagem pra notar. Não reconecta sozinho — quando a sessão é invalidada do lado do WhatsApp (ex.: "logged out from another device"), só escanear o QR de novo resolve |
| `monitoramento:vigia` | 13h30 e 20h30 | **Novo (28/09/2026).** Confere em `job_runs` se `monitoramento:processos` (ou o de 6h) completou ao menos uma rodada ok nas últimas 6 horas. Se não, avisa os admins no sino como rotina CRÍTICA — cobre o caso de o monitoramento travar/parar sem lançar erro, que antes só se percebia abrindo a tela de saúde das rotinas. Não roda se o servidor inteiro estiver fora do ar (aí nem o vigia existe) |
| `prazos:vencidos` | a cada 15 minutos | **Novo (28/09/2026).** Avisa uma única vez quando um prazo pendente vence (até 2 dias atrás) |
| `prazos:sem-caso` | 7h20 | **Novo (28/09/2026).** Alerta escalonado dos prazos confirmados em processo sem caso vinculado que vencem em até 30 dias |
| `processos:fase-divergente` | 7h40 | **Novo (28/09/2026).** Avisa quando a fase sugerida pelas movimentações fica à frente da fase cadastrada por 3+ dias (repete a cada 14) |
| `backup:diario` | 2h, 9h, 19h | Backup criptografado do banco (local + MEGA) |

## Limpeza de texto na entrada

Publicações do DJEN e e-mails de monitoramento às vezes chegam como HTML bruto — tags inteiras e entidades não decodificadas (`&aacute;`, `&ordm;`). Desde 03/09/2026, todo texto passa por uma limpeza automática (decodifica entidades, remove tags) antes de ser salvo — sem isso, o texto aparecia bagunçado na tela, no resumo da IA e no WhatsApp.

## Detecção de nomeação e arbitramento dativo

Ver [Dativo](05-dativo.md#detecção-automática) — roda dentro da mesma varredura de descoberta por OAB, não é uma rotina separada.

## Detecção de prazo e marco processual

Ver [Processos e prazos](04-processos.md#detecção-automática-de-prazo) — roda dentro de `monitoramento:processos` e `monitoramento:descoberta-oab`, a cada movimentação nova.

## Vigia da carteira (desde 30/09/2026)

Rotina `carteira:vigia`, todo dia às 7h30. Avisa no sino, sem ninguém perguntar:

- **Processo parado:** processo monitorado e ativo sem movimentação há 30+ ou 60+ dias. Um aviso por marco; se o processo andar e parar de novo, os marcos recomeçam. Mais de 5 de uma vez (ex.: primeira varredura) viram um aviso-resumo.
- **Prescrição se aproximando:** caso ativo com *data-limite prescricional* informada na ficha do caso — avisos a 90, 60, 30, 15 e 7 dias, e quando a data passa.

Controle de "já avisei": tabela `vigia_alertas` (ref + marco únicos). Regras puras em `src/services/carteiraVigia.ts`.

## Análise da movimentação pela IA em formato fixo (desde 30/09/2026)

Cada movimentação nova é analisada pela IA (Groq, com Gemini de reserva) em **modo JSON**: resumo, ação, prazo interno, prioridade, **tipo** (sentença, acórdão, decisão, despacho, intimação, citação, audiência, recurso, trânsito em julgado, juntada, outro) e **grau** (1º, 2º, tribunal superior). Cada campo é validado em `src/services/movimentacaoIa.ts`. Antes o sistema "recortava" texto solto e, se a IA escrevesse diferente, falhava em silêncio; agora resposta fora do formato não é gravada e a movimentação fica como *não analisada* (aparece assim no briefing).

## Tribunais e instabilidade do DataJud

A consulta por número de processo cobre TJES, TRT17, TRF2, TRE-ES (Espírito Santo), TJPR, TRT9, TRF4, TRE-PR (Paraná), STJ e TST. Quando o CNJ responde com instabilidade (erro 5xx, 429, timeout ou queda de rede), o sistema tenta de novo sozinho até 3 vezes, com espera crescente (1,5s, 3s). Erros de cliente (ex.: 401, 404) não são repetidos.

## O que fazer se um robô parecer travado

Cada execução é registrada com sucesso ou falha (visível nos logs do servidor). Falhas são best-effort — uma rotina quebrando não derruba as outras nem o sistema. Se um robô específico parece ter parado (ex.: processo não sincroniza há dias), o primeiro lugar a olhar é se a integração externa (DJEN, e-mail, DataJud) está fora do ar, não necessariamente o CRM.

## FAQ

**Por que às vezes um processo demora até 1h pra sincronizar?** `monitoramento:processos` roda de hora em hora, não em tempo real — é o intervalo entre execuções.

**Os robôs rodam mesmo se ninguém estiver logado no sistema?** Sim — são rotinas de servidor, independentes de alguém estar com o CRM aberto.

**Uma falha numa rotina apaga dado?** Não — o padrão do projeto é best-effort: uma falha é logada e a próxima execução tenta de novo, nunca perde o que já estava salvo.

## Links relacionados
- [Processos e prazos](04-processos.md)
- [Dativo](05-dativo.md)
- [Briefing diário](11-briefing.md) — consome o resultado dessas rotinas
- [Onde tudo roda](13-infraestrutura.md) — onde esses robôs executam de fato

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento; registrada a limpeza de HTML/entidades na entrada |
| 20/09/2026 | Claude | Corrigida a frequência de `whatsapp:reconectar` — é uma vez no boot, não a cada 5 minutos (achado durante auditoria dos fluxos de WhatsApp) |
| 22/09/2026 | Claude | Nova rotina `whatsapp:verificar-conexao` (a cada 20min) — cobre a lacuna que a correção acima expôs |
| 28/09/2026 | Claude | Nova rotina `processos:fase-divergente` (7h40) |
| 28/09/2026 | Claude | Novas rotinas `prazos:vencidos` (15 min) e `prazos:sem-caso` (7h20) |
| 30/09/2026 | Claude | Análise de movimentação pela IA em JSON validado, com tipo e grau |
| 30/09/2026 | Claude | Nova rotina `carteira:vigia` (7h30): processo parado 30/60 dias e prescrição 90/60/30/15/7 dias |
| 30/09/2026 | Claude | TRE-ES/TRE-PR na lista de tribunais; consulta por número tenta de novo até 3x em instabilidade do CNJ |
| 28/09/2026 | Claude | Nova rotina `monitoramento:vigia` (13h30 e 20h30) — alerta crítico se o monitoramento de processos ficar 6h sem rodar (ideia 3 da auditoria de Processos e prazos) |

---
◀ [Repasses e parcerias](09-repasses.md) · [Visão geral](00-visao-geral.md) · Próximo: [Briefing diário](11-briefing.md) ▶

## Rótulos DATIVO e PARCERIA no processo (02/10/2026)

Processo cujo caso é em parceria (`cases.partner_id`) mostra o rótulo **PARCERIA <nome do parceiro>** (ex.: INFINITY LAW) nos mesmos lugares; a API devolve `partner_name`.

Processo monitorado que tem uma demanda de advocacia dativa (ligada por `dative_cases.legal_process_id` ou com o mesmo número de processo) mostra o rótulo **DATIVO** na lista de processos e na ficha do processo. A API devolve `dative_case_id` em `GET /api/processes` e `GET /api/processes/:id`.
