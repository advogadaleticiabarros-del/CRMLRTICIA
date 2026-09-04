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
| `whatsapp:reconectar` | a cada 5 minutos | Verifica e restabelece a conexão do WhatsApp se cair |
| `backup:diario` | 2h, 9h, 19h | Backup criptografado do banco (local + MEGA) |

## Limpeza de texto na entrada

Publicações do DJEN e e-mails de monitoramento às vezes chegam como HTML bruto — tags inteiras e entidades não decodificadas (`&aacute;`, `&ordm;`). Desde 03/09/2026, todo texto passa por uma limpeza automática (decodifica entidades, remove tags) antes de ser salvo — sem isso, o texto aparecia bagunçado na tela, no resumo da IA e no WhatsApp.

## Detecção de nomeação e arbitramento dativo

Ver [Dativo](05-dativo.md#detecção-automática) — roda dentro da mesma varredura de descoberta por OAB, não é uma rotina separada.

## Detecção de prazo e marco processual

Ver [Processos e prazos](04-processos.md#detecção-automática-de-prazo) — roda dentro de `monitoramento:processos` e `monitoramento:descoberta-oab`, a cada movimentação nova.

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

---
◀ [Repasses e parcerias](09-repasses.md) · [Visão geral](00-visao-geral.md) · Próximo: [Briefing diário](11-briefing.md) ▶
