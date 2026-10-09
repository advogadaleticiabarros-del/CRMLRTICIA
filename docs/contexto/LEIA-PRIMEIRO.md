# LEIA PRIMEIRO — contexto para qualquer sessão/perfil do Claude

> Regra (09/10/2026): todo perfil novo começa lendo **este arquivo** e o **[ESTADO.md](ESTADO.md)** (onde paramos). Ao terminar **cada** tarefa, atualize o ESTADO.md, faça commit e push. Leia os outros arquivos só quando a tarefa precisar. Assim se gasta pouco contexto.

## Quem é a usuária e como falar com ela
- **Dra. Letícia Elias Barros**, advogada solo em Vitória/ES (OAB/ES 39.948). Áreas: trabalhista, previdenciário (INSS/JF), família e consumidor.
- Não é técnica, mas é precisa. Escreva em **português claro, direto, sem jargão**, com resultado primeiro.
- Ela quer **autonomia**: faça, não pergunte o que dá para decidir. Pergunte só o que for decisão dela (dinheiro, parceria, enviar algo a terceiros).
- **Jessica** ajuda na operação (WhatsApp (27) 98879-8093). Recebe lembretes pessoais e o fechamento do dia.

## O sistema (CRMLRTICIA)
- **Back-end:** Node, Express e TypeScript, em `src/` (`routes/`, `services/`, `crons/`).
- **Front:** JS puro, em `public/app.js` (arquivo grande).
- **Banco:** MySQL 8, com migrations em `migrations/NNN_*.sql`, que rodam sozinhas no start.
- **Produção:** VPS Hostinger, app em `/home/crmapp/app`, PM2 `crm-juridico`, banco `crmjuridico`. Os acessos estão no arquivo local `C:\Users\prosy\CLAUDE.md`, fora do git.
- **Deploy:** um `git push` na `main` dispara o GitHub Actions, que publica na VPS sozinho. Confira com `gh run list` / `gh run watch`.
- **Testes:** `npm run build` e depois `npm test` (node:test, arquivos `tests/*.test.mjs`, que leem de `dist/`). Hoje: cerca de 805 testes, 0 falhas. Nunca entregue com teste falhando.
- **Manual vivo:** `docs/manual/` (00–17). O espelho de leitura no Obsidian fica em `C:\Users\prosy\Documents\CRM LETICIA\CRMLeticia\Documentação Técnica\`.
- **WhatsApp:** Uazapi, número do escritório (27) 99515-1402. Webhook em `src/routes/whatsapp-webhook.ts`.
- **IA:** `src/services/aiAssistant.ts`. Gemini (às vezes sem cota), Groq (limite gratuito por minuto) e OpenAI GPT-5.6 Luna (reserva/principal do assistente; barato).

## Regras de trabalho (obrigatórias)
1. **Commit + push automáticos** ao fim de toda alteração, sem perguntar. Depois acompanhe o deploy e avise se falhar. Mensagem de commit em português, terminando com `Co-Authored-By`.
2. **Commit seletivo:** `public/app.js`, `whatsapp.js` e `styles.css` às vezes têm alterações de outra pessoa. Rode `git diff` e envie só os seus trechos.
3. **TDD sempre que der:** teste primeiro e depois o código. Use a skill `codebase-design`: módulos profundos, dependências injetadas, teste pela interface.
4. **Documentação na mesma tarefa:**
   - mudança de comportamento: bloco em `docs/manual/` + linha no Changelog;
   - bug real de produção: `14-runbook.md`;
   - decisão não óbvia: `17-decision-log.md`.
   Depois copie os arquivos alterados para o espelho do Obsidian.
5. **Segredos e dados pessoais:**
   - Senha do INSS do cliente fica **só no banco**, em `client_credentials`; nunca no git, em log ou em doc.
   - Não coloque CPF, telefone ou endereço reais em testes e docs: use dados fictícios.
   - Chaves e senhas nunca vão para o repositório.
6. **Backup é crítico:** a rotina diária manda aviso no WhatsApp. Não mexa sem testar.
7. **Rodapé de toda resposta final à usuária:** o que foi feito, como verificou, e o que depende dela.

## Regras do negócio (não pergunte de novo)
- **Honorários padrão:** 30% sobre o crédito do cliente + sucumbência (100% do escritório). Exceção: Julya (alimentos), 20% dos atrasados + sucumbência.
- **Parceria INFINITY LAW** (`partners.id=1`): 30% divididos em 15% dela e 15% da parceira; a entrada é do escritório. A provisão separa "seu" e "da parceira".
- **Prints/PDFs de processo que ela manda:** cadastre processo, ficha, partes e valores e anexe o documento. **Não crie prazos, tarefas nem agenda**: o monitoramento automático faz isso.
- **Uma pessoa, uma ficha:** nunca duplique (busque por CPF e por nome); processo novo vai na ficha existente. Parte contrária vai em `case_partes`, nunca vira cliente. Todo lançamento financeiro fica ligado ao caso, com o nº do processo.
- **Ficha completa:** use tudo o que vier (CPF, endereço com CEP, telefone, e-mail, nascimento, profissão nas `notes`) e sempre o `valor_causa`.
- **Repasses de processos arquivados** já foram feitos: marque como repassado, sem perguntar.
- **Depois de cada cadastro**, regere as notas de clientes do Obsidian (ver PROCEDIMENTOS).

## Assistente do WhatsApp (núcleo recente)
- **Quem comanda:** Letícia (44) 99101-1402 e Jessica, escrevendo para o número do escritório.
- **Código:** `assistenteRegras.ts` (regras puras), `assistenteBusca.ts` (busca tolerante a erro de digitação), `assistenteWhatsapp.ts` (orquestrador, com dependências injetadas) e `assistenteWhatsappMysql.ts` (banco, IA e envio).
- **Confirmação:** **"sim" só no financeiro** (conta a pagar, gasto, pagar conta, recebimento, baixa). O resto é feito na hora.
- **Detalhes:** `docs/manual/03-whatsapp.md`, seção "Assistente pessoal".
- **Para incluir uma ação nova:**
  1. tipo e parse em `parseAcao`;
  2. linha no `promptAssistente` e exemplo;
  3. `case` no orquestrador;
  4. método no repo;
  5. testes.

## Perfil novo / outro computador: preparar o ambiente
1. `git pull` na `main`. Tudo o que importa está no GitHub; nada de trabalho fica só no computador.
2. **Skills:**
   - As de engenharia (`codebase-design`, `code-review`, `diagnosing-bugs`, `domain-modeling` etc.) já vêm no repositório, em `.claude/skills/`.
   - As do **Superpowers** (`test-driven-development`, `systematic-debugging`, `writing-plans`...) ficam fora do git de propósito. Para reinstalar: `npx skills add obra/superpowers`. A lista e a origem de cada uma estão em `skills-lock.json`.
3. **Fora do git, de propósito:**
   - acessos e chaves: `C:\Users\prosy\CLAUDE.md` e `.env`;
   - `.claude/worktrees/` (rascunhos antigos, já incorporados à `main`);
   - `.superpowers/` (relatórios de execução das tarefas).
4. Para conferir se está tudo salvo: `git status -sb` deve mostrar `## main...origin/main`, sem arquivos pendentes.

## Onde ficam as coisas
| Preciso de… | Arquivo |
|---|---|
| Onde paramos / pendências com a Dra. | [ESTADO.md](ESTADO.md) |
| Como cadastrar processo de PDF/print, rodar script na VPS, regerar Obsidian | [PROCEDIMENTOS.md](PROCEDIMENTOS.md) |
| Como um módulo funciona | `docs/manual/NN-*.md` (mapa em `00-visao-geral.md`) |
| Incidentes e como resolver | `docs/manual/14-runbook.md` |
| Por que foi feito assim | `docs/manual/17-decision-log.md` |
| Regras de skills/código | `CLAUDE.md` (raiz do repo) |
