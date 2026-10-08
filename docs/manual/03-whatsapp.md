# 03 · WhatsApp

**Área:** Atendimento e captação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

O número real do escritório (via Uazapi) integrado direto no CRM, em duas visões (lista de 3 painéis ou Kanban), com painel de saúde da conexão e um monte de avisos automáticos de outros módulos passando por aqui.

## Contexto

Consulte pra entender a estrutura das telas de conversa, o que o painel de saúde mostra, ou de onde vem uma mensagem automática específica (pro escritório ou pro cliente/lead).

## Tela larga, sem precisar abrir tela cheia

Toda página do CRM (tabelas, formulários) fica limitada a 1200px de largura — bom pra leitura, ruim pra uma tela de chat de 3 colunas, que sobrava espaço perdido nas laterais em monitor largo mesmo sem estar pequena de verdade. Desde 22/09/2026, só a tela do WhatsApp usa a largura livre da janela (não precisa mais abrir a aba de tela cheia só para "ganhar espaço" — ela continua existindo pra quando quiser esconder o menu lateral também).

## Duas visões da mesma conversa

- **Lista (3 painéis)** — visão padrão. Painel 1: lista de conversas com abas (Todas / Não lidas / Em atendimento / Finalizadas), busca por nome/telefone/assunto, filtro por responsável e por etiqueta. Painel 2: a conversa aberta (histórico, anexos, áudio, respostas prontas). Painel 3: ficha do contato — identificação, processo vinculado, financeiro, etiquetas editáveis, notas internas da equipe, botões de "Abrir cadastro"/"Criar tarefa"/"Vincular processo".
- **Quadro (Kanban)** — mesmas conversas organizadas em colunas por etapa de atendimento (etapas configuráveis), pra quem prefere visão de funil em vez de lista.

Um botão no topo alterna entre as duas visões sem perder a conversa aberta.

## Abrir em tela cheia

O ícone de WhatsApp na barra superior sempre abre a central em **aba nova, em tela cheia**, sem tirar você da tela onde você estava.

## Foco na conversa / minimizar

A barra de busca/filtros pode ser minimizada, e existe um modo "foco na conversa" que esconde a lista lateral pra sobrar mais espaço só pro histórico de mensagens — as duas preferências ficam salvas e não voltam a mudar sozinhas a cada clique.

## Notas internas e etiquetas

Notas internas (visíveis só pra equipe, nunca pro cliente) e etiquetas de conversa (setor, prioridade, o que for) ficam editáveis direto no painel 3, sem precisar abrir um menu separado.

## Conversa sobre qual processo (desde 30/09/2026)

Cliente com 2+ processos: no bloco **Processo** da ficha aparece *Esta conversa é sobre*. Escolher é opcional; o processo escolhido passa a ser o destacado na ficha (nº, etapa, audiência) e é usado como caso da tarefa criada quando o cliente menciona intimação. Salvo em `whatsapp_chat_meta.case_id`; só aceita processo do próprio cliente do número.

## Organizar números sem cadastro (desde 02/10/2026)

Botão **Organizar sem cadastro** no topo da Central de Atendimento. Lista os números com conversa nos últimos 30 dias que não são lead nem cliente e ainda estão em "Novo contato" (58 em 02/10/2026). **Sugerir com IA** lê as últimas 12 mensagens de cada um (Groq, modo JSON) e propõe: Lead, Pessoal, Parceiro, Parte contrária, Serviço/notificação ou "deixar como está" — com o motivo. Você ajusta e clica **Aplicar**: lead vira cadastro no funil (origem WhatsApp, etapa Triagem); os demais vão para a etapa do quadro (Pessoal, Parceiros, Parte contraria, Arquivado). A sugestão fica guardada em `whatsapp_chat_meta.triagem_*`. Regras em `src/services/triagemSemCadastro.ts` (testadas).

## Gerar proposta de quem ainda não é lead (desde 01/10/2026)

**Gerar proposta** na ficha da conversa funciona mesmo quando o número ainda não é lead: o sistema cadastra o lead na hora (origem WhatsApp), lê as últimas mensagens escritas pelo contato e preenche nome completo, CPF, e-mail e endereço que estiverem lá (sem inventar), e abre o formulário de proposta já preenchido para conferir. Se o número já for lead, usa o existente; se já for cliente, o botão fica desativado (proposta pela ficha do cliente). Rota `POST /api/whatsapp-instance/chats/:phone/lead-para-proposta`.

