# ESTADO — onde paramos

> Atualize ao fim de **cada** tarefa: data, o que entrou e o que mudou nas pendências. Mantenha curto, com no máximo uma tela por seção, e apague o que foi resolvido.

**Última atualização:** 14/10/2026. Último commit: Escritório virtual (sala + Métricas da IA) e Laya.

## Últimas entregas (mais recentes primeiro)
- **15/10:**
  - **Dra. Lívia, atendente do WhatsApp (modo rascunho):** usa o tom de voz aprendido das conversas reais da equipe, faz as perguntas certas por área e aprende com as correções. Aprovação em Escritório virtual → Dra. Lívia. Para desligar: `ATENDENTE_DESLIGADO=1`.
  - **Sociedade dos agentes:** conversas a partir das ações reais (a cada 10 min), reunião diária às 18h15 com ata e ideias, memória persistente e Mural da equipe. Migration 159.
  - **Corrigido:** o relato do cliente da Dra. Camila lia a tabela antiga de mensagens (era da migration 012; o certo é a 084).
  - **Próximo passo:** depois de uma semana de rascunhos aprovados, avaliar com a Dra. se a Lívia passa a responder sozinha.
- **14/10 (fim do dia):**
  - **Cérebro:** biblioteca do Obsidian. Pergunta, importação do cofre pelo navegador, relatório de organização com Mapa do cofre; repassa notas ao Enzo nas minutas (migration 157).
  - **Esteira comercial:** Dra. Bianca (proposta com valor de tabela pelo histórico, política de parcelamento, conflito de interesses e aprovação no WhatsApp da Dra.), Dr. Felipe (revisão e assinatura) e Dra. Camila (documentos e provas, cobrança, relato do cliente). Migration 158.
  - **Prestação de contas padrão:** "Recebi e repassei" abre o texto e o botão de envio pelo WhatsApp.
  - **Ficha "Escritório Virtual.md"** na raiz do cofre Obsidian (fora do git): agentes, comandos da Dra., prestação de contas, Cérebro e pendências. Atualize-a sempre que um agente mudar.
  - **Instalados:** 4 agentes do agency-agents (`.claude/agents/`) e o codebase-memory-mcp (computador da Jessica, perfil `.claude-conta-2`). O OpenMontage (vídeos) e o Trail-Code ficaram de fora (ver conversa de 14/10).
  - **Falta a Dra. definir:** a tabela de honorários (`tabela_honorarios`) e a política de parcelamento (`politica_parcelamento`). Até lá vale a mediana das propostas aceitas e o padrão provisório (até 10x, parcela mínima R$ 100).
- **14/10 (noite):** agentes de terno e quadro de cartões abaixo da sala, no formato do print do CRM comercial. Nomes passaram a Dr./Dra. + nome (escolha da Jessica); Laya e Enzo sem título. O script `scripts/instalar-laya-vps.sh` ficou fora do commit: falta corrigir o passo 6 (o reinício deve ser pelo PM2 do crmapp), e a edição foi bloqueada pelo modo automático.
- **14/10 (tarde):**
  - **Escritório virtual** (menu): sala isométrica com 20 agentes ao vivo, no estilo do CRM comercial. O status vem de `job_runs`, `agente_acoes` e `automation_runs`.
  - **Métricas da IA** no formato dos prints da Jessica (`/api/escritorio/painel-ia`).
  - **Contagem de uso de IA:** `ia_uso_diario` (migration 156).
  - **Laya** na qualificação do possível cliente: primeiro grátis, IA paga só sem certeza. O código está pronto; **falta instalar o serviço na VPS do jurídico** (ver 16-ferramentas).
  - **Leitor aplicado às decisões dos últimos 15 dias**, no boot e às 7h50. A Dra. ainda não tinha recebido nenhuma leitura porque só valia para sentença nova.
- **14/10 (manhã):**
  - **Escritório virtual.** O mapa v2 tem 67 agentes em 10 departamentos e está em `docs/escritorio-virtual/01-mapa-de-agentes.md`. A Dra. aprovou as 5 decisões "de acordo com a sugestão" (registradas no decision log).
  - **Leitor de sentença e Secretária particular** (`leitorDecisao.ts`, `secretariaParticular.ts`, migration 155 `decisao_leituras`). Com a íntegra do DJEN, a sentença ou o acórdão chega resumido no WhatsApp: resultado, ganhos e perdas, valor, pontos de atenção e prazos de recurso com data. O prazo vem de tabela fixa e não da IA.
  - **Aviso de uso de IA** nos 4 contratos padrão (`AVISO_USO_IA`).
- **12/10:**
  - **Backup:** a prova de restauração de 11/10 falhou porque o dump chegou a 656 MB de SQL e o código o lia num único texto (limite do Node: 512 MB). A restauração agora lê em fluxo, comando por comando (`restoreFluxo.ts`, `divisorSql.ts`). As cópias de 02h, 09h e 19h nunca pararam. Prova real refeita em 12/10 e aprovada: 106 tabelas, 171 clientes, 88 casos e 8 usuários, iguais à produção. Detalhes no runbook.
  - Observação: em 01/10 a prova contou 185 clientes; hoje a produção tem 171. A diferença é da produção (fichas removidas ou unificadas no período), não do backup. As cópias antigas continuam no MEGA, se for preciso conferir.
