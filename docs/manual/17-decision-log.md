# 17 · Decision Log

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte, commits e conversas) · **Última atualização:** 04/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** adicionar uma linha a cada decisão não óbvia de arquitetura/produto — nunca reescrever uma entrada antiga, só adicionar uma nova se a decisão mudar

## TL;DR

Registro cronológico de decisões que não são óbvias só lendo o código — o "por quê" por trás de escolhas de arquitetura e de produto, pra ninguém perder tempo revertendo algo que já foi decidido de propósito.

## Contexto

Consulte antes de "corrigir" algo que parece estranho à primeira vista — pode ser uma decisão deliberada, não um descuido. Também consulte pra entender por que o sistema é do jeito que é, não só o que ele faz.

## Regra desta página

Nunca editar uma entrada antiga pra "consertar" — se uma decisão mudou, adiciona uma entrada nova referenciando a antiga. O log é a história real, não uma versão final polida.

## Registro

### 31/10/2026 — Devolução em dobro de todos os descontos (Tema 929 do STJ)
**Decisão:** a planilha e a peça devolvem em dobro todos os descontos, sem o marco de 30/03/2021 (`MARCO_DOBRO = null` em `pecaCalculos.ts`).
**Motivo:** a Corte Especial do STJ concluiu o Tema 929 em 15/09/2026 sem modulação: a dobra não depende de má-fé e não fica restrita às cobranças posteriores a 30/03/2021 (Migalhas, "Tema 929: Como fica a repetição do indébito em dobro?"; Cálculo Jurídico, 21/09/2026). A Jessica pediu o cálculo "100% assertivo".
**Ressalva:** a fonte lida não é o acórdão; conferir a tese publicada pelo STJ. Para voltar à regra antiga, basta `MARCO_DOBRO = '2021-03'`.

### 31/10/2026 — Juros pela Taxa Legal publicada pelo Bacen
**Decisão:** de 09/2024 em diante, os juros de mora são a Taxa Legal mensal da série SGS 29543, somada mês a mês; sem a taxa do mês, Selic − IPCA com aviso.
**Motivo:** a Resolução CMN 5.171/2024 define a metodologia (razão entre a Selic e o IPCA-15 do mês anterior, piso zero, juros simples). A conta que o sistema fazia (Selic − IPCA do próprio mês) dá outro número. Fonte: estudo da Divisão de Cálculos da JFRS publicado pelo TRF4.
**Convenção de agosto/2024:** 1% ao mês até 08/2024, inclusive; Taxa Legal a partir de 09/2024 (a mesma do programa de cálculos da Justiça Federal).

### 31/10/2026 — Calculista liga os descontos aos contratos em código, na leitura
**Decisão:** a IA só copia cada desconto do histórico de créditos com a rubrica; a atribuição ao contrato (rubrica + parcela + período) é feita em código (`contabilista.ts`), e a planilha de cada banco é salva já na leitura.
**Motivo:** o histórico de créditos não mostra o banco. Pedir à IA o banco de cada desconto gerava descontos sem dono, que a regra "uma peça por banco" descartava: a peça do Valmirio saiu com R$ 0,00. A regra em código é testável e não inventa: o que é ambíguo fica sem dono, com o motivo.

### 30/10/2026 — Geração da peça registrada no banco para ser retomada (revê em parte a entrada seguinte)
**Decisão:** a trava continua na memória, mas cada geração em andamento também fica em `geracoes_peca_pendentes`; no início do CRM, o que sobrou é gerado de novo (no máximo 2 retomadas por pedido).
**Motivo:** a entrada seguinte supunha que perder a geração num reinício era aceitável. Na prática, as publicações reiniciam o CRM várias vezes por dia e a Jessica ficou sem a versão e sem aviso. Retomar sozinho é o que ela espera; o limite de 2 evita repetir sem fim uma geração que derruba o servidor.
**Alternativa considerada:** só avisar no sino que a geração foi interrompida. Descartada: obriga a pedir de novo algo que o sistema pode refazer sozinho.

### 30/10/2026 — Trava da geração da peça na memória do servidor
**Decisão:** a trava "esta peça já está sendo gerada" e a etapa da barra de progresso ficam num mapa em memória (`travaGeracaoPeca.ts`), não numa tabela.
**Motivo:** o CRM roda num único processo (PM2 `crm-juridico`) e a geração também vive nesse processo: se ele reiniciar, a geração se perde junto com a trava, então não há o que proteger no banco. Sem migration e sem consulta a cada 4 s ao banco. Trava esquecida solta em 30 min.
**Rever se:** o CRM passar a rodar em mais de um processo (cluster) ou a geração virar uma fila de trabalhos.

### 30/10/2026 — Juros desde cada desconto: critério confirmado
**Decisão:** confirmado o critério da entrada de 28/10 ("Planilha de cálculos"): juros de mora e correção monetária contam **desde cada desconto**, nunca desde a citação. A planilha, o demonstrativo e o valor da causa saem sempre com os juros atualizados até a data-base.
**Quem decidiu:** a Jessica, em 30/10/2026 ("sim, sempre juros atualizados").
**Efeito:** nenhuma mudança de código; o padrão de `planilhaCalculos.ts` já é este. Deixa de ser pendência.

### 28/10/2026 — Contratos do cliente guardados um a um, e a Dra. diz em qual processo cada um entra
- Pedido da Jessica, depois da peça do Itaú com contratos do PAN e da FACTA: "uma forma de você me trazer tudo que ele tem e eu poder associar e produzir uma peça só", relacionando o tipo (RCC, RMC, empréstimo) e a parte contrária.
- **Os contratos são do cliente, não do caso** (`cliente_contratos`). O extrato do INSS é um só e alimenta vários processos. Guardar por caso duplicaria os mesmos contratos em cada card.
- **A decisão é por contrato** (`case_id` ou `fora`), não por peça. Assim a escolha sobrevive a novas leituras e a novas versões da peça.
- **Sem decisão, a regra é conservadora:** só o banco do réu e a mesma tese. Um contrato a menos aparece na mesa como "Fora desta peça" e pode ser corrigido. Um contrato a mais na peça é o erro que motivou a mudança.
- **Banco comparado pelo nome próprio** ("Itaú Consignado" = "Banco Itaú"), porque o HISCON não traz CNPJ. Empresas do mesmo grupo com nomes diferentes (ex.: Olé e Santander) não batem sozinhas: a Dra. associa à mão.
- **Alternativa descartada:** filtrar só pelo prompt ("fale apenas do réu"). A IA já tinha recebido a regra implícita no título e mesmo assim citou os outros bancos; e o cálculo, feito em código, continuaria somando os descontos deles.