## Enviar proposta pela conversa e "analisando proposta" (desde 01/10/2026)

- **Enviar proposta** (ficha da conversa): busca a proposta mais recente deste contato (pelo telefone da proposta ou do lead; ignora recusadas/expiradas), mostra título, valor, status e se o cliente já abriu o link, e traz uma mensagem pronta com o link público — editável, mas o link precisa ficar. Ao enviar: a proposta vira *Enviada* (começa o follow-up 48h/5d/7d) e o lead vai para *Proposta Enviada* se ainda estava antes disso.
- **Bolinha verde piscando**: aparece no card do **quadro (Kanban)** — "Analisando proposta · abriu o link" ou "Proposta enviada · ainda não abriu" — e ao lado do nome na lista de conversas e como selo "Analisando proposta" na ficha enquanto a proposta estiver *Enviada* ou *Em negociação*. O selo diz quando o cliente abriu o link pela última vez, ou "ainda não abriu o link". Sai sozinha quando a proposta é aceita, recusada ou expira.
- **Monitoramento do link (desde 01/10/2026):** cada abertura do link vira uma visita (`proposta_visitas`). Enquanto a página está aberta e visível, ela manda um sinal a cada 15s com o tempo e até onde a pessoa rolou; ao sair/trocar de aba manda o último. O servidor nunca credita mais tempo que o realmente decorrido desde o sinal anterior. Não guarda IP nem localização — só tempo, % lido e tipo de aparelho (celular/tablet/computador).
- Na ficha, abaixo do selo verde: "N aberturas · X lendo · leu até o fim / leu Y%" — clique para ver tempo total, maior leitura, primeira/última abertura e a lista das últimas 10 visitas. O mesmo resumo aparece na janela *Enviar proposta*.
- **Aviso no sino** a cada abertura: "👀 Fulana abriu a proposta" / "reabriu a proposta (3ª vez)".
- "Ver a proposta como o cliente vê" abre com `&preview=1` — a sua visualização não conta como visita.
- `propostas.visualizada_em` / `ultima_visualizacao_em` passam a ser marcadas só por visita real (antes qualquer abertura, inclusive da equipe, contava).

## Ler dados dos documentos recebidos (desde 30/09/2026)

Botão **Ler dados dos documentos** na ficha da conversa (precisa ser lead ou cliente). A IA (Gemini visão) lê até 6 fotos/PDFs mais recentes do contato (RG, CNH, CTPS, comprovante…) e abre a tela **Conferir dados lidos**:

- cada campo mostra o valor atual do cadastro, o lido no documento (editável) e de qual arquivo veio;
- **amarelo** = leitura incerta, documentos com valores diferentes (mostra o outro valor) ou CPF que não passa no dígito verificador;
- vêm marcados só os campos confiáveis que estão vazios no cadastro; **nada é gravado sem clicar em "Gravar campos marcados"**.

Destino: lead (nome, CPF, RG, nascimento, CEP, rua, número, bairro, cidade, UF) ou cliente (nome, CPF, nascimento e endereço numa linha só). Como o lead convertido em cliente já leva esses dados para proposta e contrato, o dado é digitado uma vez só. Regras em `src/services/extracaoDocumentos.ts` (testadas).

## Cliente mencionou intimação (desde 30/09/2026)

Quando um **cliente** (número já cadastrado) escreve algo como "recebi uma intimação", "fui citado", "o oficial de justiça passou aqui", "chegou uma carta do fórum", o sistema cria uma **tarefa crítica** com o trecho da mensagem e um rascunho de resposta, e avisa no sino com som. Nada é enviado ao cliente automaticamente — o rascunho deixa claro que não é a confirmação oficial do prazo. No máximo um aviso a cada 12h por número. Regras em `src/services/whatsappIntimacao.ts`.

## Quem acessa as conversas (desde 30/09/2026)

Só a equipe interna: `admin`, `advogado`, `estagiario`, `staff`, `comercial`. O perfil `parceiro` (advogado externo) não acessa mais a tela nem a API de WhatsApp — conversa de cliente é dado pessoal (LGPD).

