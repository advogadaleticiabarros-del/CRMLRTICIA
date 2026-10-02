# 04 · Processos e prazos

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

O sistema acompanha processos sozinho (DataJud/API do tribunal para cadastro manual, DJEN para descoberta automática por OAB), detecta prazo por palavra-gatilho e avisa sentença/acórdão por WhatsApp uma única vez por processo — sem duplicar aviso mesmo vindo de fontes diferentes.

## Contexto

Consulte pra entender de onde vem um processo que apareceu sozinho no sistema, por que um prazo foi criado (ou não), ou como funciona o aviso de marco processual.

## Duas formas de entrar um processo no radar

- **Cadastro manual** — você mesma cadastra um processo específico pra acompanhar. Nesse caso ele é consultado no **DataJud** (base pública do CNJ) ou na API pública do tribunal específico (TJES, TRT17, TRF2, TJPR, TRT9, TRF4, STJ, TST — o provedor certo é escolhido pelo número do processo).
- **Descoberta automática por OAB** — o sistema varre o **DJEN** (Diário de Justiça Eletrônico Nacional) periodicamente atrás de qualquer publicação endereçada ao seu número de OAB, mesmo em processos que você nunca cadastrou. Quando acha um processo novo, cadastra sozinho.

## Vínculo automático com cliente

Quando uma publicação do DJEN identifica com segurança quem é a parte representada (você é a única advogada intimada, ou só existe uma parte no processo), o sistema **cria o cliente automaticamente** e já vincula ao processo. Quando há ambiguidade (mais de uma parte possível), ele deixa em aberto pra cadastro manual — nunca chuta.

## Detecção automática de prazo

Toda movimentação nova é lida em busca de palavras-gatilho (sentença, acórdão, citação, embargos, intimação, decisão/despacho, publicação). Quando acha uma, o comportamento depende da fonte:

- **DJEN** → cria um "prazo a confirmar" na tela de Prazos, com o tipo sugerido e a data de início — fica pendente até alguém confirmar ou descartar.
- **DataJud/API do tribunal** → cria um alerta (sem presumir prazo automaticamente, essas fontes são menos confiáveis pra isso).

Uma vez confirmado ou descartado, o mesmo prazo não é recriado nas sincronizações seguintes.

**Como o tipo do prazo é escolhido (desde 28/09/2026):** antes valia a PRIMEIRA palavra-gatilho da lista que aparecesse no texto. Agora: (1) gatilhos **específicos** (sentença, acórdão, citação, embargos) vencem os **genéricos** (intimação, decisão/despacho, publicação), mesmo que o genérico apareça antes no texto; (2) entre específicos vence o que aparece primeiro no texto; (3) o **título** do ato pesa mais que a descrição; (4) acento e maiúscula não importam. Regras em `src/utils/deteccaoPrazo.ts`, com teste. Continua sendo só sugestão — a advogada confirma.

**Data do vencimento ao confirmar (corrigido 28/09/2026):** a data é calculada em dias úteis pelo mesmo cálculo da calculadora de prazos (CPC arts. 219/220/224): pula sábado, domingo, feriados nacionais e forenses (Carnaval, Quinta/Sexta-feira Santa, Corpus Christi, 11/08, 01/11, 08/12 etc.) e a suspensão de 20/12 a 20/01. Feriado **municipal** da comarca não entra — em data apertada, confira o calendário do tribunal. Antes dessa correção, a confirmação só pulava fim de semana.

## Cliente certo na descoberta por OAB (corrigido 02/10/2026)

Quando a advogada é a única intimada, todas as partes da intimação viravam candidatas a cliente e a primeira da lista ganhava — muitas vezes a empresa ré ou o INSS (16 casos encontrados). Agora `escolherCliente` (`src/services/djen.ts`, testado): uma parte só → ela; senão ignora ente público (INSS, União, Estado, Município, Fazenda) e, havendo pessoa física, ignora empresas; sobrando várias, fica a do polo ativo; ambíguo → sem cliente (cadastro manual).

**Conferir cliente dos processos** (topo de *Monitoramento Processual*): lista os processos cujo cliente parece empresa/ente público, com as partes das intimações e um botão "Cliente é Fulano" (sugestão em dourado), "Outro…" ou "Está certo". Trocar cria o cliente se não existir e corrige também o caso e os prazos detectados que estavam com o cliente errado. Coluna `legal_processes.cliente_conferido`.

## Processos duplicados (corrigido 02/10/2026)

O mesmo número entrava com e sem máscara e virava dois cadastros (13 grupos). Agora toda busca/criação de processo compara só os dígitos (descoberta por OAB, protocolo na esteira, e-mail do tribunal, cadastro manual — este devolve 409 se já existe). Os existentes aparecem em **Processos cadastrados em duplicidade** (topo de *Monitoramento Processual*): **Unir** junta movimentações, prazos detectados, logs, avisos, e-mails, dativos e acordos detectados no cadastro mais antigo, remove movimentações repetidas e apaga as cópias, numa transação. Se as cópias têm clientes ou casos diferentes, é preciso escolher qual fica — o sistema não decide. Testado numa cópia do banco de produção antes de liberar.