### 22/10/2026 — Processo único por banco e por família de tese, com confirmação
- Regra da Jessica: RMC e RCC do mesmo banco vão numa peça; vários empréstimos consignados do mesmo banco, numa peça; "empréstimo pessoal é diferente de empréstimo consignado, outro processo. Mesmo que do mesmo réu, são teses muito diferentes".
- Respostas dela: cartão consignado + empréstimo consignado do mesmo banco ficam **separados**; juros abusivos são sempre pedido **dentro** da peça; refinanciamento e portabilidade são da família do consignado; cartão comum é separado do consignado.
- **Muda a decisão anterior (mesma data):** a esteira juntava sozinha pela parte contrária. Agora só junta o que a Dra. confirmou (`cases.unido_ao_caso`). Juntar ou separar é estratégia: teto do Juizado, dano moral por processo, tese.
- **O banco também sai do título** ("RCC — Banco PAN"), porque muitos casos não têm a parte contrária cadastrada.
- **Tese não identificada não é sugerida:** só junta o que tem certeza.

### 22/10/2026 — Mesa do caso: a edição da Dra. vira versão nova e ensina a equipe
- Pedido da Jessica: a 1ª edição cria a v2, e "o agente responsável aprende junto com a Laya a maneira correta de produção e as regras, assim eles podem comparar as versões e anotar onde errou".
- **A versão da equipe nunca é sobrescrita** (`documents.versao_de`). Sem ela, não há o que comparar nem de onde aprender.
- **Lição só vira regra com o "Aprovar" da Dra.** A IA propõe; regra errada aprovada sozinha estragaria todas as peças seguintes da área. "Só neste caso" fica restrita ao caso.
- **Texto formatado em coluna própria** (`content_html`), limpo por lista fechada no servidor. O `content` continua texto puro para a revisão, a Dra. Vera, a contagem de [colchetes] e as buscas, que não precisam mudar.
- **Tela cheia em vez de modal**, por baixo dos modais (camada 90 < 100), para perguntas, confirmações e documentos abrirem por cima dela.
- **Alternativa descartada:** editor de terceiros (CKEditor/TinyMCE). Mais peso e outra superfície de ataque, para uma formatação de peça que cabe em poucas marcações.

### 22/10/2026 — Petição inicial pela esteira dos agentes, com cálculo em código
- Pedido da Jessica: documentos lidos de fato, cálculos feitos de fato, peça com contexto, e os agentes de cada função atuando na produção.
- **Cálculo nunca pela IA.** A IA só extrai os números das fontes (com a fonte de cada um); a soma, a modulação simples/dobro do EAREsp 600.663/RS e a tabela Price são código testado. O redator recebe os valores prontos e a peça é conferida contra eles. Motivo: IA erra conta e arredonda sem avisar.
- **Peça conjunta automática** para mesmo cliente + mesma área + mesma parte contrária antes do protocolo (regra do escritório: "o que for correlacionado da mesma parte contrária é na mesma peça inicial"). Identidade da parte: raiz do CNPJ (8 dígitos) ou nome normalizado; CNPJs diferentes são empresas diferentes mesmo com nome igual. Outra área não junta (trabalhista e consumidor contra o mesmo banco são ações distintas).
- **Modelo escolhido pelo guia do cofre**, não só por semelhança de texto: no RMC/RCC a estratégia (nulidade, conversão, inexistência) depende de fatos da triagem (sacou o dinheiro? recebeu o cartão?), e o guia "Como escolher" do escritório já diz isso.
- **Esforço de raciocínio:** médio para ler documentos, alto para redigir; o resto do sistema segue no baixo (custo).
- **Dano moral e taxa média do Bacen não são inventados:** sem valor nas fontes, ficam em [colchete] e o dossiê avisa.
- **Alternativa descartada:** só aumentar os limites do prompt antigo. Não resolveria cálculo, escolha de estratégia nem a junção dos casos.

### 20/10/2026 — Automações antigas a cliente também passam pela aprovação
- A ordem da Jessica de 19/10 foi geral: "Não envie mais nenhuma mensagem sem consentimento". Os agentes já estavam na fila; faltavam as automações antigas (acompanhamento, expiração e recusa de proposta, newsletter, aceite com PIX, e-book).
- **O que muda no sistema continua automático** (status, prazo extra, inscrição, contrato). Só a mensagem ao cliente espera alguém aprovar.
- **Botões e PIX preservados:** o rascunho guarda como a mensagem sai (`atendente_rascunhos.envio`). A pendência dos botões só nasce no envio, para a janela de resposta contar a partir dele.
- **O e-mail do e-book continua automático:** é o material que a própria pessoa pediu no formulário. Só o aviso no WhatsApp vai para a fila.
- **Alternativa descartada:** desligar essas automações. Elas continuam úteis como lembrete; o custo é a equipe aprovar algumas mensagens por dia.

### 16/10/2026 — Ficha automática grava sozinha, mas só o vazio
- A Jessica pediu que o CRM preencha sozinho o que o lead manda ("sempre tenho que completar manualmente"). Vale também a regra da casa: "todo dado enviado vai inteiro para a ficha, sem perguntar".
- **Por isso grava sem confirmação**, mas só campo **vazio** e lido com segurança.
- **Sobrescrever nunca é automático:** o que diverge do cadastro vira pendência para alguém aplicar. Um dado errado na ficha vai para o contrato e para a petição; um campo vazio só atrasa.
- **Os dados do escritório são descartados por regra, sem lista fixa no código:** nome da advogada, CPF, e-mail e CEP que o próprio escritório escreveu, e arquivos enviados pelo escritório. Assim não é preciso pôr o CPF da Dra. no repositório.
- **Alternativa descartada:** manter a tela de sugestões com confirmação campo a campo, que já existia e ninguém usava. A Jessica quer automático.

### 16/10/2026 — Portão de qualidade: o que entrou e o que ficou de fora de propósito
**Entrou:**
- **CI antes do deploy:** tipos, lint, banco do zero, testes com banco, vulnerabilidades e ponta a ponta. Antes, o deploy publicava sem rodar nenhum teste.
- No primeiro dia o CI já achou três problemas reais: a função duplicada da dativa, o executor de migrations que não recriava o banco e dois testes errados que nunca tinham rodado.

