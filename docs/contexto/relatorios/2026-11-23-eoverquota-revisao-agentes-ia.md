# 23/11/2026 — Erro EOVERQUOTA e revisão dos agentes de IA

## Pedido
Jessica encaminhou o aviso "🐞 Erro no servidor do CRM — já aconteceu 7 vezes: EOVERQUOTA (-17): Request over quota" e pediu: "Revise os agentes de IA e corrija tudo que for necessário: não deixe margem para erros."

## Diagnóstico
- **EOVERQUOTA:** as 7 ocorrências (erro 31 do rastreador) foram de 21/11 05h04 a 23/11 05h04 UTC, todas no horário do backup, **antes** da correção do MEGA lotado de hoje cedo. O motivo de virar "erro solto": o envio ao MEGA continuava depois do tempo limite, e a recusa tardia ficava sem tratamento (`unhandledRejection`).
- **Agentes:** 14 dias de `job_runs`, log de erros desde 16/10 (486 MB) e log de saída. Nenhuma rotina de agente falhou, fora o Google e o backup. Mas havia falhas **escondidas** em rotinas "ok" e pontos frágeis na camada de IA.

## O que foi corrigido
| Problema | Correção |
|---|---|
| Envio ao MEGA seguia depois do tempo limite e o erro tardio escapava | `comTempoLimite` cancela o envio e trata o erro; ouvinte de erro no envio |
| `producao:pastas-drive`: 72 rodadas "ok" com 4/4 casos falhando (Google desconectado), sem aviso | Falha total vira erro e entra no aviso de reconexão do Google |
| Mídia do WhatsApp com legenda que falhava nunca era recuperada (Analista/Coletor sem o arquivo) | Marca "falhou ao baixar" sempre junto da legenda; a recuperação devolve a legenda |
| Chamadas de IA sem tempo limite (agente podia travar para sempre) | Tempo limite por tipo em todas as 9 chamadas diretas (`iaHttp.ts`) |
| Resposta vazia da IA (bloqueio, limite, raciocínio) contava como sucesso | Vazio vira falha com motivo e entra o provedor reserva (Gemini↔Groq; OpenAI tenta o próximo modelo) |
| Erro do provedor em HTML quebrava a leitura | Leitura tolerante (`lerJsonIa`) |
| Clima do briefing falhava com "service overloaded" | 1 nova tentativa após 4 s |

## Verificado
- Build ok; lint com 0 erros; `npm test`: 1.675 testes, 1.641 passaram, 0 falharam (os demais precisam de banco e rodam no CI).
- Testes novos em `tests/iaHttp.test.mjs` (5), `tests/corpoMidiaWhatsapp.test.mjs` (3), `tests/backupService.test.mjs` (+2) e `tests/avisoConexaoGoogle.test.mjs` (+1). `tests/whatsappMidiaEnviadaPeloCelular.test.mjs` foi ajustado.
- Produção: ver o ESTADO.md (deploy e conferência).

## Decisões
- Não liguei a reserva OpenAI → Gemini/Groq nas chamadas que pedem OpenAI explicitamente (redação de peça). Trocar de modelo em silêncio numa peça jurídica é pior do que falhar e avisar. Dentro da OpenAI, a falha passa ao próximo modelo da lista.
- As falhas antigas de mídia com legenda não são recuperáveis (o tipo da mídia não foi guardado).

## Pendente
- **Google:** o Gmail da parceria (que também alimenta as pastas do Drive) e o e-mail dos tribunais continuam desconectados. A Agenda voltou hoje às 9h. Reconectar em Parcerias → Reconectar e em Configurações → Monitoramento por e-mail. Com a correção, o aviso no WhatsApp passa a citar também as pastas do Drive.
- Erros antigos no rastreador (19/10, 26/10, 29/10, 04/11), sem repetição desde então: ficam para conferir quando a tela voltar a mostrar.
