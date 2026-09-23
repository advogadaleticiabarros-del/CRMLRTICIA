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

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |
| 22/09/2026 | Claude | Fila de envio com prioridade (audiência > avulsa > cobrança); watchdog de conexão a cada 20min; Painel de Saúde ganha falhas de transcrição/webhook/conexão; atalho "/" na composição pra resposta pronta; tabela órfã `whatsapp_templates` removida (4 conteúdos úteis migrados pra lista real); tela do WhatsApp deixa de ter teto de 1200px de largura (achados da auditoria de fluxos) |
| 22/09/2026 | Claude | Triagem automática de conversa nova: parceiro reconhecido por telefone (etiqueta automática) e IA passa a distinguir "só cumprimento" (sugere resposta, nunca envia sozinha) de relato de caso real |
| 23/09/2026 | Claude | Abrir uma conversa passa a gerar log de acesso LGPD (achado da auditoria de melhorias do módulo) — antes só a ficha de cliente era registrada |
| 23/09/2026 | Claude | Aviso próprio (🚨) quando a Uazapi sinaliza risco de bloqueio do número (HTTP 463) — antes virava a mesma mensagem genérica de falha de envio, sem destacar o risco de banimento |

---
◀ [Leads](02-leads.md) · [Visão geral](00-visao-geral.md) · Próximo: [Processos e prazos](04-processos.md) ▶
