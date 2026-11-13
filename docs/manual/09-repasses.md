# 09 · Repasses e parcerias

**Área:** Financeiro · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Três relações comerciais diferentes com terceiros: correspondente jurídico (Letícia atuando pra outro escritório), parceiros (indicação/co-atuação, com login e split próprio) e repasses (dinheiro saindo pra quem indicou/atuou). Separado do financeiro normal pra não contar duas vezes.

## Contexto

Consulte pra entender a diferença entre correspondente, parceiro e repasse, ou o que um parceiro enxerga no portal dele.

## Correspondente jurídico

Quando a Dra. Letícia atua **como correspondente** — indo a uma audiência a pedido de outro advogado/escritório, como advogada ou preposta —, isso é acompanhado à parte do restante do caixa: quem pediu (o "pagador"), o valor combinado, e um status próprio (agendada → realizada → faturada → paga → cancelada). A audiência sincroniza com a agenda/Google Calendar automaticamente, igual às audiências normais e do Dativo.

O histórico de correspondente pode ser filtrado por status e por um ou mais pagadores (seleção múltipla com busca, desde 04/09/2026) antes de emitir a **Guia de cobrança**.

## Parceiros (indicação/co-atuação)

Um **parceiro** é alguém (outro advogado ou escritório) que indica clientes ou atua junto em um caso, com um percentual de divisão combinado: honorário de êxito, percentual do parceiro e percentual de sucumbência, cada um pode ter seu próprio valor combinado. Parceiros têm **login próprio** (portal do parceiro) e enxergam só o que é deles: casos em andamento, pendências da produção da peça, valores a receber — nunca os dados de outros clientes/parceiros.

