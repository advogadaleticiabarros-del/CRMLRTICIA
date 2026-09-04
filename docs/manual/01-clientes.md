# 01 · Clientes e cadastro

Módulo central do CRM — quase todo o resto do sistema (processos, financeiro, WhatsApp, documentos) se pendura em um registro de cliente.

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

---
◀ [Visão geral](00-visao-geral.md) · Próximo: Leads e comercial ▶
