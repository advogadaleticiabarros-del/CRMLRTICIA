# Levantamento: o que precisa mudar para vender o CRM como SaaS (28/11/2026)

Pedido da Jessica: "eu quero criar usuários, para vender assinatura desse SaaS". Este levantamento só leu o código e o servidor; nada foi alterado. A recomendação é **uma cópia do CRM por escritório** (banco separado, subdomínio próprio); a justificativa está na memória do perfil (`project_crm_saas`).

## 1. Tamanho do sistema hoje
- 233 serviços, 79 grupos de rotas, 12 telas em JavaScript (só `public/app.js` tem cerca de 12.600 linhas) e 194 migrations, com cerca de 143 tabelas.
- **Nenhuma tabela tem `escritorio_id`.** Por isso, uma cópia por escritório evita mexer nas 143 tabelas.

## 2. A Dra. fixa no código (precisa virar configuração do escritório)
| O que | Ocorrências | Onde |
|---|---|---|
| "Dra. Letícia" em textos (agentes, avisos, telas) | 77 em 42 arquivos | agentes (atendente, negociador, copiloto, esteira comercial, assistente de WhatsApp, briefing, sociedade), `escritorioVirtual`, `mesaDaChefe` |
| Nome completo e OAB (`LETICIA ELIAS BARROS`, 39948) | ~20 em 12 arquivos | `agentePrazosMysql.termosDoEscritorio`, monitoramento, ficha automática |
| Domínio `advogadaleticiabarros` | 35 em 21 arquivos | links, e-mails, portal |
| Telefones da equipe | 11 em 6 arquivos | `EQUIPE_WHATSAPP` em `agentePrazosMysql.ts` e `relatorioIntimacoesJob.ts`, e outros |
| Papel timbrado | 9 arquivos | `assets/timbrado/papel-timbrado.docx`, `papelTimbrado.ts`, kit, relatórios |
| Tribunal (TJES) e ES (Sefaz, e-Flow) | 69 ocorrências em 18 arquivos; 23 serviços de dativo | dativo (regras do ES), MNI, prazos |

**Caminho:** uma tabela de configuração do escritório (nome, OAB, advogados com CPF, telefones da equipe, domínio, timbrado, UF e tribunais), que `office_settings` já começa a fazer, mais a troca de cada ocorrência por essa configuração. É um trabalho grande, mas mecânico, e testável arquivo por arquivo.

## 3. O que é da Dra. e nunca vai para outro assinante
- Biblioteca de modelos de peça (`peca_modelos`), Cérebro (`cerebro_notas/trechos`), lições aprovadas (`peca_licoes`), guia de tom de voz (`office_settings.guia_tom_de_voz`), cofre Obsidian e a ponte do Obsidian.
- Na cópia por escritório, cada banco nasce **vazio**. O cuidado é não copiar o banco da Dra. para criar um assinante novo: usar sempre o banco "do zero" das migrations.

## 4. Integrações: quem configura o quê
| Integração | Hoje | Num assinante |
|---|---|---|
| WhatsApp (Uazapi) | `UAZAPI_TOKEN` no servidor | instância própria (custo por escritório) |
| Tribunais (MNI) | login da Dra., ponte no computador do escritório | login do advogado de cada escritório; **ponte instalada no computador de cada um**, ou credenciamento do servidor no TJES |
| Asaas | `office_settings.asaas_api_key` | conta Asaas própria (já é por configuração) |
| Google (Agenda, Gmail) | um app OAuth (`GOOGLE_CLIENT_ID`) | o mesmo app serve; cada escritório conecta a sua conta (o app precisa estar "Em produção" e verificado pelo Google) |
| IA (Gemini, Groq, OpenAI) | chaves do escritório | decidir: incluída no plano com limite, ou chave própria |
| E-mail (Resend/SMTP), MEGA (backup), DataJud, DJEN | no servidor | DataJud e DJEN servem a todos; e-mail e backup, por escritório |
| Obsidian | ponte da Dra. | recurso opcional, desligado por padrão |

São 73 variáveis de ambiente; cerca de 25 são do escritório e entram no `.env` de cada cópia.

## 5. Servidor
- VPS atual: 8 GB de RAM, 2 núcleos, disco com 49 GB livres. Já roda o CRM da Dra. (cerca de 200 MB), a Laya (1,6 GB), a Agenda/Orbit e a marmitaria. Sobram cerca de 2,7 GB.
- Cada cópia usa cerca de 200 MB, mais o banco. O banco da Dra. tem 917 MB.
- **Recomendação:** colocar o SaaS numa **VPS separada** (a Jessica pediu projetos "sem resquícios" um do outro em 08/11), com espaço para 10 a 20 escritórios por máquina.
- **O que falta criar:**
  - script para criar um assinante: banco, usuário MySQL, `.env`, processo no PM2, subdomínio no nginx e certificado;
  - deploy que atualize todas as cópias, rodando as migrations em cada uma;
  - backup separado por escritório.

## 6. Assinatura e venda
- Cadastro do escritório, plano, período de teste, cobrança recorrente (assinatura no Asaas da Jessica) e bloqueio por falta de pagamento.
- Documentos: contrato de assinatura, acordo de tratamento de dados (a Jessica passa a ser **operadora** pela LGPD), política de backup e de incidentes. Os Termos de hoje (23/11) são do escritório da Dra.
- **Acordo escrito entre a Jessica e a Dra.** sobre a propriedade do software, antes de vender.

## 7. Ordem sugerida
1. **Configuração do escritório:** criar a tabela e trocar as ocorrências da Dra. por ela, começando pelos agentes e avisos. O CRM da Dra. continua igual, só que lendo da configuração.
2. **Primeira cópia de teste** num subdomínio, com banco do zero e um escritório fictício. Conferir que nada da Dra. aparece.
3. **Script de criação de assinante** e deploy para todas as cópias.
4. Assinatura e cobrança, e os documentos jurídicos.
5. Extensão para o Claude (plano de 28/11) como diferencial de venda.

## Decisões em aberto (Jessica)
- IA incluída no plano ou chave do cliente?
- VPS separada para o SaaS?
- Credenciamento do servidor no TJES (para dispensar a ponte em cada escritório)?
- Quais módulos entram no produto: dativo (só ES), parceria e Obsidian ficam opcionais?
