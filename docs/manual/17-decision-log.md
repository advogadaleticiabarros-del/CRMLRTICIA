# 17 · Decision Log

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte, commits e conversas) · **Última atualização:** 04/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** adicionar uma linha a cada decisão não óbvia de arquitetura/produto — nunca reescrever uma entrada antiga, só adicionar uma nova se a decisão mudar

## TL;DR

Registro cronológico de decisões que não são óbvias só lendo o código — o "por quê" por trás de escolhas de arquitetura e de produto, pra ninguém perder tempo revertendo algo que já foi decidido de propósito.

## Contexto

Consulte antes de "corrigir" algo que parece estranho à primeira vista — pode ser uma decisão deliberada, não um descuido. Também consulte pra entender por que o sistema é do jeito que é, não só o que ele faz.

## Regra desta página

Nunca editar uma entrada antiga pra "consertar" — se uma decisão mudou, adiciona uma entrada nova referenciando a antiga. O log é a história real, não uma versão final polida.

## Registro

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
| 04/09/2026 | Claude | Criação do documento — 8 decisões registradas |
| 23/09/2026 | Claude | Registrada decisão de não integrar o Laya (motor de decisão local) — custo de infraestrutura (serviço Python separado na VPS) maior que o ganho (velocidade que ninguém sente) frente ao Groq/Gemini já em uso |
| 24/09/2026 | Claude | Registrada decisão de manter `cases` e `legal_processes` separados (achado de prioridade baixa da auditoria do módulo Clientes) — overlap já tem FK de ligação, risco real é lógica de matching duplicada em 3 arquivos, não a separação em si |

---
◀ [Ferramentas e acessos](16-ferramentas-acessos.md) · [Visão geral](00-visao-geral.md)

**Fim da documentação — 17 de 17 blocos completos.**
