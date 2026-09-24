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

**Tolerância a erro de digitação (desde 24/09/2026):** além da busca exata, a checagem contra clientes e leads também pega nomes com grafia parecida (ex.: uma letra trocada) — aparece marcado como "grafia parecida" no resultado. Não resolve apelido nem nome de solteira/casada (isso exigiria uma lista de sinônimos por pessoa, que o sistema não tem).

## Onde os dados de cliente aparecem em outros módulos

- **Leads**: quando um lead vira cliente, o histórico de qualificação (RG, estado civil, profissão, resumo do caso) migra junto.
- **WhatsApp**: cada conversa pode estar vinculada a um cliente (painel de detalhes do contato mostra a ficha resumida).
- **Financeiro**: parcelas e receitas sempre pertencem a um `client_id`.
- **Dativo**: demandas dativas podem ou não ter cliente vinculado (quando descobertas automaticamente via DJEN sem nome claro, ficam sem vínculo até revisão manual).

## LGPD

Todo acesso à ficha completa de um cliente ou processo é registrado (quem acessou, quando, IP) — grava sozinho, sem precisar de nenhuma ação de quem está usando o sistema. Desde 23/09/2026 dá pra consultar em **Configurações → Log de acesso a dados pessoais (LGPD)**: total de registros, acessos hoje, ranking por pessoa, e uma busca por nome de cliente. Antes desse painel, só dava pra ver rodando SQL direto no banco — os dados já vinham sendo gravados desde bem antes (migration 059), só não existia tela pra consultar.

**Retenção (desde 24/09/2026):** esse log é apagado automaticamente depois de **5 anos** (mesma faxina mensal de LGPD que já cuida de outras tabelas, ver `src/services/retentionService.ts`). Prazo escolhido porque é o mesmo prazo prescricional que a própria LGPD usa pra apuração administrativa da ANPD (art. 52, §5º) — o log precisa sobreviver esse tempo pra provar conformidade se for cobrado, mas guardar pra sempre depois disso só aumenta o risco (o log carrega IP e nome de cliente). Antes dessa correção, `access_logs` não tinha prazo nenhum — crescia indefinidamente.

**Correção (24/09/2026):** até então, só a tela simples de detalhe do cliente gerava esse log — mas o sistema abre o cliente pela ficha completa (`/ficha`, que traz CPF, endereço, financeiro e documentos), e essa rota nunca tinha gerado registro nenhum. Ou seja, o dado mais sensível de todos não tinha trilha de auditoria. Agora a ficha completa também registra o acesso.

## CEP preenche o endereço sozinho

Desde 24/09/2026, digitar um CEP completo no cadastro/edição de cliente preenche o campo Endereço sozinho (rua, bairro, cidade/UF), usando a ViaCEP (API pública, gratuita). Número e complemento continuam manuais — a ViaCEP não devolve isso. Se o CEP não existir ou a busca falhar, nada trava: o campo de endereço continua editável normalmente.

## CNPJ preenche razão social e endereço sozinho

Desde 24/09/2026, com Tipo = Pessoa Jurídica, digitar um CNPJ completo preenche nome e endereço automaticamente (BrasilAPI, gratuita). Só preenche o nome se o campo ainda estiver vazio — nunca sobrescreve um nome já digitado. Se o CNPJ não existir ou a busca falhar, nada trava.

## Consentimento LGPD

Desde 24/09/2026, o cadastro/edição de cliente tem uma marcação explícita: "Cliente autorizou o tratamento dos dados pessoais (LGPD)". Marcar registra a data (mostrada ao lado, ex.: "registrado em 24/09/2026") — marcar de novo depois não muda essa data, ela é sempre a da primeira vez. Desmarcar registra a revogação (a data some). Antes disso, só existia opt-in de newsletter para lead — nada formalizava o consentimento do cliente em si.

## Enviar documento direto da ficha

Desde 24/09/2026, a ficha do cliente tem um botão **"Enviar documento"** — envia foto/PDF direto pra pasta "documentos pessoais" do GED (mesmo mecanismo da Central de Documentos), sem precisar sair da ficha e ir até a tela de Documentos.

## Baixar dados do cliente (LGPD)

Desde 24/09/2026, a ficha do cliente tem um botão **"Baixar dados (LGPD)"** — gera um arquivo com tudo que o escritório guarda sobre aquela pessoa (cadastro, processos, parcelas/receitas, metadados de documento, histórico), pra atender um pedido de portabilidade (LGPD art. 18) sem precisar consultar o banco na mão. O próprio download fica registrado no log de acesso (Configurações → Log de acesso a dados pessoais).

## Validação de CPF/CNPJ

Desde 24/09/2026, o cadastro/edição de cliente confere o dígito verificador do CPF/CNPJ digitado (o mesmo cálculo usado pela Receita Federal) — um número com dígito errado (ex.: digitado errado sem querer) é recusado com aviso claro, antes de salvar. Campo continua opcional: deixar vazio é permitido. Isso não muda a checagem de conflito de interesses (que continua um aviso, nunca bloqueio) — é uma validação de formato, diferente.

## Portal do cliente: atualizar os próprios dados de contato

Desde 24/09/2026, o Portal do Cliente tem uma seção "Meus dados de contato" onde o próprio cliente atualiza e-mail, telefone e endereço sozinho — antes precisava pedir pra advogada fazer manualmente. Escopo restrito de propósito: nome, CPF/CNPJ e status **não** ficam editáveis pelo cliente (mudam a identificação jurídica/qualificação da parte — continuam só no cadastro interno, feito pela equipe).

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
| 24/09/2026 | Claude | Botão "Baixar dados (LGPD)" na ficha do cliente — atende pedido de portabilidade (art. 18) sem precisar de SQL manual; conclui as 5 ideias de prioridade alta da auditoria do módulo Clientes |
| 24/09/2026 | Claude | Campo de CEP no cadastro/edição — preenche o endereço sozinho via ViaCEP (1ª ideia de prioridade média) |
| 24/09/2026 | Claude | CNPJ (Pessoa Jurídica) preenche razão social e endereço sozinho via BrasilAPI |
| 24/09/2026 | Claude | Checagem de conflito de interesses ganha tolerância a erro de digitação (distância de edição) contra clientes e leads — `src/utils/nomeSimilar.ts` |
| 24/09/2026 | Claude | Botão "Enviar documento" direto na ficha do cliente — reaproveita o upload já existente da Central de Documentos |
| 24/09/2026 | Claude | Consentimento LGPD explícito no cadastro (`clients.lgpd_consent_at`, migration 134) — conclui as 5 ideias de prioridade média da auditoria do módulo Clientes |
| 24/09/2026 | Claude | `access_logs` ganha política de retenção (5 anos) na faxina mensal de LGPD — antes não tinha prazo nenhum e crescia pra sempre (`src/services/retentionService.ts`) |
| 24/09/2026 | Claude | Portal do Cliente ganha autoatendimento pra atualizar e-mail/telefone/endereço (`PUT /api/portal/me`) — antes o portal só consultava, qualquer correção dependia de pedir pra advogada |

---
◀ [Dashboard](00c-dashboard.md) · [Visão geral](00-visao-geral.md) · Próximo: [Leads e comercial](02-leads.md) ▶