## Mídia que falhou ao baixar

Quando uma foto/áudio/documento recebido não consegue ser baixado da Uazapi, a conversa mostra "⚠️ Mídia recebida, mas falhou ao baixar" e os admins recebem aviso no sino. Desde 25/09/2026, esse aviso tem o botão **"Tentar baixar de novo"**: refaz o download pelo identificador que já ficou guardado, sem precisar pedir reenvio ao cliente. Além disso, desde 28/09/2026 o sistema tenta 3 vezes antes de desistir, mostra o motivo real no aviso do sino e refaz sozinho, a cada 10 minutos, o download das mídias que falharam nas últimas 48h. Se o arquivo já expirou do lado do WhatsApp, o botão avisa e a saída é pedir pro remetente mandar de novo.

## Áudios e arquivos que VOCÊ envia pelo celular

Desde 28/09/2026, foto, áudio, vídeo ou documento que você manda **pelo celular** (fora do CRM) também aparece na conversa do cliente, com o player de áudio e a transcrição. Antes só entrava a mídia que o cliente mandava (e a que você enviava pelo próprio CRM) — a que saía do celular era descartada por não ter texto. O que você envia pelo CRM continua igual (não é baixado duas vezes). Mídia enviada por você **não** vira "documento recebido" na ficha do cliente. Se o download falhar, aparece "⚠️ Mídia enviada por você, mas falhou ao baixar" com o botão "Tentar baixar de novo" (e a recuperação automática a cada 10 minutos). Mídia que você enviou **antes** dessa data não é recuperada.

## Painel de Saúde do WhatsApp

Dentro do menu de auditoria da tela: status da conexão em tempo real, hora da última mensagem recebida, e contagem de falhas (envio, mídia, transcrição/descrição por IA, erro de webhook e queda de conexão) nos últimos 7 e 30 dias, com a lista das notificações mais recentes. É um painel de diagnóstico — os números são "pelo menos N" (o sistema evita alertar demais pra mesma falha, no máximo 1 aviso a cada 30min por tipo), não uma contagem perfeita.

Desde 22/09/2026, uma rotina roda a cada 20 minutos só pra checar se a conexão caiu (`whatsapp:verificar-conexao`, ver [Monitoramento automático](10-monitoramento.md)) — antes, uma queda no meio do dia só era percebida abrindo esta tela ou tentando enviar algo.

## Respostas prontas — uma lista só

Até 22/09/2026 existiam dois sistemas de "mensagem pronta" que não se falavam: a lista real que aparece no menu ⚡ e no atalho `/` (sincronizada com a Uazapi/WhatsApp Business), e uma tabela própria do CRM que nunca teve tela nenhuma — só dava pra usar chamando a API diretamente. Os 4 conteúdos úteis que só existiam lá (procuração, aviso de audiência, confirmação de reunião, pedido de documentos de pensão) foram migrados pra lista real como `/procuracao`, `/audiencia`, `/reuniao` e `/pensaodocumentos`; a tabela antiga foi removida.

## Atalho de resposta pronta na composição

Desde 22/09/2026, digitar `/` seguido do começo do atalho (ex.: `/doc`) direto na caixa de mensagem já sugere as respostas prontas que batem — não precisa mais abrir o menu ⚡ toda vez. Setas para navegar, Enter ou Tab para escolher, Esc para fechar. `/` só dispara no início da mensagem ou logo depois de um espaço (uma URL como `http://...` não aciona por engano).

## Fila de envio automático tem prioridade

A fila (cobrança + lembrete de audiência, `whatsapp:fila`) respeita um teto de 30 mensagens/dia contra bloqueio do número. Desde 22/09/2026, dentro desse teto, lembrete de audiência sai antes de mensagem avulsa, que sai antes de cobrança de rotina — antes era só ordem de chegada (FIFO), e um lembrete de audiência de amanhã podia ficar preso atrás de várias cobranças do dia.

## Triagem automática de conversa nova

Desde 22/09/2026, uma mensagem de número desconhecido passa por duas checagens antes de virar aviso de "possível lead":