## Tarefa "Analisar …" fecha sozinha (corrigido 02/10/2026)

Cada intimação detectada cria a tarefa "Analisar <tipo> — proc. <nº>". Antes ela nunca fechava — em 02/10/2026 eram 109 das 114 tarefas vencidas. Agora a tarefa fica ligada ao prazo detectado (`tasks.detected_deadline_id`) e é concluída automaticamente quando o prazo é confirmado ou descartado (individual ou no mutirão). As antigas foram ligadas pelo nº do processo e as já resolvidas fechadas (script `sanearTarefasAnalisar`).

## Mutirão de prazos detectados (desde 02/10/2026)

Quando há mais de 3 prazos a confirmar, o cartão "⚠ Prazos detectados" mostra **Resolver em lote (mutirão)**. A janela traz todos com o vencimento já calculado (CPC, feriados e suspensão de fim de ano) em três grupos: **vencem em até 5 dias**, **demais** e **vencimento já passou** (provavelmente tratados fora do CRM). Duplicados (mesmo processo em dois formatos + mesmo tipo) aparecem marcados e desmarcados.

- **Confirmar marcados** faz exatamente o mesmo que a confirmação individual (prazo no caso, alertas 30/15/7/3/1, agenda/Google, playbooks).
- **Marcar como já tratados** tira da lista sem criar prazo.

Motivo: em 02/10/2026 havia 61 prazos a confirmar, o mais antigo de 17/08. Regras em `src/services/mutiraoPrazos.ts` (testadas); rotas `GET /api/prazos-detectados/mutirao` e `POST /api/prazos-detectados/lote`.

## Avisos de prazo que ficam mais fortes (desde 28/09/2026)

- **Prazo próximo (caso vinculado):** o aviso de "prazo em até 3 dias" agora escala — a partir de 2 dias o título ganha 🚨, e em menos de 24h vira "🚨 URGENTE". Com mais de 24h sobrando, o aviso repete a cada 6 horas; com menos de 24h, a cada hora (antes repetia igual toda hora, desde 3 dias).
- **Prazo vencido:** no momento em que um prazo pendente passa da data, sai UM aviso "🚨 PRAZO VENCIDO" (sino + Telegram, quando ligado), uma única vez por prazo. Só considera vencidos há até 2 dias, pra não despejar aviso de prazos antigos.
- **Prazo confirmado em processo sem caso vinculado:** esses prazos não entram na lista de Prazos nem nos avisos de 30/15/7/3/1 (que dependem de caso). Todo dia às 7h20 o sistema avisa os admins de cada um que vence nos próximos 30 dias, com título cada vez mais forte (semana / poucos dias / urgente), até alguém vincular o processo a um caso. O prazo também entra na Agenda normalmente, com ou sem caso.

## Avisos de alto valor no WhatsApp

Sentença publicada ou acórdão publicado avisam o escritório por WhatsApp **imediatamente**, além de qualquer prazo. Cada processo só avisa **uma vez** por tipo de marco — mesmo que o mesmo evento apareça de novo por outra fonte ou seja republicado pelo tribunal. Quando o processo não tem cliente vinculado, a mensagem tenta mostrar as partes identificadas na publicação em vez de só o número.

## Estagiário IA

Quando um prazo é detectado via DJEN, o sistema pode acionar um "estagiário IA" — análise automática da intimação com sugestão do que fazer, seguindo os mesmos playbooks configurados pra cada tipo de prazo.

## Fase sugerida do processo

O sistema tenta manter uma sugestão de fase processual (inicial, instrução, sentença, recurso, execução, encerrado) recalculada a partir do texto das movimentações mais recentes — é uma sugestão, não substitui a fase que você define manualmente no caso.


**Aviso de divergência (desde 28/09/2026):** se a fase sugerida pelas movimentações ficar À FRENTE da fase cadastrada por 3 dias ou mais, os admins recebem um aviso no sino ("Fase do processo pode estar desatualizada"), repetido a cada 14 dias enquanto persistir — antes só aparecia um selo na tela de Processos, que ninguém via sem abri-la. A fase nunca é alterada sozinha. Regras de sugestão em `src/utils/faseProcesso.ts`, com teste.
## Prescrição do caso (desde 30/09/2026)

Na ficha do caso, **Prescrição → informar**: data do fato gerador, botão *Sugerir data-limite pela área* e a data-limite. A sugestão é só ponto de partida (o sistema nunca decide prescrição):

| Área | Sugestão | Base |
|---|---|---|
| Trabalhista / Gestante | 2 anos do fato gerador | CF art. 7º, XXIX |
| Consumidor | 5 anos | CDC art. 27 |
| Cível | 3 anos | CC art. 206, §3º, V |
| Família (alimentos vencidos) | 2 anos | CC art. 206, §2º |
| Previdenciário / outras | sem sugestão | fundo de direito não prescreve — informar manualmente se for o caso |

