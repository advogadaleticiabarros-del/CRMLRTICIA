# ESTADO — onde paramos

> Atualize ao fim de **cada** tarefa: data, o que entrou e o que mudou nas pendências. Mantenha curto, com no máximo uma tela por seção, e apague o que foi resolvido.

**Última atualização:** 09/10/2026. Último commit: este arquivo; antes dele, `5ed8f16` (fix assistente: OpenAI primeiro).

## Últimas entregas (mais recentes primeiro)
- **09/10:**
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
- **Assistente:**
  - observar as conversas reais de 09/10 em diante (PROCEDIMENTOS §5);
  - transformar frases que falharem em exemplos e testes.
- **Agenda:** os eventos de audiência duplicados (mesma audiência em 2 usuários) poderiam ser unificados.
