# 06 · Documentos e peças

**Área:** Atuação jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Documentos podem ser gerados por template (preenchimento automático) ou redigidos por IA (com sistema anti-invenção: dado não confirmado nos autos vira `[colchete]` visível e contado antes de abrir). Arquivo digital organizado em pastas por cliente, guardado no MEGA, com assinatura eletrônica integrada.

## Contexto

Consulte pra entender a diferença entre os dois jeitos de gerar documento, como funciona a camada anti-invenção da IA, ou onde um documento fica guardado.

## Duas formas de gerar um documento

- **Modelo com preenchimento automático** — um template com marcadores (`{{cliente_nome}}`, `{{advogada_oab}}`, etc.) que o sistema preenche sozinho com os dados do cliente, do caso e da advogada responsável ao gerar. Bom pra documentos padronizados: procuração, contrato, declaração.
- **Peça redigida por IA** — petições e minutas montadas pela IA a partir do caso (Estagiário IA e gerador de petição). Nesses casos, tudo que a IA **não conseguiu confirmar nos autos** aparece marcado entre colchetes no texto — o sistema conta essas pendências e mostra quantas e quais são antes de você abrir o documento, pra nunca protocolar algo com um dado inventado sem perceber.

## Arquivo digital (GED)

Pastas automáticas por cliente: contratos, procurações, documentos pessoais, processos, financeiro, audiências, e (específico do Dativo) nomeação, certidão de audiência, comprovante de atuação, outros. Documentos têm status (pendente, recebido, assinado, arquivado) e ficam guardados no MEGA (armazenamento externo, não ocupa disco do servidor).

## Assinatura

Documentos podem ser enviados pra assinatura eletrônica direto pelo sistema, com acompanhamento de quem já assinou.

## Modelos de peça (banco de modelos do escritório)

Além dos templates de preenchimento automático, existe um banco de modelos de peça por área jurídica — a IA busca o modelo mais adequado ao caso na hora de montar uma minuta, em vez de escrever do zero toda vez.

## FAQ

**Os colchetes `[assim]` num documento gerado por IA são um erro?** Não — é proposital. Marca exatamente o que a IA não conseguiu confirmar nos autos, pra você revisar antes de protocolar. Quantidade e exemplos aparecem antes de abrir o documento.

**Um documento gerado por template pode ter campo em branco?** Sim — se o dado não existir no cadastro do cliente/caso (ex.: profissão vazia), o marcador simplesmente vira texto vazio no documento final.

**Onde ficam os arquivos de verdade?** No MEGA (armazenamento externo), não no disco do servidor — o CRM guarda a referência e os metadados (pasta, status, cliente vinculado).

## Links relacionados
- [Clientes e cadastro](01-clientes.md) — dados usados no preenchimento automático
- [Dativo](05-dativo.md) — pastas específicas e upload por câmera
- [Leads e comercial](02-leads.md) — propostas comerciais geradas aqui

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Dativo](05-dativo.md) · [Visão geral](00-visao-geral.md) · Próximo: [Agenda e compromissos](07-agenda.md) ▶
