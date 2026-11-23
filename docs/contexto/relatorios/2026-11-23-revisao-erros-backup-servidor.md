# 23/11/2026 — Revisão de erros: backup, servidor e sistema

## Pedido
"Revise o sistema, backup e servidor estão dando alguns erros! Não deixe que isso aconteça." (Jessica)

## O que foi encontrado
| Problema | Desde | Situação |
|---|---|---|
| MEGA lotado (102%); envio do backup travava após 25 min | aviso de 85% em 16/11; sem cópia na nuvem desde 21/11 | **corrigido** (código) |
| Rotação do MEGA só rodava depois de envio bem-sucedido, então o MEGA nunca se esvaziava | sempre | **corrigido** |
| Ficha automática falhava com `Incorrect date value: ''` em `birth_date` | 11/2026 | **corrigido** |
| `crm-juridico-error.log` com 486 MB, sem rotação | sempre | **corrigido** (logrotate na VPS) |
| Google `invalid_grant` (Agenda, Gmail da parceria, e-mail dos tribunais) | 16/11 e 20/11 | **precisa de pessoa** (reconectar) |
| WhatsApp caiu algumas vezes | — | conectado no momento da revisão |

Servidor: disco em 48%, 3 GB de memória livre, nenhum processo morto por falta de memória em 7 dias, nenhum serviço do sistema com falha. As cópias no servidor (`~/backups-crm`, 14 dias) saíram em todos os horários.

## O que foi feito
- `src/services/backupRegras.ts`: `planoEspacoMega`, que decide o que apagar para a cópia nova caber com o MEGA em no máximo 80%. Ordem: rotação normal → extras do mesmo dia → diárias antigas → mensais. As 3 mais recentes nunca saem.
- `src/services/backupService.ts`: `enviarParaMega` chama esse plano **antes** do envio. Se nem assim couber, não envia e avisa "MEGA sem espaço".
- `src/services/fichaServico.ts`: `preencherSeVazio`, que usa só `COALESCE` para `birth_date`.
- VPS: `/etc/logrotate.d/pm2-crm-juridico` (diário ou ao passar de 50 MB, 14 cópias comprimidas). Rotação forçada uma vez.
- Testes: 4 novos em `tests/backupRegras.test.mjs`, usando o retrato real das 35 cópias do MEGA, e `tests/fichaServicoSql.test.mjs`.
- Documentação: `docs/manual/13-infraestrutura.md`, `docs/manual/14-runbook.md` (3 incidentes novos e a volta do `invalid_grant`), com cópia no espelho do Obsidian.

## Verificado
- `npm run build` ok; `npm run lint`: 0 erros; `npm test`: 1.653 testes, 1.619 passaram, 0 falharam (os pulados precisam de banco e rodam no CI).
- Listagem do MEGA (somente leitura): 35 cópias, 21,86 de 21,47 GB, todas de backup.
- **Em produção, depois do deploy (fc4da7c, CI verde):** backup rodado à mão às 08h35 UTC. MEGA ok ("10 cópias antigas apagadas para abrir espaço"), local ok, verificação ok (138 tabelas, 1.598 MB de SQL). O MEGA foi de 21,86 GB (102%) para 15,14 GB (70%), com 24 cópias, mantidas as mensais de 30/09 e 31/10.

## Decisões
- O histórico do MEGA vira "o que couber", em vez de 12 meses fixos. A alternativa (parar de enviar) deixaria os dados num lugar só. O servidor mantém 14 dias à parte.
- A meta de 80% deixa o aviso diário de 85% quieto quando está tudo normal. Se ele aparecer, é sinal real.
- Rotação de log pelo logrotate do sistema, e não pelo módulo `pm2-logrotate`: nada novo para instalar no Node.

## Pendente
- **Jessica ou Dra.:** reconectar o Google (Configurações → Monitoramento por e-mail; Agenda → Reconectar Google; Parcerias → Reconectar) e, no Google Cloud Console → Tela de consentimento OAuth, deixar o app "Em produção". Em modo Teste, a autorização cai a cada 7 dias.
- **Decisão da Dra.:** tirar a mídia do WhatsApp do banco (cada cópia cairia para cerca de 180 MB) ou assinar um plano maior do MEGA, para voltar a ter meses de histórico na nuvem.

## Próxima sessão
Conferir no aviso diário das 20h30 se as 3 cópias do dia chegaram ao MEGA e se o uso ficou abaixo de 85%.