1. **É parceiro/correspondente?** — comparação direta pelo telefone (sem IA, mais confiável) contra a ficha de parceiros. Se bater, a conversa ganha a etiqueta **"Parceiro"** automaticamente (mesmo campo de etiquetas que já existia — filtre por ela nos filtros da lista) e não entra na triagem de lead. Só funciona se o parceiro tiver telefone cadastrado — edite a ficha dele em Parcerias pra adicionar.
2. **Se não é parceiro nem cliente**, a IA classifica a primeira mensagem em três grupos: relato de caso real (já existia — vira possível lead, avisa no sino), **só cumprimento** ("bom dia", "oi", sem contar nada — novo: aparece um cartão dentro da própria conversa sugerindo responder, com um botão "Enviar saudação"; nunca manda sozinho, só sugere), ou sem certeza (comportamento de sempre, sem tentar adivinhar). A sugestão de saudação some assim que qualquer mensagem for enviada pra aquele número, por qualquer via.

## Painel de Desempenho

Dentro do menu de auditoria da tela (**Auditoria → Desempenho**): tempo médio de resposta do atendimento (mensagem recebida → primeira resposta nossa, em até 24h — calculado sobre os últimos 30 dias) e um gráfico de mensagens recebidas x enviadas por dia, nos últimos 14 dias. É atendimento geral de qualquer conversa — diferente do cronômetro de 1ª resposta do funil de Leads (que só mede lead comercial novo, ver [Leads e comercial](02-leads.md)).

## Quem está respondendo agora

Desde 23/09/2026, se mais de uma pessoa da equipe tiver a mesma conversa aberta, quem começar a digitar uma resposta avisa a outra pessoa em tempo real: aparece "Fulana está respondendo esta conversa…" acima da caixa de mensagem. É só um aviso — não trava a conversa, e cada pessoa continua podendo enviar. O aviso some sozinho depois de alguns segundos sem digitação, e nunca chega ao WhatsApp do cliente (é só entre a equipe, pelo mesmo canal de tempo real já usado pra mensagem nova).

## Risco de bloqueio do número

Desde 23/09/2026, quando a Uazapi sinaliza risco de bloqueio de envio (erro HTTP 463 — o código que ela usa pra avisar restrição, não um erro comum), o escritório recebe um aviso próprio no sino: **"🚨 Risco de bloqueio do número do WhatsApp"**, separado dos avisos de falha comum de envio. Antes, esse tipo de erro só virava a mesma mensagem genérica de "falha ao enviar" — sem destacar que o risco ali é o número inteiro ser banido pelo WhatsApp, não só aquela mensagem não ter saído. O Painel de Saúde (menu de auditoria da tela) também mostra essa contagem separada, com destaque em vermelho quando houver ocorrência nos últimos 7 dias.

**Importante:** isso é um aviso, não uma proteção automática — a integração usa um número comum via Uazapi (não a API oficial da Meta com mensagem-modelo pré-aprovada), então a única forma de reduzir o risco de verdade é diminuir o volume de envio automático quando o aviso aparecer.

## Log de acesso LGPD

Desde 23/09/2026, abrir uma conversa (`GET /chats/:telefone`, a que carrega o histórico de mensagens) registra o acesso — mesmo mecanismo já usado na ficha de cliente (quem acessou, quando, IP), consultável em **Configurações → Log de acesso a dados pessoais (LGPD)**. Antes disso, abrir a ficha de um cliente ficava registrado, mas abrir a conversa de WhatsApp desse mesmo cliente — que pode ter CPF, endereço, relato de caso — não gerava nenhum rastro.

## Avisos automáticos que chegam por aqui

Vários módulos usam o mesmo canal de WhatsApp pra avisar o escritório: nomeação dativa detectada, sentença/acórdão publicado, movimentação encontrada por e-mail fora do DJEN, falha de conexão/envio. Ver [Monitoramento automático](10-monitoramento.md) para o detalhe de cada um.

## Auto-envios para o cliente/lead

Alguns eventos disparam mensagem automática pro **contato** (não pro escritório): confirmação/recusa de newsletter, aceite de proposta, follow-up de proposta (5 dias e 48h antes de expirar), despedida ao perder um lead (ver [Leads](02-leads.md)).

## FAQ

**Preciso ter o WhatsApp aberto no celular pra funcionar?** Não — a conexão é com o número real via Uazapi, roda no servidor. O painel de Saúde mostra se essa conexão está ativa.