Com a data preenchida, o vigia da carteira avisa a 90/60/30/15/7 dias. Depois de ajuizar, apague a data para parar os avisos.

## Automações (Configurações → Automações)

Regras prontas, cada uma liga/desliga na tela de Automações. Toda execução fica em `automation_runs` (ok/erro). Nenhuma delas manda mensagem ao cliente sozinha.

| Regra | Quando dispara | O que faz |
|---|---|---|
| Estagiário IA na intimação | Intimação detectada | Análise + minuta para revisão |
| Aviso no Telegram | Intimação detectada | Resumo aos admins (desligada por padrão) |
| Tarefa para vincular processo sem caso | Prazo confirmado | Tarefa com a data-limite real |
| Agendar o prazo | Prazo confirmado | Evento na agenda/Google no dia do prazo |
| **Tarefas iniciais do contrato** (30/09/2026) | Contrato assinado | "Enviar boas-vindas e lista de documentos" (D+1) e "Conferir documentos recebidos" (D+5), com a lista de documentos da área (trabalhista, previdenciário, família, gestante, consumidor ou genérica) |
| **Avisar cliente da mudança de fase** (30/09/2026) | Fase alterada manualmente (ficha do caso ou processo monitorado) | Tarefa para o dia seguinte com rascunho de mensagem em linguagem simples, pronto para revisar e enviar |

Regras em `src/services/playbooksNegocio.ts` (puras, testadas); motor em `src/services/automationService.ts`.

## Tarefa aguardando terceiro (desde 30/09/2026)

Em *Prazos & Tarefas*, o botão **Aguardando terceiro** marca a tarefa como travada esperando alguém (pergunta quem: cliente, perito, cartório). Ela aparece com o selo "Aguardando <quem>" e num bloco separado no fechamento do dia. **Retomar** volta para pendente.

## FAQ

**Por que um processo apareceu no sistema sem eu ter cadastrado?** Foi descoberto pela varredura DJEN por OAB — qualquer publicação endereçada à sua OAB entra automaticamente, mesmo sem cadastro prévio.

**Um processo pode ficar sem cliente vinculado pra sempre?** Só até alguém vincular manualmente — acontece quando a publicação tem mais de uma parte possível e o sistema não arrisca adivinhar.

**Se a mesma sentença aparecer de novo numa sincronização futura, avisa de novo?** Não — cada processo só dispara aviso de "Sentença publicada"/"Acórdão publicado" uma vez, para sempre (salvo o caso raro de uma segunda sentença real no mesmo processo).

**O texto das movimentações sempre vem limpo?** A partir de 03/09/2026 sim — antes disso, publicações do DJEN podiam chegar com HTML bruto e entidades não decodificadas; hoje são limpas automaticamente na entrada (ver [Monitoramento automático](10-monitoramento.md)).

## Links relacionados
- [Dativo](05-dativo.md) — nomeação dativa é um tipo específico de publicação detectada
- [Monitoramento automático](10-monitoramento.md) — como a varredura funciona por baixo
- [WhatsApp](03-whatsapp.md) — onde os avisos de marco processual chegam

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 28/09/2026 | Claude | Tipo de prazo por gatilho específico/título (`deteccaoPrazo.ts`), aviso de fase divergente (`processos:fase-divergente`), busca nacional por OAB passa a reportar falha por tribunal, testes de fase e tribunal — ideias 6, 7, 8 e 9 da auditoria |
| 28/09/2026 | Claude | Avisos de prazo escalonados (título 🚨 e repetição por urgência), aviso único ao vencer (`prazos:vencidos`) e alerta diário de prazo em processo sem caso (`prazos:sem-caso`) — ideias 2, 4 e 5 da auditoria |
| 30/09/2026 | Claude | Status de tarefa "aguardando terceiro" (com quem) |
| 02/10/2026 | Claude | Tarefa "Analisar" fecha ao confirmar/descartar o prazo detectado |
| 02/10/2026 | Claude | Cliente certo na descoberta + conferência; processos duplicados: prevenção + unir |
| 02/10/2026 | Claude | Mutirão de prazos detectados (confirmar/dar baixa em lote) |
| 30/09/2026 | Claude | Prescrição do caso com sugestão por área e avisos do vigia da carteira |
| 30/09/2026 | Claude | Automações: tabela das regras + novas regras de contrato assinado e mudança de fase |
| 28/09/2026 | Claude | Confirmação de prazo detectado passa a usar o cálculo com feriados/suspensão (`contarPrazo`) — antes só pulava fim de semana (achado crítico da auditoria) |
| 03/09/2026 | Claude | Criação do documento; registrada a correção de dedup de avisos e limpeza de HTML/entidades |

---
◀ [WhatsApp](03-whatsapp.md) · [Visão geral](00-visao-geral.md) · Próximo: [Dativo](05-dativo.md) ▶