**Rastreador de erros próprio em vez do Sentry:** os erros carregam contexto de clientes. Mandar para um serviço de fora seria tratamento de dado pessoal por terceiro (LGPD), e exigiria conta. O próprio CRM agrupa, mascara e avisa pelo canal que já existe (o do backup). Se um dia precisar de mais (desempenho, rastreio entre serviços), o Sentry pode entrar com a máscara já pronta.

**Lint só com erros de verdade:** ligar todas as regras geraria milhares de avisos de estilo e o lint seria ignorado. As regras que travam são as de bug: função ou variável duplicada, código inalcançável, chave repetida, atribuição em condição.

**Ficaram de fora de propósito:**
- **BDD (Gherkin):** o escritório é pequeno e os testes já descrevem a regra em português. O glossário (`GLOSSARY.md`) cumpre o papel de alinhar o vocabulário.
- **Pull Request obrigatório e proteção de branch:** só a Jessica e o Claude mexem no código. A revisão seria do próprio autor, e as contas logadas não podem mudar as configurações do repositório. O CI faz a parte automática da revisão.
- **OpenAPI/Swagger completo:** 460 rotas escritas à mão iam desatualizar. Em vez disso, `docs/api/rotas.md` é gerado do código e conferido no CI.
- **Atualizar `googleapis` e `node-cron` de versão principal** (5 vulnerabilidades moderadas na `uuid`): a falha só aparece num uso que o CRM não faz, e trocar as duas mexe no Google Agenda e em todas as rotinas. Fica para uma tarefa própria, com teste.

### 16/10/2026 — Qualificação em % por regra fixa, copiloto só para a Dra. e OAB/RJ como parâmetro
**Qualificação em %:**
- A IA só lê os sinais da conversa (situação de trabalho, salário, verbas, valor da causa, quem decide, pagamento preferido).
- A porcentagem sai de pesos fixos e testados. Assim dá para explicar à Dra. por que deu aquele número (lista de motivos) e ajustar os pesos depois.
- Alternativa descartada: pedir a % direto à IA, que daria um número sem explicação e diferente a cada vez.

**Copiloto:**
- Pedido da Jessica: um atendimento só, conduzido pela Dra. Por isso o Dr. Otávio nunca fala com o cliente. Ele sugere à Dra., em particular, e só quando ela (ou alguém da equipe) está na conversa.
- Quando a conversa é só da Lívia, a esteira normal segue.
- Uma sugestão por dia por conversa, para não virar ruído.

**OAB/RJ:**
- Parâmetro escolhido pela Jessica para as propostas. Fica acima do histórico e abaixo da tabela própria da Dra.
- O piso ético continua sendo o da OAB/ES (CED, art. 48, §6º), cuja tabela é em URH. Comparar com a OAB/ES fica para quando ela trouxer essa tabela.
- O pagamento (1/3 de entrada e 4x) é provisório até as regras de pagamento serem estudadas.

### 16/10/2026 — Negociação ética (Dr. Rafael) e análise de documentos por regras (Dra. Helena)
**Dr. Rafael:**
- As regras de resposta vêm do Código de Ética da OAB (arts. 7º, 9º e 48, §6º) e do Provimento 205/2021, e as técnicas de venda foram adaptadas a eles: acolher, entender o que está por trás, esclarecer e propor o próximo passo.
- Ficou de fora a pressão por urgência ou escassez, porque o Provimento proíbe.
- Pedido explícito da Jessica: dizer sempre que "o processo tem dia para começar, mas não tem dia para terminar".
- **Desconto nunca é do agente:** só a Dra. muda valores (o piso é a tabela da OAB/ES). O agente avisa a Dra., e ela usa o comando "ajustar" que já existia.
- Usa a mesma fila de rascunhos da Lívia (coluna `agente`), em vez de uma tela nova: um lugar só para aprovar.

**Dra. Helena:**
- **A IA só lê o documento.** As conferências (nome, CPF, empresa, datas, salário, FGTS, gestação, prescrição) são regras fixas e testadas. Assim, um ponto grave não depende de a IA "lembrar" de olhar.
- A IA entra num segundo olhar, sempre marcado "conferir".
- **Nunca acusa o cliente:** indício de alteração e divergência vão só para a Dra. Ao cliente sai apenas o pedido neutro de reenvio.

**Alternativa descartada:** um prompt único pedindo à IA para "achar inconsistências". Seria caro, sem garantia de cobertura e difícil de testar.

### 15/10/2026 — Atendente em modo rascunho e "sociedade" dos agentes ancorada no trabalho real
**Atendente (Dra. Lívia):**
- Começa em **modo rascunho**: nenhuma mensagem sai sem alguém da equipe enviar. A primeira semana serve para calibrar o tom.
- Depois de aprovado, o caminho para responder sozinha é trocar o envio do rascunho por envio direto, mantendo as travas de "promete resultado" e "fala de valores".
- **Ela para quando a equipe fala:** não entra se uma pessoa respondeu nas últimas 2 horas.
- **Tom de voz** aprendido só das mensagens escritas por pessoas: as dos agentes saem com "Agente" no `sent_by` e não entram no estudo, para ela não aprender com ela mesma. Dados pessoais são mascarados antes de ir à IA.

**Sociedade:**
- As conversas entre agentes saem de **modelos de frase preenchidos com os fatos da ação real**, sem IA. Assim não há como inventar caso ou número.
- A IA só escreve a **reunião diária**, a partir das ações e dos números do dia, com instrução explícita de não inventar.
- A "consciência" pedida é uma simulação: personalidade constante e memória persistente (`agente_memorias`), não consciência de verdade. Foi dito assim à Jessica.

**Alternativa descartada:** conversas livres geradas por IA a todo momento. Seria caro e com risco de inventar fatos sobre clientes.

