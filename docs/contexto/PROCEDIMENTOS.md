# Procedimentos recorrentes (leia só o que precisar)

Os acessos (IP da VPS, chave SSH) estão no arquivo local `C:\Users\prosy\CLAUDE.md`. Abaixo, `$SSH` = `ssh -i ~/.ssh/<chave> root@<vps>` e `$SCP` = `scp -i ~/.ssh/<chave>`.

## 1. Rodar script de dados em produção (leitura ou correção pontual)
1. Escreva o script no **scratchpad** da sessão com a ferramenta Write. Comece com:
   `require('dotenv').config(); const fs=require('fs'); const {db}=require('./dist/config/database');`
   Use `(async()=>{ ... await db.end(); })().catch(e=>{console.error('ERRO',e.message);process.exit(1)})`.
2. Rode `node --check x.js` localmente.
3. Execute: `$SCP x.js root@<vps>:/home/crmapp/app/x.js && $SSH "cd /home/crmapp/app && chmod 644 x.js && sudo -u crmapp node x.js 2>&1 | grep -v typeCast; rm -f x.js"`
4. Para PDF: `$SCP arquivo.pdf root@<vps>:/tmp/iN.pdf`, `chmod 644` e apague depois.
5. **Gravação** em várias tabelas usa transação. Coluna JSON lida do MySQL vem como objeto: use `JSON.stringify` ao regravar.

## 2. Cadastrar processo a partir de PDF/print que a Dra. mandou
Os arquivos ficam em `C:\Users\prosy\Downloads`. Leia o PDF com a ferramenta Read.
1. **Busque antes:** clientes por CPF (só dígitos) e por nome, e `legal_processes` pelo número (só dígitos). Na maioria das vezes, ficha e processo **já existem**: só complete.
2. **`clients`:** `cpf_cnpj`, `birth_date` com COALESCE, `address` (com CEP), `phone`, `email`, `tipo='PF'`. Acrescente em `notes` nacionalidade, estado civil, profissão, RG e o contexto.
3. **`cases`:** `legal_area`, `valor_causa` e a `description` acrescida dos blocos *PETIÇÃO INICIAL (data)*, *FATOS*, *PEDIDOS* e *ANDAMENTO*.
4. **`legal_processes`:** `judicial_area`, `phase` (inicial, instrucao, sentenca, recurso, execucao, encerrado) e `cliente_conferido=1`. Status suspenso continua `ativo`, para seguir monitorado.
5. **`case_partes`:**
   - `papel`: contraria, testemunha, perito ou outro;
   - parte contrária com CNPJ, endereço e `advogado`;
   - peritos, MPF e outros também entram aqui.
6. **`documents`:** `type='peticao_inicial'`, `folder='processos'`, `data`=buffer, `mime='application/pdf'`, `status='recebido'`, `created_by=1`.
7. **Sem prazos, tarefas ou agenda.** Parceria Infinity: `cases.partner_id=1`. Se não souber se é parceria, pergunte.
8. Regere o Obsidian (item 3) e responda à Dra. com o que foi cadastrado e o que falta (ex.: telefone).

## 3. Regerar notas de clientes no Obsidian
1. Gere no servidor: `$SCP scripts/exportarClientesObsidian.js root@<vps>:/home/crmapp/app/exp.js && $SSH "cd /home/crmapp/app && chmod 644 exp.js && rm -rf /tmp/obs && sudo -u crmapp node exp.js | tail -1; rm -f exp.js; cd /tmp/obs && tar czf /tmp/obs.tgz Clientes"`
2. Traga o arquivo: `$SCP root@<vps>:/tmp/obs.tgz <scratch>/obs.tgz && $SSH "rm -rf /tmp/obs /tmp/obs.tgz"`
3. Substitua as notas no cofre: em `C:\Users\prosy\Documents\CRM LETICIA\CRMLeticia`, rode `find Clientes -mindepth 1 -delete` e depois `tar xzf <scratch>/obs.tgz`. Rode **fora** da pasta `Clientes`; dentro dela, o `rm` falha.

Só são exportados os casos com resultado ou com documento anexado.

## 4. Mudança de código (fluxo padrão)
1. Escreva o teste, veja falhar e depois implemente.
2. Rode `npm run build` e `npm test` (tudo verde).
3. Atualize `docs/manual/` e copie para o Obsidian.
4. Commit seletivo, push e `gh run watch <id>`. Se o comportamento for crítico, confira em produção (item 1, só leitura).

## 5. Assistente do WhatsApp: diagnosticar "não respondeu / respondeu errado"
1. Puxe a conversa: `whatsapp_messages WHERE phone LIKE '%91011402'` (Letícia) ou `'%88798093'` (Jessica), com `msg_time` convertido de UTC para -03:00.
2. Repita a frase com o histórico real: `R.promptAssistente({hoje, diaSemana, mensagem, historico})`, passando por `require('./dist/services/assistenteWhatsappMysql').iaAssistente.interpretar(...)` e depois `R.parseAcao`.
3. Se faltar ação, crie a ação. Se a IA confundir, acrescente a frase em "Exemplos" no prompt, com teste.
4. Para consultas reais, use `require('./dist/services/assistenteWhatsappMysql').repo` (só leitura).

## 6. Erros comuns já resolvidos
- **sed e acentos:** `sed` com `[ée]` corrompe UTF-8 (deixa byte solto). Para substituições com acento, use node ou python.
- **Heredoc com aspas triplas:** heredoc grande no Bash às vezes falha. Grave o script com a ferramenta Write e rode o arquivo.
- **`python` no Bash:** pode cair no alias da Microsoft Store. Prefira `node -e` para edições simples.
- **`break-inside: avoid` na impressão:** não funciona dentro da tabela do papel timbrado. Use `inline-block`.
- **Fuso:** datas do MySQL vêm como `Date` em UTC; agenda e prazos usam `CONVERT_TZ(...,'+00:00','-03:00')`. Para gravar hora local, use `localParaUtcMysql('AAAA-MM-DDTHH:MM')`.