- **09/10:**
  - Repositório conferido: tudo no GitHub. As skills de engenharia foram versionadas em `.claude/skills/` e `skills-lock.json`, e as pastas locais (`worktrees`, `.superpowers`) foram para o `.gitignore`. O branch local `worktree-aceite-publico-e-excluir-contrato` está obsoleto: tudo dele já está na `main`. O LEIA-PRIMEIRO ganhou a seção "Perfil novo".
  - Documentos de contexto (`docs/contexto/`) e dados pessoais reais tirados dos testes.
  - Assistente: consulta de **acordos**, lista de **próximos recebimentos**, foco no pedido atual, IA OpenAI primeiro.
  - **Aviso diário às 8h** das parcelas de acordo que vencem hoje, amanhã e em 2 dias, e das vencidas sem baixa (cron `acordos:aviso-vencimento`).
  - Fechamento do dia sem "Dra. Administrador".
- **08/10:**
  - Assistente pessoal do WhatsApp completo, com todas as ações e busca tolerante a erro; "sim" só no financeiro.
  - Serviços compartilhados: `baixaAReceber`, `aReceberMontar`, `agendaEventos` e `recebimentoCliente`.
  - Cadastro da Larissa Leal (processo 0001437-33.2026.5.17.0013).
- **07/10:**
  - Novo contrato padrão trabalhista (22 cláusulas) e impressão sem rodapé cobrindo o texto.
  - A Receber mostra só a parte dela em parceria.
  - Fase sugerida ignora menções a atos futuros nas intimações.
  - Cadastros dos processos da Justiça Federal (Mauro, Rosilda, Gileno, Wendel, Valci, Ana Paula, Ana Maria, José Lourenço).

## Pendências que dependem da Dra. (perguntar só se o assunto voltar)
- **GitHub privado:** o repositório estava PÚBLICO em 09/10. Ela aprovou torná-lo privado, mas as contas logadas aqui são colaboradoras e não têm permissão. Ela precisa fazer em github.com/advogadaleticiabarros-del/CRMLRTICIA → Settings → Danger Zone → Change visibility → Private. Confirme com `gh repo view --json visibility`.
- **Parceria Infinity:** falta confirmar se Maria Santiago (caso 104) é parceria.
- **Mailza:**
  - nº 416 ou 418 do endereço;
  - profissão, para o contrato trabalhista.
- **José Lourenço:** confirmar se o INSS é o "e outros" do polo passivo; a petição inicial ela não tem.
- **CONAFER:** CNPJ diverge entre o e-Proc (0001-00) e a petição (0001-03).
- **Rosilda:** confirmar se o e-mail fvvicentini@yahoo.com.br é dela.
- **Itens antigos:**
  - 27 lançamentos do A Receber sem processo;
  - telefone do José de Paulo;
  - CPF do Sebastião;
  - perícias realizadas (Lauriza 05/10, Jessica e Mauro 30/09);
  - recurso da Rachel;
  - representante da Kaylane;
  - alvará da Rutiéria;
  - sentença da Maria Teresa (BMG);
  - certidão da Elizete;
  - sentença da Julya;
  - plano pago do Gemini (está sem cota);
  - reconectar as contas Google.
- **Financeiro:**
  - contas Internet (R$ 127,07) e EDP (R$ 302,00) vencidas desde 20/09;
  - parcela 2/5 da Larissa (R$ 55) vencida desde 20/09.

## Próximos passos sugeridos (se ela não pedir outra coisa)
- **Laya na VPS do jurídico (16/10):** já existe o ambiente `/opt/laya`, com Python 3.12 e pip. A VPS tem folga: 5,2 GB de memória livre, 22 GB de disco e 2 núcleos. O passo 6 do `scripts/instalar-laya-vps.sh` foi corrigido para reiniciar pelo PM2 do crmapp. Falta rodar o script, que instala torch CPU + `laya[serve]` 0.4.8 do PyPI, sobe o PM2 `laya`, testa e só então põe `LAYA_URL` e reinicia o CRM. O modo automático do Claude bloqueia a instalação de código externo em produção, então rodar como root na VPS: `bash /root/instalar-laya-vps.sh` (ou liberar a permissão).
- **Escritório virtual, Fase 1 (em andamento).** Próximos passos:
  1. Secretária com aprovação por resposta no WhatsApp ("recorrer" / "não recorrer" vira tarefa e prazo).
  2. Prazo interno com escalonamento e Auditor de prazos.
  3. Pesquisador e Verificador de jurisprudência.
  4. Testador com casos reais anonimizados.
  - Observar as primeiras leituras reais de sentença e ajustar o prompt.
- **Backup, antes de dezembro (prioridade):** o MEGA de 20 GB lota entre o fim de novembro e dezembro. Cada cópia tem 321 MB e cresce cerca de 130 MB por mês por causa da mídia do WhatsApp no banco. Saídas possíveis:
  - tirar `whatsapp_media` do banco (arquivos com backup próprio; cada cópia cairia para cerca de 60 MB);
  - ou ela assinar um plano pago do MEGA, que é decisão dela.
- **Assistente:**
  - observar as conversas reais de 09/10 em diante (PROCEDIMENTOS §5);
  - transformar frases que falharem em exemplos e testes.
- **Agenda:** os eventos de audiência duplicados (mesma audiência em 2 usuários) poderiam ser unificados.
