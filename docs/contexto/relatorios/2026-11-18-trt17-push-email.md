# TRT17 pelo aviso Push por e-mail — 18/11/2026

## Pedido
"Quero conectar o TRT 17 também no meu CRM, qual a maneira sem precisar pedir autorização" → depois: "vamos fazer isso: o aviso por e-mail do TRT17 lido pelo CRM. Em paralelo, a Dra. manda o pedido de credenciamento [...] e tudo que for possível por essa segunda via".

## Achado
- O **Push do TRT17 já estava ligado** na conta da Dra.: 220 e-mails "[TRT17] [PUSH] Atualizações de Informações Processuais…" (de `notificacoes@trt17.jus.br`) já tinham passado pelo leitor de e-mail do CRM.
- **A leitura estava parada desde 06/11** (falhas com `invalid_grant` desde 29/10): o Google cancelou a autorização das três conexões (Gmail dos tribunais, Agenda, Gmail da parceria). Ninguém viu: o aviso ia só para o sino.
- 101 desses e-mails eram de **14 processos do TRT17 que não estão no CRM** (eram só descartados no log).
- Os e-mails Push que entraram viravam um resumo de ~110 caracteres feito pela IA: os movimentos de um mesmo e-mail se perdiam.

## Feito
- `src/services/pushTribunal.ts`: reconhece o e-mail Push (qualquer tribunal `.jus.br`) e lê cada linha da tabela (data + texto) como um movimento. Formato não reconhecido → caminho antigo.
- `courtEmailMonitorService.ts`: guarda o HTML original do e-mail; no Push, número do processo pelo assunto, um andamento por movimento (sem IA), aviso no WhatsApp da equipe com até 5 movimentos; 60 e-mails por rodada (eram 30).
- `monitoringService.registrarMovimentoDoPush`: confere com as outras fontes pelo dia e pelo texto (não mais ±3 dias).
- Processos do e-mail fora do CRM: `GET /api/court-email-monitor/processos-sem-cadastro` e quadro em Andamentos → Ações novas de clientes, com "Cadastrar processo" (formulário já com o número e a área trabalhista).
- `src/services/avisoConexaoGoogle.ts` + `runJob`: queda de autorização do Google avisa no WhatsApp pessoal do escritório e no sino, 1x a cada 24 h, com o que parou e onde reconectar.
- Rotina `monitoramento:processos-email` às 8h, 12h, 16h e 19h (era 8h e 19h).
- Termômetro: TRT17 descrito como acompanhado pelo Push, DJEN e DataJud.

## Verificado
- `npm run build` ok; `npm run lint` 0 erros; testes novos `tests/pushTribunal.test.mjs` (8) e `tests/avisoConexaoGoogle.test.mjs` (5) passando; suíte completa (ver commit).
- Em produção (só leitura, contagens): integração do e-mail com `invalid_grant`; 220 e-mails do TRT17; 14 processos sem cadastro.

## Não verificado
- **O formato real da tabela do e-mail Push** não foi visto (leitura do conteúdo dos e-mails bloqueada pela permissão e a conexão do Gmail caída). O leitor foi feito pelo padrão do PJe (tabela data | movimento) com volta segura ao caminho antigo. Conferir depois da reconexão: em `court_email_messages`, o `detail` "Push TRT17: N novo(s)" mostra que a tabela foi lida; se aparecer só "movimentacao_registrada" sem esse texto, o formato é outro.

## Decisões
- O 403 do MNI do TRT17 não é contornado; o Push é a via que o tribunal oferece (decision log).
- Processo do Push fora do CRM não é cadastrado sozinho: vai para a lista.

## Pendente
- **Dra./Jessica:** reconectar as três conexões Google (Configurações → Monitoramento por e-mail; Agenda; Parcerias) e clicar "Verificar agora".
- **Jessica:** no Google Cloud Console, conferir se a tela de consentimento OAuth está "Em produção" (em "Teste" a autorização cai a cada 7 dias).
- Os 14 processos do TRT17 fora do CRM já foram cadastrados depois (conferido em produção após o deploy). A lista nova mostra hoje 13 processos de **outros** tribunais vindos por e-mail (10 TJES, 2 TJMG, 1 eproc): **Dra.** conferir e cadastrar em Ações novas de clientes.
- **Dra.:** enviar o pedido de credenciamento do MNI ao TRT17 (texto entregue na conversa); o TRT17 provavelmente libera pelo IP do servidor.
- Conferir o formato do Push depois da reconexão (acima).

## Próxima sessão
Depois da reconexão, rodar a leitura e conferir em `court_email_messages` os `detail` com "Push TRT17". Quando o TRT17 liberar o credenciamento, incluir `trt17_pje1g`/`trt17_pje2g` em `src/services/mni/sistemas.ts` (endereços `/primeirograu|segundograu/servicosweb/mni222/intercomunicacao`).
