# 31/10/2026 — GPT-6 Sol só na redação da peça, GPT-6 Luna no resto

## Pedido
A Jessica comparou os modelos novos da OpenAI (GPT-6 Astra, GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Luna) e pediu: "Usar o GPT-6 Sol só na redação da peça... e todo o resto continua no Luna barato". Durante a tarefa, ela acrescentou: "vamos fazer o possível para ter qualidade e economizar ao mesmo tempo".

## Feito
- `src/services/openaiModelos.ts` (novo): escolhe o modelo da OpenAI por nível de trabalho (`baixo`, `medio`, `alto`, `redacao`, `forte`), com uma lista de reserva para cada nível.
  - Redação: GPT-6 Sol com esforço alto → Sol sem o esforço → Luna com esforço alto.
  - Resto: GPT-6 Luna → GPT-5.6 Luna.
  - Modelo recusado pela API (403/404, ou 400 de modelo ou parâmetro) não é tentado de novo até o CRM reiniciar. Falha passageira (limite, servidor, rede, texto grande demais) só passa para a próxima tentativa.
- `src/services/aiAssistant.ts`: `callOpenAI` foi trocado pelo módulo. Novo provedor `openai-redacao`; `openai-smart` passa a usar o GPT-6 Sol.
- `src/services/esteiraPecaMysql.ts`: o nível `redacao` da esteira pede `openai-redacao`.
- Uso registrado: o Sol conta como `openai_smart` e o Luna como `openai` (painel de IA paga).
- Docs: `docs/manual/06-documentos.md` (passo 6 + Changelog), `docs/manual/17-decision-log.md`, `docs/contexto/LEIA-PRIMEIRO.md` (linha da IA) e o espelho do Obsidian.

## Verificado
- `tests/openaiModelos.test.mjs`: 10 testes passam (níveis, reserva, modelo riscado, falha passageira, texto grande, sem chave, `.env`, esteira).
- `npm run build` OK; `npm run lint` com 0 erros; `npm test` com 1355 testes e 0 falhas.
- **Não verificado:** os nomes `gpt-6-sol` e `gpt-6-luna` e o aceite de `reasoning_effort` no Sol. A chave OpenAI do `.env` local é antiga (a API respondeu "Incorrect API key") e a leitura do `.env` da VPS foi negada pela permissão. A reserva garante que a peça sai mesmo se o nome estiver errado.
- **Não verificado:** se a VPS define `OPENAI_MODEL`. Se definir (ex.: `gpt-5.6-luna`), esse valor manda no resto, e o Luna novo só entra se a variável for trocada ou removida.

- **Verificado em produção (16:20):** `ia_uso_diario` hoje: `openai` 119, `openai_smart` 2. O Sol atendeu a redação (só ela conta `openai_smart`, e só em caso de sucesso).
- O `.env` da VPS tinha `OPENAI_MODEL=gpt-5.6-luna` e `OPENAI_MODEL_SMART=gpt-5.6-sol` (print da Jessica); a pedido dela ("faça isso por mim"), as duas linhas foram apagadas (cópia em `.env.bak-20261031-1321`) e o PM2 foi reiniciado: online, sem `OPENAI_MODEL` no processo, site com HTTP 200.

## Decisões e porquês
- Terra descartado: custa 4 a 5 vezes o Luna, sem ganho claro na peça. Astra descartado: custa 5 vezes o Sol. Os preços vêm de sites de terceiros (lançamentos de set. e out./2026); conferir na página oficial.
- O padrão passou para o GPT-6 Luna (US$ 0,10/0,50 por milhão de tokens contra US$ 0,20/1,20 do 5.6), por ser mais barato e mais novo, conforme o "economizar".
- Ficaram no `OPENAI_MODEL || 'gpt-5.6-luna'` de antes, sem reserva: a leitura com visão (`aiLerArquivo`) e o `briefingAudienciaJob`.

## Pendente
- Não verificado ainda: uma chamada real do Luna depois do reinício caindo no `gpt-6-luna` (e não na reserva 5.6). Se o GPT-6 Luna for recusado, o CRM usa o 5.6 sozinho, sem quebrar nada.
- O painel do Escritório virtual soma `openai` e `openai_smart` num gráfico só; para separar o Sol do Luna hoje, só pela consulta a `ia_uso_diario` (oferecido separar no painel, não pedido).
- A chave local do `.env` está vencida (só afeta testes manuais neste computador).

## Próxima sessão
Ler o `.env` da VPS (variáveis `OPENAI_MODEL*`) e uma resposta real da OpenAI para confirmar o modelo usado. Skills: `verification-before-completion`; `diagnosing-bugs` se o Sol for recusado.
