# 01 · Clientes e cadastro

**Área:** Atendimento e captação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Todo cliente tem uma ficha única que consolida processos, financeiro, documentos e histórico — inclusive uma checagem opcional de conflito de interesses antes de cadastrar alguém novo. Módulo central: quase todo o resto do sistema se pendura em um registro de cliente.

## Contexto

Consulte este documento sempre que precisar saber o que o cadastro de cliente guarda, como a ficha consolidada é montada, ou quando um lead/demanda dativa cria (ou não) um cliente sozinho.

## O que é um "cliente" aqui

Cadastro com: nome, tipo (Pessoa Física ou Jurídica), CPF/CNPJ, e-mail, telefone, data de nascimento, endereço, observações internas e status (**ativo**, **inativo** ou **prospecto** — usado para pré-cadastros automáticos, ver [Monitoramento automático](10-monitoramento.md)).

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

Todo acesso à ficha completa de um cliente ou processo é registrado (quem acessou, quando, IP) — grava sozinho, sem precisar de nenhuma ação de quem está usando o sistema. Desde 23/09/2026 dá pra consultar em **Configurações → Log de acesso a dados pessoais (LGPD)**: total de registros, acessos hoje, ranking por pessoa, e uma busca por nome de cliente. Antes desse painel, só dava pra ver rodando SQL direto no banco — os dados já vinham sendo gravados desde bem antes (migration 059), só não existia tela pra consultar.

**Correção (24/09/2026):** até então, só a tela simples de detalhe do cliente gerava esse log — mas o sistema abre o cliente pela ficha completa (`/ficha`, que traz CPF, endereço, financeiro e documentos), e essa rota nunca tinha gerado registro nenhum. Ou seja, o dado mais sensível de todos não tinha trilha de auditoria. Agora a ficha completa também registra o acesso.

## Validação de CPF/CNPJ

Desde 24/09/2026, o cadastro/edição de cliente confere o dígito verificador do CPF/CNPJ digitado (o mesmo cálculo usado pela Receita Federal) — um número com dígito errado (ex.: digitado errado sem querer) é recusado com aviso claro, antes de salvar. Campo continua opcional: deixar vazio é permitido. Isso não muda a checagem de conflito de interesses (que continua um aviso, nunca bloqueio) — é uma validação de formato, diferente.

## FAQ

**Se eu cadastrar o mesmo CPF duas vezes, o sistema bloqueia?** Não bloqueia — a checagem de conflito de interesses é um aviso, mostrado antes de salvar, mas a decisão final é sua.

**Um CPF/CNPJ com dígito errado é aceito?** Não, desde 24/09/2026 — o sistema confere o dígito verificador antes de salvar. Isso é diferente de duplicidade: pega número inválido/digitado errado, não impede reaproveitar um CPF já cadastrado em outro registro.

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
| 23/09/2026 | Claude | Log de acesso LGPD ganha tela própria em Configurações (antes só existia gravação, sem consulta) |
| 24/09/2026 | Claude | Ficha completa do cliente (`/ficha`) passa a gerar log de acesso LGPD — só a tela simples de detalhe gerava, mas é a ficha completa que o sistema realmente usa pra abrir o cliente |
| 24/09/2026 | Claude | Campo de data de nascimento no formulário de cadastro/edição de cliente — a coluna já existia no banco (usada no aniversariante do briefing), mas só era preenchida por fluxos específicos |
| 24/09/2026 | Claude | CPF/CNPJ passa a ter o dígito verificador conferido antes de salvar (`src/utils/cpfCnpj.ts`) — antes aceitava qualquer texto |

---
◀ [Dashboard](00c-dashboard.md) · [Visão geral](00-visao-geral.md) · Próximo: [Leads e comercial](02-leads.md) ▶
