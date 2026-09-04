# 01 · Clientes e cadastro

**Área:** Atendimento e captação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado

## TL;DR

Todo cliente tem uma ficha única que consolida processos, financeiro, documentos e histórico — inclusive uma checagem opcional de conflito de interesses antes de cadastrar alguém novo. Módulo central: quase todo o resto do sistema se pendura em um registro de cliente.

## Contexto

Consulte este documento sempre que precisar saber o que o cadastro de cliente guarda, como a ficha consolidada é montada, ou quando um lead/demanda dativa cria (ou não) um cliente sozinho.

## O que é um "cliente" aqui

Cadastro com: nome, tipo (Pessoa Física ou Jurídica), CPF/CNPJ, e-mail, telefone, endereço, observações internas e status (**ativo**, **inativo** ou **prospecto** — usado para pré-cadastros automáticos, ver [Monitoramento automático](10-monitoramento.md)).

## Ficha do cliente

Ao abrir um cliente, o sistema monta uma **ficha consolidada** com tudo que existe sobre ele em um lugar só:

- **Qualificação jurídica pronta pra copiar** — o sistema já monta a frase de qualificação da parte (nome, nacionalidade, estado civil, profissão, RG, CPF, endereço) a partir do que foi cadastrado, pronta pra colar numa petição.
- Todos os processos vinculados, com fase e etapa de produção de cada um.
- Parcelas e receitas — o que já foi pago e o que ainda falta receber.
- Documentos do cliente.
- Linha do tempo — histórico de tudo que aconteceu (mensagens, mudanças de etapa, notas), mais recente primeiro.

## Checagem de conflito de interesses

Antes de cadastrar alguém novo, o sistema pode checar o nome/CPF contra: clientes já cadastrados, leads no funil, títulos/descrições de processos existentes (onde a parte contrária costuma aparecer escrita) e assistidos de demandas dativas. É um **aviso**, não um bloqueio — a decisão final é sempre da advogada.

## Onde os dados de cliente aparecem em outros módulos

- **Leads**: quando um lead vira cliente, o histórico de qualificação (RG, estado civil, profissão, resumo do caso) migra junto.
- **WhatsApp**: cada conversa pode estar vinculada a um cliente (painel de detalhes do contato mostra a ficha resumida).
- **Financeiro**: parcelas e receitas sempre pertencem a um `client_id`.
- **Dativo**: demandas dativas podem ou não ter cliente vinculado (quando descobertas automaticamente via DJEN sem nome claro, ficam sem vínculo até revisão manual).

## LGPD

Todo acesso à ficha completa de um cliente é registrado (quem acessou, quando) — não é visível na tela, é um log interno de auditoria.

## FAQ

**Se eu cadastrar o mesmo CPF duas vezes, o sistema bloqueia?** Não bloqueia — a checagem de conflito de interesses é um aviso, mostrado antes de salvar, mas a decisão final é sua.

**Posso ter um cliente sem processo nenhum?** Sim — o cadastro de cliente é independente de ter processo, caso ou demanda dativa vinculada.

**A qualificação jurídica pronta pra copiar sempre vem completa?** Só com o que já foi preenchido — campos vazios (RG, estado civil, profissão) simplesmente não entram na frase montada.

## Links relacionados
- [Leads e comercial](02-leads.md) — como um lead vira cliente
- [Dativo](05-dativo.md) — quando uma demanda dativa cria cliente automaticamente
- [Cobrança e parcelas](08-cobranca.md) — financeiro do cliente

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Visão geral](00-visao-geral.md) · Próximo: [Leads e comercial](02-leads.md) ▶