**Dá pra saber se uma mensagem falhou ao enviar?** Sim, pelo painel de Saúde — mas os contadores de falha são "pelo menos N" (throttle contra alerta repetido), não uma contagem perfeita.

**As etapas do Kanban de WhatsApp são as mesmas do funil de Leads?** Não — são etapas de atendimento configuráveis, independentes das etapas do funil comercial.

## Links relacionados
- [Leads e comercial](02-leads.md) — origem de vários auto-envios
- [Monitoramento automático](10-monitoramento.md) — avisos que chegam por aqui
- [Processos e prazos](04-processos.md) — avisos de marco processual

## "Gerar proposta" lê os dados da conversa (desde 07/10/2026)

Ao clicar **Gerar proposta** na conversa, o CRM sempre lê o que o contato escreveu (as últimas 30 mensagens dele):
- **ainda não é lead** → cadastra o lead com esses dados;
- **já é lead** (qualquer etapa) → completa só os campos vazios do lead: CPF, e-mail, CEP, rua, número, bairro, cidade, UF, estado civil, profissão. O que já está na ficha nunca é trocado; se a conversa traz um CPF, e-mail, número ou CEP diferente, aparece o aviso "Confira: … na ficha X, na conversa Y".

A leitura tem duas camadas (`src/services/dadosPropostaConversa.ts`, testes em `tests/dadosPropostaConversa.test.mjs`): primeiro os dados rotulados ou inconfundíveis ("Nome completo:", "CPF:", e-mail, CEP), que não dependem de IA; depois a IA completa o resto. O que veio rotulado vence a IA.

## Assistente pessoal do CRM pelo WhatsApp (desde 08/10/2026)

Pedido: "fazer do meu WhatsApp um assistente pessoal do CRM". A Dra. Letícia, do **(44) 99101-1402**, e a Jessica, do **(27) 98879-8093**, mandam mensagem para o número do escritório **(27) 99515-1402** como numa conversa normal: texto, áudio ou foto/PDF. O CRM responde como assistente. A lista de números fica em `office_settings.assistente_whatsapp_numeros` (padrão em `COMANDANTES_PADRAO`). O número é reconhecido com ou sem o 9º dígito. Mensagens desses números **não** entram no fluxo de cliente/lead.

**O que ele faz.** Desde 08/10/2026 ele cobre todas as ações abaixo ("pode colocar todos"):

| Tipo | Pedido (exemplos) | O que acontece |
|---|---|---|
| Consulta | "Qual o processo da Mailza?" ou um nº de processo | Cliente, nº (padrão CNJ), tribunal, área e fase. Cliente sem processo: ele diz isso. |
| Consulta | "O que aconteceu no processo do José Lourenço?" | Últimas 5 movimentações de cada processo (resumo da IA, se houver). |
| Consulta | "Me passa o telefone/CPF/endereço da Mailza" | Dados da ficha. **Nunca** a senha do INSS. |
| Consulta | "Me manda a procuração da Mailza" | Envia o **arquivo** do CRM ali na conversa. Se não achar, lista os que existem. |
| Consulta | "Agenda de amanhã", "prazos da semana" | Agenda: compromissos, audiências, prazos e tarefas, sem repetidos. Prazos: só os pendentes do período. |
| Consulta | "Quanto tenho a receber este mês?", "quem está em atraso?" | A receber no período (**só a sua parte**, já sem a da parceira) e lista de vencidos. |
| Consulta | "Quais contas vencem esta semana?" | Contas a pagar previstas, as vencidas e os repasses do período. |
| Grava | Foto/PDF de boleto ou "boleto de luz 312,40 vence dia 15" | **Contas a Pagar** (saída prevista). |
| Grava | "Gastei 38,50 de Uber pro fórum" | **Gasto já pago** (saída realizada). |
| Grava | "Paguei a conta de luz" | Acha a conta em aberto (mesmo escrita errada) e marca como paga. |
| Grava | "Recebi 500 da Fulana em dinheiro" | Se bate com parcela em aberto da cliente, **dá baixa** nela. Senão, registra como "Recebi um pagamento". |
| Grava | "Marca reunião com a Mailza sexta 14h" | Cria na agenda **e no Google Agenda**, ligada à cliente. Recusa horário que já passou. |
| Grava | "Me lembra amanhã 9h de ligar pro perito" | Na hora marcada, manda "⏰ Lembrete" para **quem pediu**. |
| Grava | "Cria tarefa: protocolar a réplica da Rachel até dia 15" | Tarefa com prazo, prioridade e cliente. |
| Grava | Foto de RG/CNH + "cadastra essa cliente" | Lê os dados. Fotos mandadas em sequência completam a **mesma** ficha. Se a cliente já existe (CPF ou mesmo nome), **completa sem duplicar**. As fotos vão para Documentos pessoais. |
| Envia | "Avisa a Mailza que a audiência é dia 10 às 14h" | Escreve a mensagem, mostra o texto exato e só envia depois do "sim". |

