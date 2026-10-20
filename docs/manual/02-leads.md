# 02 · Leads e comercial

**Área:** Atendimento e captação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Funil de captação com 12 etapas, cronômetro automático de primeira resposta, qualificação por IA, e uma regra dura: não dá pra perder um lead sem registrar o motivo. Perder ou recusar dispara mensagem automática de despedida por WhatsApp, uma única vez.

## Contexto

Consulte quando precisar entender uma etapa do funil, por que uma mensagem de recusa foi enviada, como funciona o cronômetro de resposta, ou o que acontece tecnicamente ao converter um lead em cliente.

## Etapas do funil (Kanban)

Novo Lead → Primeiro Contato → Atendimento Realizado → Documentação Pendente → Proposta Enviada → Negociação → **Contrato Assinado** (vira Convertido) ou **Proposta Recusada** / **Perdido**. Newsletter é uma etapa à parte, para quem só quer receber conteúdo.

## O que acontece quando um lead entra

1. Cadastro (nome, e-mail, telefone, origem, área jurídica, resumo do caso).
2. O escritório é **avisado automaticamente** (alerta interno) assim que o lead entra.
3. Se houver texto suficiente no resumo do caso (ou nas observações), a **IA qualifica sozinha**: sugere área jurídica, urgência e faixa de valor estimado — acontece em segundo plano, não trava o cadastro.

## Ficha automática (desde 16/10/2026)

O que o lead **ou o cliente** manda no WhatsApp entra sozinho na ficha, em qualquer etapa: texto, fotos (RG, CNH, comprovante) e PDFs.

**Quando:** 2 minutos depois de cada mensagem (para juntar as que vêm em sequência) e na rotina `ficha:completar`, às 10 e às 40 de cada hora, das 7h às 21h. A rotina também completa as fichas antigas (mensagens dos últimos 90 dias).

**Como lê:**
- **Conversa inteira:** a IA lê o texto. CPF, e-mail e CEP também são lidos por regra fixa; o CPF só vale se passar no dígito verificador.
- **Arquivos que o cliente mandou:** lidos pelo Gemini e, sem cota, pela OpenAI com visão. Cada arquivo é lido uma vez só (cache em `documento_leituras`).

**Campos:**
- **Lead:** nome completo, CPF, RG, nascimento, e-mail, estado civil, profissão, CEP, rua, número, bairro, cidade e UF.
- **Cliente:** nome, CPF, e-mail, nascimento e endereço (numa linha só).

**O que grava sozinho:** só campo **vazio** e lido com segurança. O nome curto do WhatsApp ("Maria") vira o completo do documento ("Maria Aparecida de Souza") quando um contém o outro.

**O que nunca grava sozinho (vira pendência):**
- campo que já tem outro valor;
- leitura incerta;
- CPF que não confere no dígito verificador;
- nome diferente do cadastro.

As pendências ficam em **Escritório virtual → Dra. Camila**, com "Aplicar" ou "Ignorar".

**O que é descartado:**
- documento de outra pessoa (o RG do marido): o nome do documento não bate com o do contato;
- o nome da advogada ou do escritório;
- CPF, e-mail e CEP que **o próprio escritório escreveu** na conversa (chave Pix da Dra., e-mail do escritório);
- arquivos que o escritório enviou (contrato, procuração, proposta).

**Aviso:** a equipe recebe no sino "📇 Ficha de Fulano completada", com o que entrou e o que precisa conferir. Lead em "documentação pendente" que passa a ter CPF continua avisando "Dados recebidos para a proposta".

**Desligar:** `FICHA_DESLIGADA=1` no `.env` desliga a leitura a cada mensagem; a rotina continua.

Código: regras em `fichaAutomatica.ts` (`tests/fichaAutomatica.test.mjs`), banco e leitura em `fichaServico.ts`; tabelas `ficha_pendencias` e `ficha_varredura` (migration 163).

## Cronômetro de primeira resposta

O sistema mede quanto tempo o escritório demora pra responder um lead novo, por dois sinais (o que vier primeiro conta):

- o lead sai da etapa "Novo Lead" pela primeira vez; ou
- alguém clica em "Chamar no WhatsApp" no card do lead.

Só a **primeira** resposta é registrada — mudanças de etapa depois disso não reiniciam o cronômetro.

