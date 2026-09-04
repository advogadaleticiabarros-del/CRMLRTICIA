# 04 · Processos e prazos

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado

## TL;DR

O sistema acompanha processos sozinho (DataJud/API do tribunal para cadastro manual, DJEN para descoberta automática por OAB), detecta prazo por palavra-gatilho e avisa sentença/acórdão por WhatsApp uma única vez por processo — sem duplicar aviso mesmo vindo de fontes diferentes.

## Contexto

Consulte pra entender de onde vem um processo que apareceu sozinho no sistema, por que um prazo foi criado (ou não), ou como funciona o aviso de marco processual.

## Duas formas de entrar um processo no radar

- **Cadastro manual** — você mesma cadastra um processo específico pra acompanhar. Nesse caso ele é consultado no **DataJud** (base pública do CNJ) ou na API pública do tribunal específico (TJES, TRT17, TRF2, TJPR, TRT9, TRF4, STJ, TST — o provedor certo é escolhido pelo número do processo).
- **Descoberta automática por OAB** — o sistema varre o **DJEN** (Diário de Justiça Eletrônico Nacional) periodicamente atrás de qualquer publicação endereçada ao seu número de OAB, mesmo em processos que você nunca cadastrou. Quando acha um processo novo, cadastra sozinho.

## Vínculo automático com cliente

Quando uma publicação do DJEN identifica com segurança quem é a parte representada (você é a única advogada intimada, ou só existe uma parte no processo), o sistema **cria o cliente automaticamente** e já vincula ao processo. Quando há ambiguidade (mais de uma parte possível), ele deixa em aberto pra cadastro manual — nunca chuta.

## Detecção automática de prazo

Toda movimentação nova é lida em busca de palavras-gatilho (sentença, acórdão, citação, embargos, intimação, decisão/despacho, publicação). Quando acha uma, o comportamento depende da fonte:

- **DJEN** → cria um "prazo a confirmar" na tela de Prazos, com o tipo sugerido e a data de início — fica pendente até alguém confirmar ou descartar.
- **DataJud/API do tribunal** → cria um alerta (sem presumir prazo automaticamente, essas fontes são menos confiáveis pra isso).

Uma vez confirmado ou descartado, o mesmo prazo não é recriado nas sincronizações seguintes.

## Avisos de alto valor no WhatsApp

Sentença publicada ou acórdão publicado avisam o escritório por WhatsApp **imediatamente**, além de qualquer prazo. Cada processo só avisa **uma vez** por tipo de marco — mesmo que o mesmo evento apareça de novo por outra fonte ou seja republicado pelo tribunal. Quando o processo não tem cliente vinculado, a mensagem tenta mostrar as partes identificadas na publicação em vez de só o número.

## Estagiário IA

Quando um prazo é detectado via DJEN, o sistema pode acionar um "estagiário IA" — análise automática da intimação com sugestão do que fazer, seguindo os mesmos playbooks configurados pra cada tipo de prazo.

## Fase sugerida do processo

O sistema tenta manter uma sugestão de fase processual (inicial, instrução, sentença, recurso, execução, encerrado) recalculada a partir do texto das movimentações mais recentes — é uma sugestão, não substitui a fase que você define manualmente no caso.

## FAQ

**Por que um processo apareceu no sistema sem eu ter cadastrado?** Foi descoberto pela varredura DJEN por OAB — qualquer publicação endereçada à sua OAB entra automaticamente, mesmo sem cadastro prévio.

**Um processo pode ficar sem cliente vinculado pra sempre?** Só até alguém vincular manualmente — acontece quando a publicação tem mais de uma parte possível e o sistema não arrisca adivinhar.

**Se a mesma sentença aparecer de novo numa sincronização futura, avisa de novo?** Não — cada processo só dispara aviso de "Sentença publicada"/"Acórdão publicado" uma vez, para sempre (salvo o caso raro de uma segunda sentença real no mesmo processo).

**O texto das movimentações sempre vem limpo?** A partir de 03/09/2026 sim — antes disso, publicações do DJEN podiam chegar com HTML bruto e entidades não decodificadas; hoje são limpas automaticamente na entrada (ver [Monitoramento automático](10-monitoramento.md)).

## Links relacionados
- [Dativo](05-dativo.md) — nomeação dativa é um tipo específico de publicação detectada
- [Monitoramento automático](10-monitoramento.md) — como a varredura funciona por baixo
- [WhatsApp](03-whatsapp.md) — onde os avisos de marco processual chegam

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento; registrada a correção de dedup de avisos e limpeza de HTML/entidades |

---
◀ [WhatsApp](03-whatsapp.md) · [Visão geral](00-visao-geral.md) · Próximo: [Dativo](05-dativo.md) ▶