**Escrita errada.** O pedido pode vir com erro de digitação, abreviação, sem acento ou por áudio. A IA é instruída a interpretar pela intenção e recebe as **últimas mensagens da conversa**, então entende "e o telefone dela?". Nomes de cliente, contas e documentos são achados por **semelhança** (`src/services/assistenteBusca.ts`). Exemplos: "Mailsa" acha Mailza, "raquel" acha Rachel, "jose lorenço" acha José Lourenço, "procurassão" acha a procuração. Se o nome servir para mais de um cliente, ele **pergunta qual** e não chuta. As confirmações também aceitam "sin", "ss", "pode sim", "nn", "naum".

Se der algum erro no meio do pedido, ele avisa "Deu um erro aqui…" em vez de ficar calado.

**Confirmação obrigatória.** Nada é gravado nem enviado sem um **"sim"**. O assistente mostra exatamente o que vai fazer. Depois dele:
- **"sim"** lança;
- **"não"** cancela;
- **uma correção** ("é pessoal", "o valor é 300", "muda pra 15h") refaz a proposta;
- **com 2 ou mais itens aguardando**, ele lista os itens e pede "sim 1", "sim 2"…

Pendências expiram em 48 h (tabela `assistente_pendencias`, migration 153). Um "sim" só confirma pendências do próprio número.

**Comprovante de cliente.** Quando um **cliente** manda foto ou PDF, o assistente segue estes passos:
1. Se o cliente **tem algo em aberto** no A Receber, a IA lê a imagem. Se não tiver nada em aberto, a IA nem é chamada.
2. Se for comprovante, ele confere **para quem foi pago** e procura a parcela em aberto **de mesmo valor**. Entre várias, escolhe a de vencimento mais próximo da data do pagamento.
3. Ele manda às **duas** comandantes: "Comprovante de Fulana, R$ X · bate com: 1/5 Honorários · Dar baixa? sim/não".
4. Se o PIX foi para outra pessoa, o alerta aparece em destaque: ❌ ATENÇÃO.
5. O primeiro "sim" dá a baixa e fecha a pergunta da outra.
6. Se nenhuma parcela tiver o mesmo valor, ele só avisa e lista o que está em aberto. Nunca dá baixa sozinho.