## Regra dos 7 dias em análise

Quando um lead entra em "Negociação" (proposta em análise), o sistema marca o início dessa fase — usado pra sinalizar quando uma negociação está parada há mais de 7 dias sem decisão.

## Perder um lead exige motivo

Mover um lead pra "Perdido" **exige** escolher um motivo de uma lista fixa (preço, sumiu, foi com outro escritório, desistiu, fora da área de atuação, sem perfil, outro) — não dá pra perder um lead sem registrar por quê.

## Mensagem automática ao recusar/perder

**Desde 20/10/2026 a mensagem não sai sozinha:** ela fica em Escritório virtual → "Mensagens para aprovar", com o motivo, e sai com os botões "Sim" e "Não" da newsletter quando alguém da equipe aprovar.

Mover um lead pra **"Proposta Recusada"** ou **"Perdido"** prepara, uma única vez, uma mensagem de despedida calorosa por WhatsApp (com pergunta sobre newsletter) — a mesma mensagem nos dois casos. Se havia uma proposta em aberto vinculada, ela também é marcada como recusada automaticamente, pra não ficar desalinhada com o funil. **Confirmado:** a mensagem só sai uma vez por movimentação — mover o lead de novo pra "Perdido" depois não reenvia (mas não há trava se alguém mover pra fora e pra dentro de novo manualmente, é best-effort).

## Virar cliente

Converter um lead em cliente cria um cadastro em Clientes (PF ou PJ) já com nome/e-mail/telefone/observações, marca o lead como "Convertido" e vincula os dois registros — o histórico de qualificação (RG, estado civil, profissão, resumo do caso) migra junto pra ficha do cliente. Um lead só pode ser convertido uma vez.

**Correção (24/09/2026):** até então, essa conversão não copiava o CPF/CNPJ nem o endereço do lead pro cadastro de cliente — a "qualificação jurídica pronta pra copiar" da ficha saía incompleta pra quem virou cliente por essa via. Agora os dois vêm junto (endereço montado a partir de CEP/rua/bairro/cidade/UF quando não há um endereço único já preenchido).

## Relação com Propostas

Cada lead pode ter propostas comerciais vinculadas (enviada, em negociação, aceita, recusada) — ver módulo de Documentos e peças para como uma proposta é gerada.

## FAQ

**Se eu mover um lead pra "Perdido" duas vezes, manda a mensagem duas vezes?** Não deveria — a mensagem dispara na transição pra "Perdido"/"Proposta Recusada". Mover pra fora e de volta manualmente pode disparar de novo (é best-effort, não há trava contra isso).

**A qualificação por IA é obrigatória?** Não — só roda automaticamente quando há texto suficiente (15+ caracteres) no resumo do caso ou nas observações. Sem isso, os campos de área/urgência/valor ficam vazios até preenchimento manual.

**Um lead pode voltar de "Perdido" pra ativo?** Sim, movendo manualmente pra qualquer outra etapa — o motivo de perda registrado fica como histórico, não é apagado.

## Links relacionados
- [Clientes e cadastro](01-clientes.md) — o que acontece ao converter
- [WhatsApp](03-whatsapp.md) — onde as mensagens automáticas de lead chegam
- [Documentos e peças](06-documentos.md) — como uma proposta comercial é gerada

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 20/10/2026 | Claude | Despedida ao recusar ou perder o lead vai para "Mensagens para aprovar" (não sai mais sozinha) |
| 16/10/2026 | Claude | Ficha automática: texto, fotos e PDFs de lead e cliente viram cadastro sozinhos (só o vazio; o resto vira pendência na Dra. Camila). Substitui a detecção que só rodava em "documentação pendente" e nunca disparou |
| 03/09/2026 | Claude | Criação do documento |
| 04/09/2026 | Claude | Quadro Kanban corrigido: era grid de 5 colunas fixas, as 4 últimas etapas quebravam pra 2ª linha desalinhada — agora rola horizontalmente com setas de navegação (ver [Runbook](14-runbook.md)) |
| 24/09/2026 | Claude | Converter lead em cliente passa a copiar CPF/CNPJ e endereço também — antes só nome/e-mail/telefone/observações |

---
◀ [Clientes](01-clientes.md) · [Visão geral](00-visao-geral.md) · Próximo: [WhatsApp](03-whatsapp.md) ▶