### 14/10/2026 — Esteira comercial: valor de tabela pelo histórico e aprovação só da Dra.
**Valor de tabela:** o CRM não tinha tabela de honorários. A Dra. Bianca usa a tabela configurada (`office_settings.tabela_honorarios`) e, sem ela, a **mediana das propostas aceitas da área nos últimos 12 meses**: é a prática real do escritório, não um valor inventado. Sem histórico para a área, propõe só êxito (30% + sucumbência).
**Política de parcelamento:** ponto de partida provisório (sem entrada mínima, até 10 parcelas, parcela mínima de R$ 100) até a Dra. definir a dela em `office_settings.politica_parcelamento`. Como toda proposta passa pela aprovação dela, o provisório nunca chega ao cliente sem ser visto.
**Aprovação:** o comando "aprovar/ajustar/recusar" é reconhecido antes da IA do assistente e só vale vindo do número da Dra.
**Conflito de interesses:** checado em `case_partes` antes de propor (ideia do agente Legal Client Intake, do repositório agency-agents).
**Ao cliente:** só saem pedidos de dados e documentos e lembretes, como decidido na manhã de 14/10.

### 14/10/2026 — Laya volta para o CRM jurídico (revê a decisão de 23/09/2026)
**Decisão:** a Jessica pediu a Laya ("nossa assistente") no CRM jurídico, como já funciona no CRM comercial. A decisão de 23/09 ("não usar a Laya") fica revista.
**O que mudou desde 23/09:** a Laya já roda em produção no CRM comercial como serviço local (`systemone`, PM2 `laya`). O custo de ter mais um serviço deixou de ser hipotético, e o ganho medido lá é poupar chamadas de IA paga.
**Como entrou:** a Laya é perguntada primeiro, sem custo, na qualificação do possível cliente. Ela só decide sozinha com confiança de 0,75 ou mais nas três respostas (área, urgência e valor); senão a IA paga qualifica como antes. Sem `LAYA_URL`, nada muda.
**Pendente:** instalar o serviço na VPS do jurídico. Ver [Ferramentas e acessos](16-ferramentas-acessos.md).

### 14/10/2026 — Escritório virtual no próprio CRM, não com o ExpxAgents
**Decisão:** a sala dos agentes e as Métricas da IA são uma tela do CRM (`public/escritorio.js` e `/api/escritorio`). Os agentes são as rotinas automáticas e os serviços que já existem.
**Motivo:** o status de cada agente sai do que aconteceu de verdade (`job_runs`, `agente_acoes`, `automation_runs`), sem simulação. Uma ferramenta à parte não enxergaria esses dados.
**Status:**
- trabalhando: rodou com sucesso nos últimos 15 min;
- erro: a última execução falhou nas últimas 26h;
- parado: rodou nas últimas 26h;
- desligado: nada nas últimas 26h, ou agente ainda em construção.

### 14/10/2026 — Escritório virtual: 5 decisões da Dra. e o Leitor de sentença
**Decisões da Dra. (ela aprovou "tudo de acordo com a sugestão"; mapa em `docs/escritorio-virtual/`):**
1. **Ao cliente sem revisão da Dra.:** só status neutro e lembretes (documento, audiência, parcela). Conteúdo jurídico passa por ela.
2. **Jurisprudência:** começar só com fontes oficiais gratuitas (Pangea/BNP, Dados Abertos do STJ, portais dos tribunais, Planalto/LexML). Base paga fica para depois.
3. **Certificado digital no servidor:** não. Quem tivesse acesso ao servidor assinaria como ela. O protocolo continua sendo o toque dela, com o pacote pronto.
4. **Área-piloto dos especialistas:** trabalhista.
5. **Aviso de uso de IA no contrato:** `AVISO_USO_IA` em `contractTemplates.ts`, presente nos 4 contratos padrão (Recomendação 001/2024 do CFOAB).

**Leitor de sentença: o recurso e o prazo NÃO vêm da IA.** A IA só lê a decisão (resultado, ganhos e perdas, valor, sucumbência). O recurso cabível sai de uma tabela fixa: CLT 8 dias, Juizados 10 dias, CPC 15 dias e embargos 5 dias. O vencimento sai de `contarPrazo`.
**Motivo:** prazo errado é o pior erro possível, e uma tabela testada não alucina. O tipo (sentença ou acórdão) vem da leitura da IA, não do gatilho de palavras, porque uma sentença que cita um "acórdão" enganaria o gatilho.
**Alternativa descartada:** pedir o prazo à IA.
**Quando reconsiderar:** quando o calendário forense por tribunal existir (feriados municipais e portarias). Aí o vencimento passa a usá-lo.

### 24/09/2026 — `cases` e `legal_processes` continuam separados; overlap conhecido não é "consertado" por migration
**Decisão:** ao investigar o achado de prioridade baixa da auditoria do módulo Clientes ("resolver sobreposição de schema entre `cases` e `legal_processes`"), decidido **não fundir nem migrar as tabelas** — a separação já é proposital e já tem um FK de ligação (`legal_processes.case_id → cases.id`, migration 011). `cases` é o processo/caso do escritório (financeiro, fase, documentos, cliente); `legal_processes` é a camada de **monitoramento automático** (DataJud/DJEN: movimentações, sincronização, nº do processo no tribunal) — nem todo `legal_process` tem um `case` (descoberta automática por OAB antes de alguém confirmar o caso) e nem todo `case` tem monitoramento ligado (processo antigo, cadastrado manualmente, sem acompanhar).
**Risco real encontrado (não é o problema descrito originalmente):** o vínculo entre as duas nem sempre passa por `case_id` — em pelo menos 3 lugares (`src/routes/partner-portal.ts:160`, `src/routes/processes.ts:160`, `src/scripts/seed-partner-portal.ts:17`) o código faz um "ou" manual: `lp.case_id = c.id OR c.case_number = lp.process_number`, reimplementado de forma levemente diferente em cada arquivo. Isso é dívida técnica real (lógica de matching duplicada, nenhuma garantia de que os dois números continuem iguais se um for editado depois), mas trocar o schema pra resolver isso é uma refatoração de risco alto (FK em produção, múltiplas rotas dependentes) sem pedido explícito da usuária.
**Alternativa considerada:** migrar tudo pra uma tabela única, ou forçar sempre `case_id` preenchido — descartada por agora: exigiria migração de dado em produção e reescrever ~5 arquivos, por um ganho (eliminar duplicação de lógica de match) que não afeta a advogada no dia a dia hoje.
**Quando reconsiderar:** se aparecer um bug real de dessincronia (nº do processo editado num lado só, e o outro lado "perder" o vínculo), ou se a usuária pedir uma consolidação explícita — nesse caso, o caminho mais seguro é extrair o matching duplicado pra uma função única compartilhada primeiro, antes de mexer no schema.

