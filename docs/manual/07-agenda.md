# 07 · Agenda e compromissos

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Agenda com sincronização de mão dupla com o Google Calendar e cor por status — audiências do Dativo e de correspondente nascem e se atualizam sozinhas, sem cadastro duplo.

## Contexto

Consulte pra entender como um evento chega no Google Calendar, o que a cor de um evento significa, ou por que uma audiência apareceu na agenda sem você ter cadastrado ali.

## Tipos de evento

Reunião 🤝, Audiência ⚖️, Compromisso 📌 — cada um com ícone próprio nas telas que listam a agenda (WhatsApp, briefing, etc.).

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

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Documentos e peças](06-documentos.md) · [Visão geral](00-visao-geral.md) · Próximo: [Cobrança e parcelas](08-cobranca.md) ▶
