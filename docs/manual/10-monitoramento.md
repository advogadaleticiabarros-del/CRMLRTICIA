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
| `intimacoes:relatorio-diario` | 7h25 | **Novo (13/11/2026).** Relatório das publicações novas do DJEN: e-mail (PDF, CSV, recorte) e WhatsApp da equipe, com prazo, data limite e protocolar até. Ver [Processos](04-processos.md#relatório-diário-de-intimações-desde-13112026) |
| `monitoramento:tribunais-mni` | 7h10, 11h10, 15h10 e 19h10 | **Novo (17/11/2026).** Ligação oficial com os tribunais (MNI): intimações pendentes e movimentações direto do PJe do TJES e do eproc da JFES, com o login da Dra. Ver [abaixo](#ligação-oficial-com-os-tribunais-mni-desde-17112026) |
| `monitoramento:processos` | de hora em hora, 7h–20h | Sincroniza com o DataJud um **lote** de 25 processos, os sincronizados há mais tempo (a carteira inteira roda em ~6h); não começa se a anterior ainda estiver rodando e para no primeiro limite do CNJ |
| `monitoramento:processos-email` | 8h, 12h, 16h, 19h | Varre a caixa de e-mail conectada atrás de movimentação de tribunal fora do DJEN, inclusive o **Push do TRT17** (desde 18/11/2026; antes 8h e 19h) |
| `monitoramento:processos-pre-briefing` | 6h | Sincronização extra antes do briefing matinal, pra ele sair com dado fresco |
| `whatsapp:reconectar` | uma vez, na subida do servidor | Rearma o auto-envio se a sessão da Uazapi já estiver conectada — só isso, não vigia a conexão depois |
| `whatsapp:verificar-conexao` | a cada 20 minutos | **Novo (22/09/2026).** Checa se a instância continua conectada; se caiu, avisa no sino (throttle de 6h) em vez de depender de alguém abrir o Painel de Saúde ou tentar mandar mensagem pra notar. Não reconecta sozinho — quando a sessão é invalidada do lado do WhatsApp (ex.: "logged out from another device"), só escanear o QR de novo resolve |
| `monitoramento:vigia` | 13h30 e 20h30 | **Novo (28/09/2026).** Confere em `job_runs` se `monitoramento:processos` (ou o de 6h) completou ao menos uma rodada ok nas últimas 6 horas. Se não, avisa os admins no sino como rotina CRÍTICA — cobre o caso de o monitoramento travar/parar sem lançar erro, que antes só se percebia abrindo a tela de saúde das rotinas. Não roda se o servidor inteiro estiver fora do ar (aí nem o vigia existe) |
| `prazos:vencidos` | a cada 15 minutos | **Novo (28/09/2026).** Avisa uma única vez quando um prazo pendente vence (até 2 dias atrás) |
| `prazos:sem-caso` | 7h20 | **Novo (28/09/2026).** Alerta escalonado dos prazos confirmados em processo sem caso vinculado que vencem em até 30 dias |
| `processos:fase-divergente` | 7h40 | **Novo (28/09/2026).** Avisa quando a fase sugerida pelas movimentações fica à frente da fase cadastrada por 3+ dias (repete a cada 14) |
| `backup:diario` | 2h, 9h, 19h | Backup criptografado do banco (local + MEGA) |
| `leitor:decisoes-recentes` | no boot e 7h50 | **Novo (14/10/2026).** Lê sentenças/acórdãos dos últimos 15 dias ainda não lidos e manda a leitura à Dra. no WhatsApp (até 12 por rodada). Ver [Processos](04-processos.md#leitor-de-sentença-e-secretária-particular-desde-14102026) |

## Ligação oficial com os tribunais (MNI, desde 17/11/2026)

Pedido da Dra.: "melhorar o monitoramento, sem custo". O DataJud e o DJEN chegam com atraso; os sistemas pagos leem direto do tribunal. O CNJ obriga os tribunais a oferecer um canal oficial para sistemas externos, o **MNI** (Modelo Nacional de Interoperabilidade), gratuito, com o login da própria advogada. O CRM agora usa esse canal.

**O que faz (4x por dia, rotina `monitoramento:tribunais-mni`):**
- **Intimações pendentes:** lista o que ainda não foi aberto no tribunal e mostra a **data da ciência automática** (10 dias corridos depois de disponibilizada, Lei 11.419/2006, art. 5º, § 3º). Intimação nova avisa os admins no sino. Fica em Configurações → Ligação com os tribunais, em vermelho quando faltam 2 dias ou menos. Some da lista quando é aberta no tribunal.
- **Movimentações:** consulta cada processo monitorado no sistema certo (pelo número CNJ) e grava as novas junto das outras fontes, com `source = mni_<sistema>`. O PJe manda só o código do movimento; o nome por extenso vem do serviço público SGT do CNJ e fica guardado em `tpu_movimentos`.
- Processo de intimação que não existia no CRM é cadastrado (`source = 'mni'`).

**Só leitura, por construção:** o módulo (`src/services/mni/`) só conhece `consultarAvisosPendentes` e `consultarProcesso` (sem documentos). Não tem `consultarTeorComunicacao` nem `confirmarRecebimento` (abrir a intimação pelo sistema pode dar ciência e começar o prazo) nem `entregarManifestacaoProcessual` (protocolo). O teste `tests/mniTribunais.test.mjs` trava isso.

**Senha:** CPF e senha de cada sistema ficam criptografados em `mni_credenciais` (cada sistema tem a sua senha: a do 1º grau do TJES não serve no 2º grau). O login é testado **uma vez** antes de salvar. Se o tribunal recusar o login numa rodada, o CRM **desliga aquele sistema na hora** e avisa os admins, sem insistir (o TRE-ES, por exemplo, bloqueia a senha depois de erros). O CPF que o tribunal repete nas mensagens de erro é mascarado antes de ir para banco, sino ou log.

**Sem duplicar:** movimentação do MNI é tratada como a do DataJud (só o nome do andamento): gera **alerta**, nunca prazo presumido. Na primeira consulta de um processo, só entra o que for mais novo que a última movimentação já registrada (o histórico já veio pelo DataJud/DJEN). Mesmo dia + mesmo nome de andamento já registrado não entra de novo, nos dois sentidos (MNI depois do DataJud e DataJud depois do MNI).

**Sistemas (teste de 17/11/2026):**

| Sistema | Situação |
|---|---|
| TJES — PJe 1º grau | Login ok; **consulta pelo computador do escritório** (ver abaixo) |
| Justiça Federal ES — eproc | Login ok |
| TJES — PJe 2º grau e Turmas Recursais | Endereço ok; falta a senha certa (a do 1º grau foi recusada) |
| TRT17 (1º e 2º grau) | MNI recusado (HTTP 403 "administrative rules", de qualquer rede; exige credenciamento). **Desde 18/11/2026 entra pelo site do PJe-JT com o login da Dra.** (robô, ver abaixo) |
| TRE-ES, TSE 1º grau, SEEU | Ainda não ligados (TRE-ES responde; TSE recusou daqui; SEEU sem endereço achado) |

### Ponte do escritório para o TJES (desde 18/11/2026)

O TJES fica atrás de um firewall da Amazon (CloudFront) que **bloqueia o servidor do CRM** (VPS) com "403 Request blocked", antes mesmo do login. Da rede do escritório ele responde normalmente. O eproc da JFES não bloqueia.

Por isso o TJES (1º e 2º grau, `viaEscritorio: true` em `sistemas.ts`) é consultado **pelo computador do escritório**:

1. a rodada (ou o "Testar e salvar") põe a consulta numa fila **em memória** no servidor (`src/services/mni/ponteEscritorio.ts`), sem gravar nada;
2. o programa `scripts/ponte-escritorio/ponte.mjs`, rodando no computador do escritório, busca a fila em `/api/mni-ponte/pedidos` (espera de até 25 s), envia ao TJES e devolve a resposta em `/api/mni-ponte/respostas/:id`;
3. o resto da rodada segue igual (avisos, movimentações, ficha).

- **Só funciona com o computador do escritório ligado** e com a sessão do Windows aberta. Desligado: a consulta ao TJES falha na hora com "O computador do escritório não está conectado", sem afetar o eproc. Em Configurações → Ligação com os tribunais aparece "Consulta pelo computador do escritório: conectado/desligado".
- **Chave:** `MNI_PONTE_TOKEN` no `.env` do servidor, igual à de `%USERPROFILE%\.crm-ponte-escritorio.json` no computador. Sem a chave no servidor, a ponte fica desligada (503).
- **Segurança:** o programa do escritório só encaminha para os dois endereços oficiais do TJES (lista fixa, testada) e só repassa os cabeçalhos `Content-Type` e `SOAPAction`; não grava o conteúdo em log.
- **Instalação/reinstalação:** `powershell -ExecutionPolicy Bypass -File scripts\ponte-escritorio\instalar.ps1 [-Token <chave>]`. Cria a tarefa do Windows "CRM - ponte do TJES" (inicia ao fazer logon, sem janela, reinicia se parar). Log em `%LOCALAPPDATA%\crm-ponte-escritorio\ponte.log`.
- **Quando o TJES liberar o servidor:** tirar `viaEscritorio` dos dois sistemas TJES; a ponte deixa de ser usada.

Para incluir outro sistema: acrescente em `SISTEMAS_MNI` (`src/services/mni/sistemas.ts`) com o endereço e a regra do número CNJ.

### Lista de documentos das petições (desde 28/11/2026)

Pedido da Jessica: o CRM dizer sozinho se o prazo foi cumprido lendo o TJES. O problema: no PJe, a movimentação vem só como **"Petição"**, sem o tipo e sem quem juntou, então a Dra. Paula não tinha como saber se foi a nossa parte.

- **O que faz:** na mesma rodada do MNI, quando um processo tem "Petição" (código 85) juntada nos **últimos 30 dias** e ainda não lida, o CRM pede ao tribunal a **lista de documentos** do processo (`documentosDoProcesso`, em `cliente.ts`). No máximo 15 processos por rodada.
- **O que guarda** (`mni_documentos`, migration 192): o tipo, a descrição ("Réplica", "Contestação"…), a data, o movimento que juntou, se é anexo de outro documento e **se foi assinado pelo login da Dra.** (`assinado_pelo_login`). CPF de quem assinou fica mascarado.
- **O que nunca faz:** pedir ou guardar o **conteúdo** dos documentos (o `<conteudo>` que vier é descartado) e abrir intimação (continua bloqueado; ver "Só leitura", acima).
- **Não repete:** `legal_processes.mni_documentos_ate` guarda até qual petição já leu.
- **Falha:** se o tribunal recusar ou demorar, tenta de novo na próxima rodada. Login recusado para o sistema, como nas outras consultas.
- **Para que serve:** é a base da baixa automática de prazos. A regra da Dra. Paula ainda **não** usa esses dados; ela passa a usar depois de conferirmos o formato real que o TJES devolve.
- Código: `src/services/mni/cliente.ts` (`lerDocumentos`), `monitorMni.ts` (`precisaLerDocumentos`) e `index.ts` (gravação). Testes: `tests/mniDocumentos.test.mjs`.

### TRT17 pelo site do PJe-JT, com o login da Dra. (desde 18/11/2026)

O MNI do TRT17 só atende credenciados. A pedido da Dra. ("quero fazer o login direto exatamente igual fizemos TJES"), o CRM entra no **site** do PJe-JT com o CPF e a senha dela, como ela entraria, e lê o que ela veria. Aparece na mesma tela (Configurações → Ligação com os tribunais) como **TRT17 — PJe-JT 1º grau (site)** e **2º grau (site)**; a rodada, os avisos de intimação, a gravação dos andamentos e o desligamento por login recusado são os mesmos do TJES.

- **Caminho:** pelo computador do escritório (o site do TRT17 também bloqueia o servidor do CRM). A ponte (`scripts/ponte-escritorio/ponte.mjs`) só abre o site do TRT17 (`/primeirograu/`, `/segundograu/`, `/pjekz/`, `/pje-comum-api/api/`, `/pje-seguranca/api/`) e o login nacional (`sso.cloud.pje.jus.br/auth/realms/pje/`), **só por GET**; POST só no envio do formulário de login. Não segue redirecionamento sozinha: devolve os cabeçalhos e quem segue é o CRM.
- **Login:** `/{grau}/authenticateSSO.seam` → plataforma nacional (Keycloak) com CPF e senha → **código do autenticador** (a conta da Dra. tem 2 fatores) → volta ao PJe com os cookies `access_token` (JWT com o id do usuário) e `Xsrf-Token`. Uma vez por rodada. Senha errada, código recusado, código pedido sem chave cadastrada ou ação pendente no site (trocar senha, aceitar termo) → login recusado: desliga o sistema e avisa (não tenta de novo).
- **Código do autenticador (desde 18/11/2026, escolha da Dra.):** o CRM gera o código sozinho (`src/services/pjeJt/totp.ts`, RFC 6238: SHA-1, 6 dígitos, 30 s) a partir da **chave do autenticador** cadastrada na mesma tela (campo "Chave do autenticador", só nos sistemas do TRT17), guardada criptografada em `mni_credenciais.totp_enc` (migration 186). A chave é o texto do QR code: a Dra. configura o autenticador de novo na conta PDPJ, lê o QR com o celular **e** cola a chave no CRM (os dois geram o mesmo código). Se a tela tiver mais de um autenticador, vale o marcado. **Risco aceito por ela:** o CRM passa a guardar a senha e o segundo fator.
- **Intimações:** painel do advogado "Meus Expedientes" (`/pje-comum-api/api/paineladvogado/{id}/processos?tipoPainelAdvogado=2`); o detalhe (tipo, data) vem de `/processos/id/{id}/expedientes`. Só entram as ainda sem ciência. **Só leitura:** nada é aberto (não dá ciência), assinado ou enviado.
- **Andamentos:** a lista de processos da Dra. vem do "Acervo geral" do painel (`tipoPainelAdvogado=1`); os andamentos, de `/processos/id/{id}/timeline?buscarMovimentos=true&buscarDocumentos=false`. Fonte `mni_trt17_pje1g`/`mni_trt17_pje2g`.
- **Código:** `src/services/pjeJt/navegador.ts` (cookies e redirecionamentos) e `clientePjeJt.ts` (mesma interface do cliente MNI); `ponteEscritorio.requisitar`. Testes: `tests/pjeJt.test.mjs` (site falso) e `tests/mniPonteEscritorio.test.mjs`.
- **Endereços descobertos no código público do site** (`pje.trt17.jus.br/pjekz`), não em documentação. Se o site mudar, a rodada falha com mensagem clara e o resto do CRM segue. `diagnostico()` do cliente lista só os **nomes** dos campos e cookies recebidos (sem dados) para conferir o formato.
- **Riscos aceitos pela Dra.:** o site pode mudar sem aviso; o robô não contorna código no celular nem "não sou um robô"; automatizar o site fica numa zona cinzenta das regras de uso do tribunal (o MNI oficial continua sendo o caminho quando houver credenciamento).

## Central de andamentos (desde 17/11/2026)

A tela **Andamentos nos tribunais** virou a caixa de entrada da equipe, com quatro abas:

- **Caixa de entrada:** toda movimentação de qualquer fonte (DJEN, PJe/eproc, DataJud, e-mail), da mais nova para a mais antiga, com etiqueta de tipo (sentença, acórdão, decisão, despacho, intimação, citação, audiência...) e de fonte. Situação da **equipe**: não lida → lida → tratada, com quem e quando (`process_movements.lida_em/lida_por/tratada_em/tratada_por`, migration 181). Filtros por situação, cliente/processo e tipo. "Criar prazo" abre o formulário de prazo já com o caso, a descrição e a data da publicação, e marca o andamento como tratado. Na migration, o que tinha mais de 7 dias entrou como lido.
- **Intimações pendentes:** as do tribunal (MNI), com a data da ciência automática. Leitura para a equipe; o login continua só com admin.
- **Ações novas de clientes:** ver abaixo.
- **Termômetro (desde 18/11/2026):** ver abaixo.
- **Processos monitorados:** a tabela de antes, sem mudança de uso.

No topo, quatro números: não lidas, intimações pendentes (com a ciência automática mais próxima), ações novas e audiências nos próximos 30 dias. Regras em `src/services/centralAndamentos.ts`; rotas `/api/andamentos` (equipe).

## Termômetro dos casos (desde 18/11/2026)

Aba **Termômetro** em Andamentos nos tribunais. Para cada processo ativo (fora os de fase "encerrado" e os arquivados) mostra:
- **Dias parado:** contados da última movimentação de qualquer fonte (`process_movements` ou `legal_processes.last_movement_at`, a mais recente).
- **Faixa:** até 30 dias, 31 a 60, 61 a 100, **parado (mais de 100)** ou sem movimento.
- **Fase**, com "conferir: parece X" quando a fase sugerida pelos andamentos (`suggested_phase`) é outra. O CRM **não troca a fase sozinho**.
- **Sistema do tribunal**, pelo número CNJ: TJES 1º grau, TJES 2º grau (origem 0000), eproc JFES, TRT17 (pelo site, login do 1º grau) e os de fora do ES. Para cada um, a situação do login: ligado, falta o login ou sem ligação direta.

No topo ficam a **temperatura** (% dos ativos que andaram nos últimos 60 dias), a barra por faixa (clicar filtra) e as fases. Embaixo, a tabela de logins por sistema e a lista com busca, filtro por sistema e "só fase a conferir". Regras em `src/services/termometroCasos.ts`; rota `GET /api/andamentos/termometro` (equipe).

## Ficha do cliente completada pelo tribunal (desde 18/11/2026)

Com o login ligado, a rodada do MNI (`consultarProcesso`, com cabeçalho) também lê as **partes** do processo: polo, nome, CPF/CNPJ, nascimento e endereço, sem os advogados (`lerPartes`, `src/services/mni/cliente.ts`). A ficha do cliente ligado ao processo é completada só nos campos **vazios** e só quando o nome da ficha é igual ao de uma parte (sem acento, maiúsculas ou pontuação). Não completa quando: o nome só é parecido; o mesmo nome aparece com documentos diferentes (homônimo); o CPF/CNPJ não confere; ou o CPF já está em outra ficha. Pessoa jurídica recebe só o CNPJ. Regras em `src/services/mni/fichaPeloTribunal.ts`. O resumo da rotina mostra `campos_de_ficha_completados`.

**Valor da causa e partes no processo (desde 18/11/2026):** a mesma rodada guarda em `legal_processes` o `valor_causa`, a lista `partes_json` (só polo, nome e tipo de pessoa; CPF, nascimento e endereço não entram) e `dados_tribunal_em` (migration 183, `resumoDasPartes`). O caso ligado (`cases.valor_causa`) recebe o valor só se estiver vazio. A janela do processo (Andamentos nos tribunais → clicar no processo) mostra esse quadro quando há dado do tribunal.

## Ação nova envolvendo cliente (desde 17/11/2026)

Uma vez por dia, quando alguém da equipe abre o CRM, o **navegador** procura no DJEN (últimos 7 dias) o nome de cada cliente com caso ou processo ativo (o DJEN bloqueia o IP do servidor, igual à busca por OAB). Só entra publicação em que um destinatário tem **exatamente** o nome do cliente e cujo processo ainda não está no CRM (nem no Dativo). Aparece em "Ações novas de clientes" dizendo se o cliente está no polo passivo (**contra o cliente**) ou ativo; avisa no sino. A equipe confirma (cadastra o processo ligado ao cliente, com monitoramento) ou descarta como homônimo (não volta). Nome com uma palavra só, "segredo de justiça" ou iniciais não é pesquisado. Se o DJEN limitar (429/403), a busca para e tenta no dia seguinte. Tabelas `acoes_novas_clientes` e `acoes_novas_buscas`; regras em `src/services/acoesNovasClientes.ts`.

**Leitura organizada (desde 18/11/2026):** a aba agrupa por cliente (cliente com processo **contra ele** vem primeiro; dentro do grupo, a publicação mais recente), ou lista tudo por data. Em cima, os totais por polo funcionam como filtro (clique de novo para tirar); há busca por cliente ou nº do processo e filtro por tribunal. Cada processo mostra tribunal, classe e órgão em campos separados; o texto da publicação fica recolhido em "Ler a publicação" (o DJEN guarda até 600 caracteres). Os filtros ficam quando se confirma ou descarta um item.

## TRT17 pelo aviso Push por e-mail (desde 18/11/2026)

O TRT17 recusa a ligação direta (MNI) sem credenciamento (HTTP 403). Sem pedir nada ao tribunal, o CRM cobre o TRT17 por três vias: **DJEN** (publicações pela OAB), **DataJud** (andamentos, com atraso) e o **Push do PJe**: o tribunal manda um e-mail a cada atualização dos processos em que a Dra. atua ("[TRT17] [PUSH] Atualizações de Informações Processuais do Processo …", de `notificacoes@trt17.jus.br`). O Push já estava ligado na conta dela.

- **Leitura:** `src/services/pushTribunal.ts` reconhece o e-mail Push (de qualquer tribunal `.jus.br`) e lê a tabela do e-mail: cada linha (data + texto) vira um movimento separado, com a data do tribunal e o texto original, sem resumo de IA. O número do processo sai do assunto. Se o formato não for reconhecido, o e-mail segue o caminho antigo (um movimento resumido por e-mail).
- **Gravação:** `registrarMovimentoDoPush` (monitoringService) confere cada movimento contra as outras fontes pelo **dia e pelo texto** (o caminho antigo descartava tudo que tivesse outra movimentação em ±3 dias). Fonte `email_monitoramento`, com `movement_metadata.push = 'TRT17'`; prazo, audiência e acordo são detectados como nas outras fontes. WhatsApp da equipe: um aviso por e-mail com até 5 movimentos.
- **Processo que não está no CRM:** antes era descartado no log. Agora aparece em Andamentos → **Ações novas de clientes**, no quadro "Processos que chegam por e-mail do tribunal e não estão no CRM", com "Cadastrar processo" (abre o formulário com o número e a área trabalhista). Rota `GET /api/court-email-monitor/processos-sem-cadastro`. Sai da lista quando o processo é cadastrado.
- **Depende da conexão do Gmail** em Configurações → Monitoramento por e-mail. Se o Google cancelar a autorização (`invalid_grant`), nada entra: desde 18/11/2026 isso avisa no WhatsApp (ver abaixo).
- **Termômetro:** desde a ligação pelo site (abaixo, mesmo dia), o TRT17 aparece como sistema com login ("TRT17 — PJe-JT 1º grau (site)"); o Push continua como fonte extra.

### Aviso de queda da conexão Google (desde 18/11/2026)

Quando uma rotina que usa o Google (e-mail dos tribunais, Agenda, Gmail da parceria) falha por autorização cancelada, `src/services/avisoConexaoGoogle.ts` (chamado pelo `runJob`) manda ao WhatsApp pessoal do escritório e ao sino o que parou e onde reconectar, **no máximo 1 vez a cada 24 horas** (marca: notificação `conexao_google_caiu`). Antes o aviso ia só para o sino e passou 12 dias sem ser visto.

## Audiência na agenda sozinha (desde 17/11/2026)

Toda movimentação nova passa por `src/services/audienciaDetectada.ts`. Se o texto marca audiência com **data e hora no futuro** ("designo audiência de conciliação para 10/12/2026, às 14h00"), o CRM lança na agenda da Dra. (tipo audiência, 1 hora, com o processo, o local ou o link da sala virtual e o trecho) e no Google Agenda se estiver conectado, e avisa no sino. Sem hora, com data passada, "realizada" ou "cancelada" (sem redesignação) não lança. Não duplica: a mesma movimentação só uma vez (`audiencias_detectadas`), o mesmo processo e horário vindos de outra fonte reaproveitam o evento, e audiência já na agenda (mesmo cliente/caso e horário) não ganha cópia. Na Caixa de entrada, a movimentação mostra "Na agenda: dd/mm às hh".

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

### Raio-x da carteira do Dr. Vítor (desde 19/11/2026)

Pedido da Jessica: o Dr. Vítor só mostrava números ("divergentes: 54 · avisos: 5") e não falava com ninguém. Agora a rotina `carteira:raio-x` roda todo dia às **6h45** (antes do briefing das 7h) e confere **cada processo ativo e cada caso ativo**:

| Pendência | Gravidade | Quem cuida |
|---|---|---|
| Prescrição (caso sem processo, data-limite em até 90 dias) | crítica até 15 dias ou vencida; alta até 30; média até 90 | Dra. Paula (prazos) |
| Ação não proposta (caso de área judicial, sem processo nem protocolo há 30+ dias) | média; alta com 60+ | Enzo (produção) |
| Consulta ao tribunal atrasada (3+ dias sem consulta, ou nunca) | média; alta com 7+ | Dra. Tereza (tribunais) |
| Processo parado (30+ dias sem movimentação) | baixa; média com 60+; alta com 90+ | Dra. Paula; Enzo se 60+ e sem prazo em aberto (petição de andamento) |
| Fase desatualizada (a sugerida pelas movimentações está à frente) | média para sentença/execução/encerrado | Dr. Lucas (sentença/recurso), Dr. Fábio (execução), Dra. Clara (encerrado) |
| Fase "Encerrado" com processo ainda ativo | média | Dra. Clara |
| Processo sem cliente | média | Dra. Clara |
| Sem caso, sem valor da causa, fora do monitoramento | baixa (ajuste de cadastro) | Dra. Clara / Dra. Tereza |

- Consulta atrasada **substitui** o "parado" do mesmo processo: sem dado novo do tribunal, não dá para dizer que parou.
- **Saúde da carteira** = % de processos sem pendência média ou maior (ajustes leves de cadastro não derrubam).
- **Repasse aos colegas:** o Vítor registra uma ação por colega ("passou 6 pendência(s) à Dra. Tereza: …") e a sociedade transforma em conversa no mural, com frases que variam. Repassa só o que é novo ou piorou; na primeira vez e às segundas, repassa tudo. Quando algo se resolve, ele agradece à Dra. Tereza. O resumo do dia vai à Dra. Clara.
- **Entrega à Dra.:** linha "📋 Carteira (Dr. Vítor)" no briefing (e-mail das 7h e WhatsApp das 8h) quando há ponto grave; aviso no sino **só** quando surge ou piora algo grave, e o resumo completo às segundas; pauta completa com filtros por gravidade e por colega na ficha do Dr. Vítor (Escritório virtual → Dr. Vítor).
- **Nada é alterado sozinho** e nada vai para cliente: é só leitura e aviso. Só o primeiro nome do cliente aparece (a sala também passa na TV).
- Foto de cada dia em `carteira_raio_x` (migration 188), para comparar com a anterior. Rodar de novo no mesmo dia atualiza a foto sem repetir conversa nem aviso.
- Regras puras: `src/services/carteiraRaioX.ts` (testes em `tests/carteiraRaioX.test.mjs`); banco e avisos: `carteiraRaioXJob.ts`; tela: `GET /api/escritorio/carteira`.
- As rotinas antigas continuam (`carteira:vigia` 7h30 e `processos:fase-divergente` 7h40), agora com resultado legível no "Trabalho recente" ("avisos de processo parado: 2 · avisos de prescrição: 0").

## Análise da movimentação pela IA em formato fixo (desde 30/09/2026)

Cada movimentação nova é analisada pela IA (Groq, com Gemini de reserva) em **modo JSON**: resumo, ação, prazo interno, prioridade, **tipo** (sentença, acórdão, decisão, despacho, intimação, citação, audiência, recurso, trânsito em julgado, juntada, outro) e **grau** (1º, 2º, tribunal superior). Cada campo é validado em `src/services/movimentacaoIa.ts`. Antes o sistema "recortava" texto solto e, se a IA escrevesse diferente, falhava em silêncio; agora resposta fora do formato não é gravada e a movimentação fica como *não analisada* (aparece assim no briefing).

## Tribunais e instabilidade do DataJud

A consulta por número de processo cobre TJES, TRT17, TRF2, TRE-ES (Espírito Santo), TJPR, TRT9, TRF4, TRE-PR (Paraná), STJ e TST. Quando o CNJ responde com instabilidade (erro 5xx, timeout ou queda de rede), o sistema tenta de novo sozinho até 3 vezes, com espera crescente (1,5s, 3s). Erros de cliente (ex.: 401, 404) não são repetidos.

**Sobrecarga do DataJud (429), desde 23/11/2026:** o 429 do DataJud vem do servidor de buscas do CNJ com a fila cheia (`es_rejected_execution_exception`), ou seja, o serviço está sobrecarregado para todo mundo, não é um bloqueio do CRM. todas as consultas por número passam por um freio único (`src/services/freioDataJud.ts`): uma por vez, com 2s entre elas (`DATAJUD_INTERVALO_MS`). Se o CNJ responder 429, ou não responder em nenhuma tentativa, as consultas **automáticas** param por 15 minutos (`DATAJUD_PAUSA_MS`) e voltam sozinhas; 429 não é repetido (só gastava mais limite). O botão **Sincronizar agora** passa à frente e tenta mesmo durante a pausa; se o CNJ recusar, aparece "O DataJud (CNJ) está sobrecarregado e recusando consultas agora… Tente de novo depois das HH:MM", em vez de "DataJud HTTP 429". Movimentações continuam chegando pela ligação oficial com o tribunal (MNI) e pelo DJEN.

## O que fazer se um robô parecer travado

Cada execução é registrada com sucesso ou falha (visível nos logs do servidor). Falhas são best-effort — uma rotina quebrando não derruba as outras nem o sistema. Se um robô específico parece ter parado (ex.: processo não sincroniza há dias), o primeiro lugar a olhar é se a integração externa (DJEN, e-mail, DataJud) está fora do ar, não necessariamente o CRM.

## FAQ

**Por que às vezes um processo demora para sincronizar pelo DataJud?** `monitoramento:processos` roda de hora em hora e, desde 23/11/2026, cada rodada pega 25 processos (os mais antigos primeiro): cada processo é consultado no DataJud mais ou menos a cada 6 horas. Para ver na hora, use **Sincronizar agora** na ficha do processo. Intimações e publicações chegam antes pelo MNI e pelo DJEN.

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
| 28/11/2026 | Claude | MNI: lista de documentos das petições recentes (tipo, descrição, se assinou a Dra.; nunca o conteúdo), em `mni_documentos`, base da baixa automática de prazos |
| 23/11/2026 | Claude | DataJud: freio único (uma consulta por vez, pausa de 15 min após 429/timeout, sem repetir 429), monitoramento em lotes de 25 sem rodada sobreposta, botão manual com prioridade e mensagem clara |
| 19/11/2026 | Claude | Raio-x da carteira do Dr. Vítor (`carteira:raio-x`, 6h45): 10 tipos de pendência com gravidade e colega responsável, repasse que vira conversa, briefing, sino só para grave nova e pauta na ficha |
| 18/11/2026 | Claude | TRT17 pelo site: o CRM gera o código do autenticador (2 fatores) pela chave cadastrada, criptografada (migration 186) |
| 18/11/2026 | Claude | TRT17 pelo site do PJe-JT com o login da Dra. (robô pela ponte do escritório): intimações de "Meus Expedientes" e andamentos do acervo, só leitura |
| 18/11/2026 | Claude | TRT17 pelo Push por e-mail: cada movimento do e-mail vira um andamento (data e texto do tribunal), processos do Push fora do CRM listados para cadastrar, leitura 4x/dia e aviso no WhatsApp quando a conexão Google cai |
| 18/11/2026 | Claude | Ações novas de clientes: agrupadas por cliente, totais por polo como filtro, busca, filtro por tribunal e texto da publicação recolhido |
| 18/11/2026 | Claude | Ponte do escritório: o TJES bloqueia a VPS (403 do CloudFront), então a consulta ao TJES sai pelo computador do escritório (`ponteEscritorio.ts` + `scripts/ponte-escritorio/`) |
| 18/11/2026 | Claude | Valor da causa e lista das partes guardados no processo pela rodada do MNI e mostrados na janela do processo; caso recebe o valor só se vazio |
| 18/11/2026 | Claude | Termômetro dos casos (dias parados, faixa, fase a conferir, login que falta por sistema) e ficha do cliente completada com as partes vindas do tribunal (MNI), só campos vazios e nome exato |
| 17/11/2026 | Claude | Central de andamentos (caixa de entrada com lida/tratada), ação nova envolvendo cliente (nome no DJEN, pelo navegador) e audiência lançada sozinha na agenda |
| 17/11/2026 | Claude | Ligação oficial com os tribunais (MNI): rotina `monitoramento:tribunais-mni` (4x/dia), intimações pendentes com data da ciência automática e movimentações direto do PJe do TJES e do eproc da JFES |
| 13/11/2026 | Claude | Nova rotina `intimacoes:relatorio-diario` (7h25); prazo das publicações do DJEN pela regra de `prazoIntimacao.ts` |
| 26/10/2026 | Claude | Captura do DJEN: parte "REPRESENTANTE e B. F. S. C." (menor em segredo de justiça) cria a ficha do representante; nome só com iniciais não vira ficha nem é juntado a outra ficha com as mesmas iniciais (ver runbook) |
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