**Como funciona por dentro**
- **Regras puras:** `src/services/assistenteRegras.ts`, com testes em `tests/assistenteRegras.test.mjs`.
- **Orquestrador:** `src/services/assistenteWhatsapp.ts`, com testes em `tests/assistenteWhatsapp.test.mjs`. Banco, IA e envio são injetados.
- **Peças reais:** `src/services/assistenteWhatsappMysql.ts`.
- **Entrada:** `assistenteNoWebhook`, chamado no webhook da Uazapi.
- **IA:** o pedido é interpretado pela Groq em modo JSON, com reserva na OpenAI. Boleto e comprovante são lidos pelo Gemini, com reserva na OpenAI com visão (`aiLerArquivo`). Áudio é transcrito pelo Whisper da Groq.
- **Mesmas regras das telas:** baixa (`baixaAReceber.ts`), "Recebi um pagamento" (`recebimentoCliente.ts`), compromisso com Google Agenda (`agendaEventos.ts`) e A Receber (`aReceberMontar.ts`).
- **Gravações:** ficam no nome da advogada com Google conectado (`office_settings.assistente_usuario_id` troca isso).
- **Lembretes:** ficam em `assistente_lembretes` (migration 154). O cron `assistente:lembretes` roda a cada minuto.
- **Testes:** `tests/assistenteAcoes.test.mjs`, `tests/assistenteBusca.test.mjs` e `tests/assistenteWhatsappAcoes.test.mjs`.

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 08/10/2026 | Claude | Assistente: todas as ações (andamento, dados e documentos do cliente, prazos, a receber, contas a vencer, pagar conta, recebimento, compromisso, lembrete, tarefa, cadastro, mensagem a cliente) e busca tolerante a erro de digitação |
| 08/10/2026 | Claude | Assistente pessoal do CRM pelo WhatsApp: contas a pagar, gastos, consulta de processo e agenda, conferência de comprovante de cliente com baixa após "sim" |
| 07/10/2026 | Claude | Lembrete de audiência ao cliente: trava por cliente + horário + marco (antes era por compromisso da agenda, e cópias da mesma audiência geravam 2 mensagens) |
| 07/10/2026 | Claude | "Gerar proposta" passa a ler os dados da conversa também quando o contato já é lead (completa só o que está vazio, avisa divergências) e lê dados rotulados sem IA |
| 02/10/2026 | Claude | Organizar números sem cadastro (triagem em lote com IA) |
| 02/10/2026 | Claude | Alerta de proposta em análise também no quadro (Kanban) |
| 01/10/2026 | Claude | Monitoramento do link da proposta: tempo de leitura, reaberturas, % lido, aparelho e aviso no sino a cada abertura |
| 01/10/2026 | Claude | Botão Enviar proposta com link e texto pronto; bolinha verde "analisando proposta"; registro de quando o cliente abre o link |
| 01/10/2026 | Claude | Gerar proposta cadastra o lead na hora com os dados da conversa (relato real) |
| 30/09/2026 | Claude | Ler dados dos documentos recebidos com tela de conferência antes de gravar |
| 30/09/2026 | Claude | Conversa vinculada a um processo, aviso de intimação mencionada pelo cliente e WhatsApp fechado para o perfil parceiro |
| 03/09/2026 | Claude | Criação do documento |
| 22/09/2026 | Claude | Fila de envio com prioridade (audiência > avulsa > cobrança); watchdog de conexão a cada 20min; Painel de Saúde ganha falhas de transcrição/webhook/conexão; atalho "/" na composição pra resposta pronta; tabela órfã `whatsapp_templates` removida (4 conteúdos úteis migrados pra lista real); tela do WhatsApp deixa de ter teto de 1200px de largura (achados da auditoria de fluxos) |
| 22/09/2026 | Claude | Triagem automática de conversa nova: parceiro reconhecido por telefone (etiqueta automática) e IA passa a distinguir "só cumprimento" (sugere resposta, nunca envia sozinha) de relato de caso real |
| 23/09/2026 | Claude | Abrir uma conversa passa a gerar log de acesso LGPD (achado da auditoria de melhorias do módulo) — antes só a ficha de cliente era registrada |
| 23/09/2026 | Claude | Aviso próprio (🚨) quando a Uazapi sinaliza risco de bloqueio do número (HTTP 463) — antes virava a mesma mensagem genérica de falha de envio, sem destacar o risco de banimento |
| 23/09/2026 | Claude | Aviso ao vivo de "Fulana está respondendo esta conversa" entre a equipe — antes duas pessoas podiam responder o mesmo cliente ao mesmo tempo sem saber |
| 28/09/2026 | Claude | Mídia enviada pelo celular (fromMe) passa a ser baixada e mostrada na conversa — antes só a mídia recebida entrava |
| 28/09/2026 | Claude | Download de mídia com 3 tentativas, fallback por fileURL, motivo no aviso e recuperação automática a cada 10 min |
| 25/09/2026 | Claude | Botão "Tentar baixar de novo" nas mídias que falharam ao baixar (`POST /api/whatsapp-instance/messages/:id/reprocessar-midia`) |
| 23/09/2026 | Claude | Painel de Desempenho (Auditoria → Desempenho): tempo médio de resposta do atendimento geral + gráfico de mensagens por dia — pedido direto da Dra. Letícia |

---
◀ [Leads](02-leads.md) · [Visão geral](00-visao-geral.md) · Próximo: [Processos e prazos](04-processos.md) ▶
