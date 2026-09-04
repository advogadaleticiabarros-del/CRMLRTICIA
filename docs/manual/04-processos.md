# 04 · Processos e prazos

O sistema acompanha processos sozinho, sem precisar consultar o tribunal manualmente todo dia.

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

---
◀ [WhatsApp](03-whatsapp.md) · [Visão geral](00-visao-geral.md) · Próximo: Dativo ▶