### 23/09/2026 — Não usar o Laya (motor de decisão local) para triagem de WhatsApp/qualificação de lead
**Decisão:** pesquisado o projeto [Laya](https://github.com/NandhaKishorM/laya) (motor de classificação local, sem chamada de IA externa) para dois usos possíveis — qualificar lead automaticamente e separar "só cumprimento" de "relato de caso real" na primeira mensagem do WhatsApp — e decidido **não integrar**, mantendo os dois fluxos como estão hoje (Groq/Gemini via API).
**Motivo:** rodar o Laya de verdade não é só "chamar uma função nova" — exige instalar Python na VPS e manter um segundo serviço rodando o tempo todo (`laya-serve`), carregando um modelo de ~600MB-1,6GB em memória, porque os pesos publicados são só PyTorch (sem versão `.onnx` pronta que o Node pudesse carregar direto). Isso é infraestrutura nova (mais um processo pra monitorar, mais RAM ocupada na VPS, mais uma peça que pode quebrar) por um ganho pequeno: o benefício do Laya é velocidade bruta (~33ms contra as poucas centenas de milissegundos do Groq hoje), mas isso não é um problema real — ninguém espera esse tempo, é processamento em segundo plano. Some a isso o projeto ser recente e mantido por uma pessoa só (o próprio README admite que o empacotamento pra Node/TypeScript é "não testado").
**Alternativa considerada:** manter os dois fluxos como já funcionam (Groq pra triagem rápida, Gemini como reserva) — mantida, por já resolver o problema sem custo de manutenção adicional.
**Quando reconsiderar:** se o volume de mensagens/leads crescer o suficiente para o custo das chamadas de IA externas pesar de forma relevante no orçamento, ou se o Laya publicar pesos `.onnx` prontos (removendo a necessidade do serviço Python separado).

### 23/09/2026 — Reimportar peças do Obsidian pelo seletor de pasta do navegador, não por sincronização automática de arquivos
**Decisão:** o botão "Importar do Obsidian…" em Configurações usa `<input type="file" webkitdirectory>` — a Dra. Letícia escolhe a pasta manualmente cada vez, em vez de o CRM enxergar o cofre sozinho e sincronizar em segundo plano.
**Motivo:** o servidor do CRM roda na VPS Hostinger; o cofre Obsidian vive no computador dela. Não existe caminho de rede entre os dois sem um serviço de sincronização de arquivos (Dropbox/OneDrive/rclone) rodando nos dois lados — infraestrutura nova, ponto a mais pra quebrar, e ela teria que configurar e manter. O seletor de pasta resolve o mesmo problema (parar de depender de terminal/SSH) sem exigir nenhuma peça de infraestrutura nova: ela clica, escolhe a pasta de sempre, o navegador já dá acesso a todos os arquivos daquela pasta pro JavaScript ler.
**Alternativa considerada:** sincronizar o cofre via nuvem (Google Drive/Dropbox) e o servidor ler de lá periodicamente — descartada por agora por exigir montar um serviço de sincronização na VPS; fica como opção se algum dia o processo manual (escolher a pasta) incomodar.

### 22/09/2026 — Reconhecer parceiro por telefone (comparação direta), não por IA
**Decisão:** a etiqueta automática "Parceiro" numa conversa do WhatsApp vem de comparar o telefone de quem manda mensagem com a ficha de parceiros cadastrados — não de pedir pra uma IA "adivinhar" pelo conteúdo da mensagem.
**Motivo:** é uma pergunta de identidade (esse número é ou não é de um parceiro conhecido?), não de interpretação — comparação exata é 100% confiável, não custa chamada de IA, e não pode "errar" como uma classificação probabilística poderia. IA entra só onde a pergunta É de interpretação (separar cumprimento de relato de caso, numa mensagem de número desconhecido).
**Alternativa considerada:** pedir pra IA analisar a mensagem e decidir se "parece" ser de um parceiro — descartada por ser uma solução mais cara e menos confiável pra um problema que já tem resposta exata disponível (o telefone).

### 04/09/2026 — Documentação passa a ser mantida automaticamente, sem precisar pedir
**Decisão:** toda mudança de comportamento, correção de bug real ou troca de integração atualiza `docs/manual/` na mesma tarefa — virou regra do `CLAUDE.md`, não depende de a usuária lembrar de pedir.
**Motivo:** o mesmo dia já tinha mostrado o risco de "documentação/aviso que só existe se alguém lembrar" (ver entrada do Railway abaixo) — a usuária decidiu que o mesmo problema não podia se repetir com a documentação em si.

### 03/09/2026 — Railway desligado; VPS Hostinger é a única produção
**Decisão:** parar (`railway down`) e depois autorizar a exclusão do projeto Railway, que hospedava o sistema até 21/08/2026.
**Motivo:** a migração pra VPS já tinha acontecido, mas o Railway continuou de pé — seu trial expirou silenciosamente, bloqueando deploy novo sem aviso, e mesmo assim seus robôs internos continuaram rodando contra um banco separado, chegando a duplicar um aviso real (fechamento do dia enviado duas vezes).
**Alternativa considerada:** manter o Railway como "backup" — descartada, porque um ambiente parado que ninguém desliga de propósito é exatamente o que causou o problema.

### 03/09/2026 — GitHub Actions substitui o webhook automático do Railway
**Decisão:** deploy passou a ser um workflow explícito (`.github/workflows/deploy.yml`), visível na aba Actions do GitHub, em vez de um webhook automático de plataforma.
**Motivo (comentário original no arquivo):** "o webhook automático do Railway... quebrava com frequência, sem aviso — várias vezes um push ficava dias sem ir pro ar sem ninguém perceber." Com o workflow, dá pra ver se o deploy rodou e se falhou.
**Reforçado em 04/09/2026:** adicionada uma 3ª tentativa de deploy depois de um cluster de 3 falhas por instabilidade de rede na mesma noite — mesma filosofia (visibilidade e resiliência > confiar cegamente numa plataforma).

### 03/09/2026 — Aviso de marco processual: 1 por processo, para sempre (não por dia/semana)
**Decisão:** cada processo manda no máximo um aviso de WhatsApp de "Sentença publicada"/"Acórdão publicado" na vida inteira dele, não um limite por período de tempo.
**Motivo:** o problema era duplicidade do mesmo evento (fontes diferentes captando a mesma decisão), não excesso de eventos genuinamente diferentes. Um limite por processo+tipo resolve isso sem esconder um evento novo de verdade.
**Trade-off aceito:** no caso raro de duas sentenças reais no mesmo processo (ex.: anulação e nova sentença), a segunda não gera aviso automático — fica visível só na tela de Processos. Aceito porque é um caso raro e o custo de errar pro outro lado (spam) é maior.

### 03/09/2026 — Financeiro do Dativo é separado do financeiro normal do escritório
**Decisão:** pagamentos de demanda dativa (nomeação da Defensoria) vivem numa projeção financeira própria, não misturados com parcelas de cliente.
**Motivo:** o pagamento dativo vem do Estado, não do cliente — misturar os dois faria a projeção de caixa do escritório e a expectativa de recebimento do Estado parecerem a mesma coisa, quando têm prazos, confiabilidade e origem completamente diferentes.

### Data original não registrada — Correspondente jurídico e Repasses são módulos próprios, não "financeiro genérico"
**Decisão:** dinheiro de correspondente (Letícia atuando pra outro escritório) e de repasse (dinheiro saindo pra quem indicou/atuou) ficam em tabelas e telas dedicadas, não dentro do financeiro de cliente.
**Motivo (inferido do desenho do sistema, ver [Repasses e parcerias](09-repasses.md)):** evita contar duas vezes — dinheiro que passa pelo caixa mas não é honorário do escritório, ou honorário que já nasce comprometido com repasse.

### Data original não registrada — Documentos ficam no MEGA, não em disco do servidor
**Decisão:** todo documento do GED é armazenado numa conta MEGA externa, referenciada pelo CRM, nunca salvo localmente na VPS.
**Motivo (inferido):** desacopla o crescimento de armazenamento de documentos da capacidade de disco do servidor de aplicação, e mantém os arquivos recuperáveis independente do servidor estar de pé.

### 03/09/2026 — Uazapi é o único provedor de WhatsApp; skill "whatsapp" (Green API) descartada
**Decisão:** ao encontrar uma skill instalada chamada `whatsapp` (automação via Green API/WAHA), decidiu-se **não usar** — não é a integração que o CRM usa.
**Motivo:** o CRM já tem uma integração real e funcional com Uazapi, profundamente integrada (WhatsApp-instance, webhooks, health panel). Trocar ou adicionar um segundo provedor sem necessidade criaria confusão e risco, sem ganho.

### 29/09/2026 — Todo código novo ou refatorado segue a skill `codebase-design` (módulos profundos)
**Decisão:** instaladas as skills `codebase-design` e `setup-matt-pocock-skills` (github.com/mattpocock/skills). Toda criação ou reestruturação de código passa a seguir os princípios de módulo profundo: muito comportamento atrás de interface pequena, dependências externas (APIs, banco, envio de WhatsApp) injetadas, teste pela mesma interface que o sistema usa. Regra registrada no `CLAUDE.md` (seção "Agent skills"); configuração em `docs/agents/`.
**Motivo:** pedido da usuária ("vamos usar em tudo que der"). Arquivos grandes como `app.js`/`whatsapp.js` misturam responsabilidades; módulos profundos concentram mudança e bug num lugar só e se encaixam com o TDD já adotado.

### 08/10/2026 — Assistente do WhatsApp: a IA só interpreta, quem grava é o código, e sempre com "sim"
**Decisão:** o assistente pessoal (03-whatsapp) usa a IA só para **entender o pedido e ler documentos**, sempre em JSON validado por regras puras (`assistenteRegras.ts`). Gravar (contas a pagar, gastos, baixa) só acontece depois do **"sim"** de uma comandante. Baixa de comprovante de cliente **nunca é automática**: a decisão foi da Dra. Letícia, entre "confere e me pergunta" e "baixa sozinho se bater exato".
**Motivo:** a IA lê valor e data errados de vez em quando, e comprovante falso é golpe comum. Errar um lançamento custa caro, e confirmar custa uma palavra. Só a Dra. Letícia e a Jessica comandam (lista em `office_settings`). Qualquer outro número segue como cliente/lead.
**Alternativa considerada:** agente de IA com ferramentas que gravam direto (*function calling*). Foi descartada porque é mais difícil de testar e limitar, e um erro de interpretação viraria lançamento real.
**Revisão (08/10/2026, mesmo dia):** a Dra. Letícia pediu "só peça confirmação em lançamentos de financeiros, fora isso não precisa pedir". O "sim" ficou só para conta a pagar, gasto, pagar conta, recebimento e baixa.
- **Feitos direto:** agenda, lembrete, tarefa, cadastro e recado a cliente, com resposta detalhada do que foi feito.
- **Trade-off aceito por ela:** um recado mal interpretado vai direto ao cliente.
- **Cadastro:** continua sem duplicar, porque cada documento completa a ficha achada por CPF ou nome.

### 09/10/2026 — Assistente do WhatsApp interpreta pela OpenAI (Luna), Groq de reserva
**Decisão:** inverter a ordem só no assistente: OpenAI GPT-5.6 Luna primeiro, Groq JSON depois. Nas outras partes do CRM continua valendo Gemini/Groq como base gratuita.
**Motivo:** a conversa real de 08/10 teve respostas erradas vindas da Groq. No teste de 09/10, a Groq bateu no limite gratuito por minuto depois de 7 perguntas seguidas (o prompt tem cerca de 3 mil tokens), e o Gemini estava sem cota. A Luna acertou o caso que faltava. O custo fica em torno de US$ 0,0006 por mensagem.
**Alternativa considerada:** manter a Groq primeiro e só reduzir o prompt. Foi descartada porque o prompt longo, com exemplos, é justamente o que faz entender pedido escrito errado.

### 21/10/2026 — Acervo de leis num índice SQLite à parte, fora do MySQL e do backup
**Decisão:** o acervo (76 mil normas, 440 mil artigos) fica em `/home/crmapp/leis/acervo.db`, um SQLite com busca FTS5 (o `node:sqlite` embutido no Node, sem biblioteca nova). Não entra no MySQL nem no backup diário.
**Motivo:**
- o backup no MEGA já lota entre novembro e dezembro; meio GB a mais por cópia anteciparia isso;
- o acervo é público e se refaz do GitHub em minutos, então não precisa de backup;
- a busca sem acento, com ranking e trecho destacado, sai pronta no FTS5.
**Alternativas consideradas:**
- tabela FULLTEXT no MySQL: entraria no backup e a busca sem acento em português é pior;
- Meilisearch ou Elasticsearch: mais um serviço rodando na VPS.

### 28/10/2026 — Planilha de cálculos: critério padrão de atualização e .xlsx próprio
**Decisão:** a planilha da peça atualiza cada desconto com correção desde o desconto (Súmula 43/STJ) e juros de mora também desde o desconto (Súmula 54/STJ), em vez de deixar tudo para a liquidação. Até 08/2024: INPC + 1% a.m.; a partir de 09/2024: IPCA + taxa legal (Selic − IPCA, mínimo zero), pela Lei 14.905/2024. O valor da causa passa a usar a restituição atualizada. O .xlsx é gerado por um escritor próprio (`xlsxSimples.ts`, sobre o `jszip`, que já vinha com o `docx`).
**Motivo:**
- em desconto indevido sem contratação válida, a responsabilidade é extracontratual: juros desde o evento danoso é o pedido mais favorável e defensável. Valor nominal subestima a causa;
- a Lei 14.905/2024 mudou correção e juros a partir de 30/08/2024. Em base mensal, a virada fica em 09/2024;
- índice negativo aplicado sem reduzir o principal segue a orientação do STJ;
- índices oficiais do Bacen guardados no banco: a planilha não depende de a API estar no ar e mostra a fonte de cada mês.
**Alternativas consideradas:**
- juros desde a citação: menor e típico de relação contratual. Fica fácil de trocar se a Dra. preferir;
- biblioteca `exceljs`: pesada e com dependências antigas, um risco na auditoria de vulnerabilidades do CI. O que a planilha precisa (texto, número, fórmula, 8 estilos) cabe em 100 linhas.

### 21/10/2026 — A IA sugere a lei, mas só entra na peça o que existe no acervo
**Decisão:** a Dra. Júlia pede à IA os dispositivos do caso e confere cada um no índice; o que não existe ou foi revogado é descartado antes de chegar a quem redige. A Dra. Vera, separada do redator, confere as citações da peça pronta por regra (existe, vigente, artigo certo). A IA só opina se o texto oficial sustenta a afirmação, e esse resultado aparece como "a rever", sem bloquear nada.
**Motivo:** número de artigo ou súmula inventado pela IA é o erro mais grave numa peça. Com o texto oficial no prompt e a conferência depois, o erro deixa de passar em silêncio.
**Alternativa considerada:** deixar a IA citar livremente e só avisar no fim. Foi descartada porque a revisão humana pega menos erro quando a peça já vem "convincente".

### 21/10/2026 — Decretos federais só de 1988 em diante
**Decisão:** dos 84 mil decretos federais do repositório, o CRM baixa só os de 1988 em diante, mais os regulamentos consolidados (RPS e outros).
**Motivo:** as áreas do escritório (trabalhista, previdenciário, família e consumidor) quase nunca citam decreto anterior à Constituição. Os decretos-leis antigos que importam (CLT, CP, CPP, LINDB) estão em outra pasta, que vem inteira.

### 31/10/2026 — Documentos repetidos marcados, não apagados; introdução do card pelas regras
**Decisão:** o documento repetido do cliente fica **marcado** (`documents.duplicado_de`) e sai da tela, do kit e das leituras; nunca é apagado. "Mesmo arquivo" é o mesmo ID do Drive ou o mesmo md5 (conteúdo idêntico), em qualquer ação do cliente. O **nome** igual só conta dentro da própria ação. O arquivo que está em mais de uma ação passa a ser do cliente (`case_id` NULL). A introdução do card do cliente ("Sobre o caso") é montada pelas regras, sem IA.
**Motivo:** marcar dá para desfazer e não perde documento por engano de comparação. Nome igual em pastas de bancos diferentes pode ser arquivo diferente. A esteira, a análise e a Mesa já leem os documentos do cliente para todas as ações, então uma linha só basta, sem copiar o documento por ação. A introdução pelas regras é instantânea, não custa leitura e não inventa fatos.

### 31/10/2026 — "Sobre o caso" sai do que foi lido, nunca da descrição de uma ação
**Decisão:** a síntese do card do cliente é montada pelas regras a partir dos contratos do extrato de empréstimos (`cliente_contratos`), da ficha de fatos da leitura única (descontos, triagem, fatos, pedidos, lacunas), do relato do atendimento (lead) e da origem (parceria, data do e-mail). Não usa IA para escrever o texto e não usa a descrição das ações.
**Motivo:** a descrição de cada ação é gerada por banco a partir do e-mail do parceiro: mostrar uma delas descreve um pedaço do caso como se fosse o todo. Um resumo jurídico precisa de cada contrato com número, datas e parcela, e isso já está lido e guardado. Escrever pelas regras é instantâneo, não custa leitura e não inventa: o que não foi lido aparece como "ainda não lido".

## FAQ

**Uma decisão registrada aqui pode ser revertida?** Sim — decisões de produto não são imutáveis. Só não edite a entrada antiga: adicione uma nova, datada, explicando a mudança.

**Por que algumas entradas dizem "data original não registrada"?** Porque a decisão já existia no desenho do sistema antes deste log existir (criado em 04/09/2026) — o log não reescreve o passado que não presenciou, só marca honestamente o que é inferido do código versus o que foi observado ao vivo.

## Links relacionados
- [Onde tudo roda](13-infraestrutura.md)
- [Runbook](14-runbook.md)
- [Repasses e parcerias](09-repasses.md)
- [Dativo](05-dativo.md)

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 31/10/2026 | Claude | "Sobre o caso" pelo que foi lido, nunca pela descrição de uma ação |
| 31/10/2026 | Claude | Documentos repetidos marcados, não apagados; introdução do card do cliente pelas regras |
| 31/10/2026 | Claude | Tema 929 (tudo em dobro), Taxa Legal oficial do Bacen e Calculista na leitura (HISCON × HISCRE em código) |
| 30/10/2026 | Claude | Geração da peça registrada no banco e retomada depois de reinício (máx. 2 vezes) |
| 30/10/2026 | Claude | Trava da geração da peça em memória (processo único), com etapa para a barra de progresso |
| 30/10/2026 | Claude | Juros desde cada desconto confirmados pela Jessica (sempre atualizados, nunca desde a citação) |
| 28/10/2026 | Claude | Planilha de cálculos: correção e juros desde cada desconto (Lei 14.905/2024 a partir de 09/2024), índices do Bacen em cache, .xlsx próprio |
| 28/10/2026 | Claude | Contratos guardados por cliente; a Dra. associa cada um a um processo; regra automática conservadora (banco do réu + mesma tese) |
| 22/10/2026 | Claude | Processo único por banco e família de tese, sugerido pelo quadro e confirmado pela Dra. (substitui a junção automática) |
| 22/10/2026 | Claude | Mesa do caso: edição da Dra. vira versão nova; lição só vira regra com aprovação; HTML limpo em coluna própria |
| 22/10/2026 | Claude | Petição inicial pela esteira dos agentes: cálculo em código, peça conjunta por parte contrária, modelo pelo guia do cofre |
| 21/10/2026 | Claude | Acervo de leis em SQLite à parte; a IA sugere e o índice confere; decretos de 1988 em diante |
| 20/10/2026 | Claude | Automações antigas a cliente passam pela aprovação (o que muda no sistema continua automático) |
| 04/09/2026 | Claude | Criação do documento — 8 decisões registradas |
| 23/09/2026 | Claude | Registrada decisão de não integrar o Laya (motor de decisão local) — custo de infraestrutura (serviço Python separado na VPS) maior que o ganho (velocidade que ninguém sente) frente ao Groq/Gemini já em uso |
| 24/09/2026 | Claude | Registrada decisão de manter `cases` e `legal_processes` separados (achado de prioridade baixa da auditoria do módulo Clientes) — overlap já tem FK de ligação, risco real é lógica de matching duplicada em 3 arquivos, não a separação em si |
| 29/09/2026 | Claude | Registrada adoção da skill `codebase-design` (módulos profundos) para todo código novo/refatorado |
| 15/10/2026 | Claude | Atendente em modo rascunho e sociedade dos agentes ancorada no trabalho real |
| 14/10/2026 | Claude | Laya volta (revê 23/09) e escritório virtual dentro do CRM |
| 14/10/2026 | Claude | Registradas as 5 decisões do escritório virtual e por que o prazo de recurso do Leitor de sentença vem de tabela fixa, não da IA |
| 07/10/2026 | Claude | Backup tratado como crítico (pedido da usuária): retenção avô-pai-filho (3 dias inteiros + 30 diários + 12 mensais no MEGA, cabe na conta gratuita de 21 GB hoje), conferência do arquivo antes de salvar e de apagar antigos, aviso diário. Próximo passo avaliado: tirar as mídias do WhatsApp (~80% de cada cópia) de dentro do banco, guardando-as como arquivos com backup próprio — reduziria cada cópia de ~280 MB para ~60 MB e evitaria estourar o MEGA com o crescimento (~18 MB/dia) |
| 07/10/2026 | Claude | Provisão de honorários = valor da causa × taxa de sucesso × % médio obtido × honorário do caso (30% ou a parte do escritório na parceria). Escolhida por usar só dados que o CRM já tem e ser explicável na própria tela; dativo e defesa ficam fora porque não seguem a lógica de êxito |
| 30/10/2026 | Claude | Demonstrativo de descontos como documento gerado à parte, não recorte do extrato do INSS: um documento oficial recortado pode ser contestado pelo banco, e a Jessica confirmou que o extrato original vai inteiro no protocolo. O demonstrativo sai do mesmo cálculo da peça (CalculoPeca + contratos que entraram), para que demonstrativo, planilha e petição nunca divirjam. A lista "ficaram fora" só aparece na tela, para o PDF de protocolo não falar de outros bancos |
| 30/10/2026 | Claude | Card único do cliente sem tabela nova: cada ação continua sendo um caso (depois do protocolo cada uma tem nº e acompanhamento próprios) e o "lote" é calculado na hora a partir dos casos do cliente antes do protocolo. Descartado criar uma entidade de lote agora: mais migração e sincronização sem ganho para o uso atual. Se o cliente voltar com outra leva de ações enquanto a primeira está aberta, as duas aparecem juntas (aceitável hoje). O tipo do documento vem primeiro do texto lido e depois do nome do arquivo, porque os nomes que chegam enganam ("EXTRATO_DE_EMPRESTIMO" que é histórico de créditos) |
| 30/10/2026 | Claude | Painel de tarefas com o registro **na memória do servidor**, sem tabela nova: o CRM roda num só processo (PM2) e a tarefa só interessa enquanto a pessoa espera. O que precisa sobreviver a um reinício já tem registro próprio (a geração da peça, em `geracoes_peca_pendentes`); para as demais, a tela percebe que a tarefa sumiu e avisa "o sistema foi atualizado no meio, peça de novo". A tela consulta a cada 2,5 s só enquanto há tarefa rodando (20 s parada), em vez de abrir socket novo. O sino continua: o painel é para quem está esperando, o sino é o registro |
| 30/10/2026 | Claude | Leitura única guardada pelo **conteúdo** dos documentos, não por tempo nem por botão: a chave da ficha é o resumo (hash) dos textos dos documentos do cliente, então documento novo força nova leitura e nada fica velho. Conversa do WhatsApp e anotações ficam fora da chave (mudam toda hora e anulariam a economia), mas entram na leitura e na redação. "Ler os contratos" passou a usar a mesma ficha de fatos (o prompt só de contratos foi removido), para "ler contratos e depois gerar a peça" custar uma leitura. Sem tabela nova: a memória usa `documento_leituras`, que já guardava a transcrição dos arquivos. A redação continua por peça, com os documentos da própria ação: misturar relatos e anotações de outras ações na peça de um banco traria fatos que não são dela |
| 26/10/2026 | Claude | Iniciais = menor em segredo de justiça, sempre junto do representante (regra da Dra.). A ficha é do representante; iniciais nunca abrem ficha nem servem para achar uma, porque menores diferentes têm as mesmas iniciais. No dativo vale o primeiro nome completo; na captura do DJEN, só se houver exatamente um, para não criar ficha errada quando são dois adultos |
| 31/10/2026 | Claude | Junção à mão pode juntar teses diferentes do mesmo banco, nunca bancos diferentes (regra da Jessica). A sugestão automática continua só com a mesma tese; a regra fica numa função só (`conferirJuncao`) usada pela rota `/api/mesa/juntar`, e as teses do processo passam a ser a do título mais as dos pedidos unidos (`familiasDaAcao`) |

---
◀ [Ferramentas e acessos](16-ferramentas-acessos.md) · [Visão geral](00-visao-geral.md) · Próximo: [Pesquisa de Leis](18-pesquisa-de-leis.md) ▶