Desde 22/09/2026, a ficha do parceiro também tem um campo de **telefone (WhatsApp)** — cadastrando, o CRM reconhece sozinho quando esse parceiro manda mensagem e etiqueta a conversa como "Parceiro" automaticamente (ver [WhatsApp](03-whatsapp.md#triagem-automática-de-conversa-nova)). Sem o telefone cadastrado, o reconhecimento não funciona pra ele.

## Repasses

Quando o dinheiro precisa ser **repassado pra fora** (pra quem indicou, por uma audiência feita por correspondente, por diligência) — quatro tipos: indicação, audiência, correspondente, diligência. Status: pendente → processando → repassado (ou cancelado). Cada repasse pode estar ligado a um caso específico, com data de vencimento e histórico de auditoria financeira igual às parcelas.

## Por que separado do financeiro normal

Manter isso em módulos próprios (em vez de misturar com as parcelas dos seus próprios clientes) evita contar duas vezes: dinheiro que passa pelo caixa mas não é honorário do escritório, ou honorário do escritório que já nasce comprometido com um repasse.

## FAQ

**Um parceiro vê os dados de outros clientes do escritório?** Não — o portal do parceiro é restrito ao que é dele: casos, pendências e valores próprios, nada de outros clientes/parceiros.

**Correspondente e repasse são a mesma coisa?** Não — correspondente é quando a Letícia é quem presta o serviço pra outro escritório (dinheiro entra). Repasse tipo "correspondente" é o caso inverso: quando outro profissional presta serviço pra ela e o dinheiro sai.

## Links relacionados
- [Cobrança e parcelas](08-cobranca.md) — projeção de caixa inclui essas frentes
- [Agenda e compromissos](07-agenda.md) — audiências de correspondente sincronizadas
- [Usuários e acesso](12-usuarios.md) — perfil `parceiro`/`parceiro_portal`

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |
| 04/09/2026 | Claude | Filtro de pagador do Correspondente virou multi-seleção com busca (era `<select multiple>` nativo, exigia Ctrl/Cmd+clique) |
| 22/09/2026 | Claude | Ficha do parceiro ganha campo de telefone (WhatsApp), usado pra reconhecimento automático de conversa |
| 13/11/2026 | Claude | Fechamento do caso com RPV: valores (repasse, cliente, parceria, nosso caixa), recibo e vídeo-depoimento; caso encerrado |

---
◀ [Cobrança e parcelas](08-cobranca.md) · [Visão geral](00-visao-geral.md) · Próximo: [Monitoramento automático](10-monitoramento.md) ▶

## Repasse "sem data" (02/10/2026)

Repasse a parceiro pode ficar **sem vencimento** ("sem data" na lista) enquanto o valor ainda não entrou, como no êxito da parceria Infinity Law (30% de honorários, metade para cada). O vencimento é definido depois, ao editar o repasse. A migration 151 permite `repasses.data_vencimento` nulo. O registro de êxito/sucumbência da parceria (`POST /api/partners/cases/:id/resultado`) agora cria a receita e o repasse sem data, em vez de "hoje + 7 dias".

## Fechamento do caso com RPV (13/11/2026)

Quando o RPV de um caso de parceria sai, a Dra. saca o valor inteiro e transfere à parceira a parte da cliente mais a parte da parceria. A parceira paga a cliente e manda o **recibo** e um **vídeo-depoimento** da cliente falando do recebimento.

**Onde:** Parcerias → escolha o parceiro → botão **"Finalizar (RPV)"** na linha do caso. Depois de salvo, o botão vira **"Fechamento"** (para corrigir valores ou anexar o que faltou).

**O que se informa:** valor sacado, data do saque, percentuais (vêm do acordo do parceiro: Infinity Law 30% de honorários, metade para cada), data do repasse, data em que a cliente recebeu, recibo e vídeo (arquivo ou link do Drive). Se a cliente ou a parceria receberam valor diferente do cálculo, abra "Valores diferentes do cálculo?" e informe o valor real.

**A conta (aparece ao vivo no formulário):**
- vai para a cliente = valor sacado × (100% − honorários);
- honorários = valor sacado − parte da cliente;
- fica com a parceria = honorários × fatia da parceria;
- **repasse à parceira** = cliente + parceria (a transferência que a Dra. faz);
- **entra no nosso caixa** = honorários − parceria.

Exemplo: RPV de R$ 10.000,00 → cliente R$ 7.000,00; parceria R$ 1.500,00; repasse R$ 8.500,00; nosso caixa R$ 1.500,00.

**O que o CRM faz ao salvar:**
- **Financeiro:** a receita dos honorários (R$ 3.000,00 no exemplo) entra como recebida na data do saque. O repasse da parceria (R$ 1.500,00) entra como repassado. A descrição do repasse mostra a transferência total e a divisão. O dinheiro da cliente só passa pela conta e não vira receita: fica registrado no fechamento.
- Se o caso já tinha "Êxito" lançado pelo botão "Êxito / Sucumb." (receita e repasse pendentes sem data), esses lançamentos são **reaproveitados**, sem duplicar. Salvar de novo atualiza os mesmos lançamentos.
- **Caso finalizado:** o caso fica com status `encerrado`, resultado "procedente" (se ainda não houver outro) e valor obtido = valor sacado. A etapa da esteira não muda ("Concluído" ali significa só que a peça foi protocolada). **Nenhuma mensagem é enviada à cliente.**
- **Comprovantes:** recibo (PDF ou foto, até 15 MB) e vídeo (até 500 MB) vão para a pasta do caso no Drive (Raiz → Cliente → Caso) e aparecem nos documentos do caso, pasta Financeiro. Se o Drive falhar, o recibo fica guardado no próprio CRM. Para o vídeo, cole o link. Na lista, o caso aparece como "Finalizado", com "falta recibo" ou "falta vídeo" enquanto faltar um deles.

Código: `src/services/fechamentoRpvParceria.ts` (regra), `fechamentoRpvParceriaMysql.ts` (banco), rotas `/api/partners/cases/:id/fechamento` em `src/routes/partners.ts`; migration 177 (`parceria_fechamentos`). O envio do arquivo passa pelo nginx com limite próprio de 500 MB só nesse endereço.
