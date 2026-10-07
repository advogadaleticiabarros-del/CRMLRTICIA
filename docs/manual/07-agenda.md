# 07 · Agenda e compromissos

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Agenda com sincronização de mão dupla com o Google Calendar e cor por status — audiências do Dativo e de correspondente nascem e se atualizam sozinhas, sem cadastro duplo.

## Contexto

Consulte pra entender como um evento chega no Google Calendar, o que a cor de um evento significa, ou por que uma audiência apareceu na agenda sem você ter cadastrado ali.

## Tipos de evento

Reunião 🤝, Audiência ⚖️, Compromisso 📌 — cada um com ícone próprio nas telas que listam a agenda (WhatsApp, briefing, etc.).

## Pessoal, recado e medicamento

Decisão da Dra. Letícia: trabalho e vida pessoal no mesmo sistema. Três tipos extras no formulário de evento:

- **Pessoal** (verde-água), **Recado** (laranja) e **Medicamento** (rosa).
- Na hora marcada chega um aviso no WhatsApp **só da Jessica (27 98879-8093)** — não vai para os números do briefing (pedido de 01/10/2026; trocável em `office_settings.whatsapp_pessoal_destino`) — e no sino. Um aviso por ocorrência (rotina `agenda:lembretes-pessoais`, a cada 5 min).
- **Repetir todo dia** (marcado automaticamente em Medicamento): o sistema cria a ocorrência de hoje e de amanhã às 00h20 e 12h20 (rotina `agenda:repeticao-diaria`), até a data final, se houver.
- **Parar de repetir**, no detalhe do evento, encerra a série e remove as ocorrências futuras já criadas (inclusive do Google Agenda).

## Google Calendar

O sistema conecta com a conta do Google (OAuth) e sincroniza os dois lados: eventos criados no CRM vão pro Google, e existe uma rotina de sincronização que roda a cada poucos minutos. Um evento pode ser desconectado do Google a qualquer momento sem apagar o histórico no CRM.

## Cor por status

O status de um evento (agendado, realizado, cancelado) decide a cor mostrada no Google Calendar — dá pra ver de longe, sem abrir o CRM, o que já aconteceu e o que ainda está por vir.

## Eventos gerados automaticamente por outros módulos

Audiências do Dativo e de processos de correspondente **não são cadastradas duas vezes** — quando você marca uma audiência nesses módulos, o evento de agenda é criado/atualizado sozinho, sempre com o mesmo vínculo (mudar o status lá muda a cor aqui).

## FAQ

**Se eu editar o evento direto no Google, volta pro CRM?** A sincronização documentada é CRM → Google (o CRM marca "pendente" e um processo periódico envia). Trate o CRM como a fonte de verdade pra evitar divergência.

**Desconectar o Google apaga o histórico de eventos?** Não — desconecta só a sincronização; os eventos continuam no CRM normalmente.

## Links relacionados
- [Dativo](05-dativo.md) — audiências dativas
- [Repasses e parcerias](09-repasses.md) — audiências de correspondente

## Audiência copiada na agenda de mais de um usuário (07/10/2026)

A agenda é **por usuário**. Quando o Administrador e a Dra. Letícia estão ligados à mesma agenda Google, cada compromisso entra **uma vez para cada usuário** (mesmo `google_event_id`, `user_id` diferente). Isso é esperado: cada um vê a própria agenda.

O que **não pode** é o cliente ou o parceiro receberem o aviso duas vezes. Por isso, toda mensagem para fora (lembrete de audiência ao cliente no WhatsApp, aviso de audiência ao parceiro) agrupa as cópias: **uma audiência = o mesmo cliente (ou caso) no mesmo horário**. Regra em `src/services/audienciaUnica.ts` (testes em `tests/audienciaUnica.test.mjs`).

## Briefing da véspera da audiência trabalhista (desde 07/10/2026)

**Todo dia às 9h**, para cada **audiência trabalhista do dia seguinte**, o CRM monta um briefing e manda pelo **WhatsApp** (os números de "briefing_whatsapp", os mesmos do briefing matinal). O briefing também fica salvo nos documentos do caso.

**Conteúdo**, em 7 seções: fatos centrais; pedidos; provas e documentos-chave; perguntas (reclamante/preposto/testemunhas, conforme o lado da cliente); riscos; pontos controvertidos; providências pendentes. O que precisa ser checado vem marcado **"⚠️ CONFIRMAR"**, e cada informação cita a fonte entre parênteses.

**Fontes**, só as do caso: petição inicial, contestação, autos e demais documentos anexados ao caso (PDF ou imagem, os mais importantes primeiro, até ~14 MB, lidos pela IA Gemini); movimentações do processo; partes e anotações do caso. Documentos pessoais (RG, CPF, comprovante de residência) ficam de fora.

**Regras:**
- é audiência trabalhista quando o caso é da área trabalhista ou o número é da Justiça do Trabalho (segmento 5);
- cópias da mesma audiência na agenda de mais de um usuário geram um briefing só;
- audiência de amanhã **sem caso ligado** gera um aviso no WhatsApp, pedindo para ligar o caso.

**Sob demanda:** no caso, botão **"Briefing da audiência"**. Gera na hora (usa a próxima audiência do caso), com opção de enviar no WhatsApp.

Código: `src/services/briefingAudienciaRegras.ts` (regras, testes em `tests/briefingAudiencia.test.mjs`), `src/services/briefingAudienciaJob.ts` (fontes, IA, envio), cron `audiencia:briefing-vespera`, `POST /api/cases/:id/briefing-audiencia`.

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 07/10/2026 | Claude | Briefing automático da véspera da audiência trabalhista (WhatsApp, 9h) e botão no caso |
| 07/10/2026 | Claude | Lembretes e avisos de audiência agrupam as cópias da mesma audiência (agenda de mais de um usuário) — cliente e parceiro recebem uma vez só |
| 03/09/2026 | Claude | Criação do documento |
| 01/10/2026 | Claude | Lembretes pessoais por WhatsApp vão só para o número da Jessica |
| 30/09/2026 | Claude | Tipos Pessoal/Recado/Medicamento, repetição diária e aviso por WhatsApp na hora |

---
◀ [Documentos e peças](06-documentos.md) · [Visão geral](00-visao-geral.md) · Próximo: [Cobrança e parcelas](08-cobranca.md) ▶
