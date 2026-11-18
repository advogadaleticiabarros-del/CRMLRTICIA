# Agente de prazos (Dra. Paula) — 18/11/2026

## Pedido
Jessica: "Coloque um dos agentes para gerir essas páginas! Ler as intimações, avisar a advogada, definir os prazos, isso de forma rápida, monitorando 3 vezes ao dia pelo menos" e "um agente que lê e coloca o prazo como cumprido, interpretar direito o que está sendo lido para definir tudo isso".

## Feito
- Commit 110d4b4. Rotina `prazos:agente` (7h40, 13h40, 19h40) dada à Dra. Paula no Escritório virtual.
- Arquivos: `src/services/agentePrazos.ts` (regras), `src/services/agentePrazosMysql.ts` (banco, IA e WhatsApp), migration 182.
- `confirmarPrazoDetectado` (`src/routes/detected-deadlines.ts`) agora é exportado e aceita a data limite já contada.
- Como o agente funciona: `docs/manual/04-processos.md`, seção "Agente de prazos". Por que foi feito assim: decision log de 18/11.
- **Motivo de fundo:** havia 104 prazos detectados parados em "a confirmar" (desde 05/10) e só 1 prazo registrado no módulo de Prazos.

## Verificado
- `tests/agentePrazos.test.mjs` (6 testes); `npm test` com 1507 ok e 0 falhas; lint com 0 erros; deploy ok (testes + VPS).
- **Simulação em produção** (lê o banco e chama a IA, sem gravar nem enviar), com 40 intimações: 17 prazos definidos (todos pela regra), 13 para a Dra. ler, 6 vencidos sem registro, 1 "parece cumprido" e nenhuma falha da IA. A mensagem saiu legível.
- **Não verificado:** a primeira rodada real (7h40 de 18/11) e a chegada do WhatsApp.

## Decisões
- A IA só escolhe o tipo do ato numa lista fechada; a data sai da regra do código.
- "Cumprido" só com prova (movimentação posterior da nossa parte, citando a Dra., a OAB ou o cliente).
- Nada é descartado sozinho; prazo vencido sem registro não vira prazo.
- O acúmulo é lido aos poucos: 40 intimações por rodada, as mais novas primeiro.

## Pendente
- Conferir o `job_runs` da rotina `prazos:agente` depois das 7h40 e o WhatsApp recebido. Se a primeira mensagem vier longa demais por causa do acúmulo, avaliar um resumo.
- As intimações em "para ler" dependem da Dra.; com o login do PJe/eproc salvo, o MNI traz o inteiro teor das movimentações, o que deve reduzir esse grupo.
- Sem login do tribunal, as intimações pendentes do PJe (`mni_avisos`) não entram no agente.

## Próxima sessão
Ver `SELECT * FROM job_runs WHERE job='prazos:agente' ORDER BY id DESC LIMIT 3` e os `deadlines` com `agente_origem` preenchido. Skills: `verification-before-completion`, `diagnosing-bugs` se a rodada falhar.
