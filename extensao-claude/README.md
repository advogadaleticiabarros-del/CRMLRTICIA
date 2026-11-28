# Extensão do CRM jurídico para o Claude Desktop

Liga o Claude Desktop de cada advogado ao CRM. Com ela, o Claude:
- reconhece sozinho o caso pelo número do processo ou pelo nome do cliente;
- traz os prazos abertos e as últimas movimentações antes de redigir;
- responde "o que tenho esta semana".

**Versão 0.1 (fase 0): só leitura.**

## Como instalar (advogado)
1. **No CRM:** Configurações → **Claude (extensão)** → dê um nome (ex.: "Claude do notebook") → **Gerar chave** → **Copiar**. A chave aparece uma vez só.
2. **No Claude Desktop:** abra o arquivo `crm-juridico.mcpb` (dois cliques) e confirme a instalação.
3. Nas configurações da extensão, cole a chave em **"Chave do CRM"**. O endereço já vem preenchido.
4. **Privacidade (plano Pro individual):** em Configurações → Privacidade do Claude, desligue o uso das conversas para treinar modelos. Os dados são de clientes.
5. Teste no Claude: *"o CRM está conectado?"* e depois *"o que tenho esta semana?"*.

Trocou de computador ou perdeu o notebook? Revogue a chave no CRM. Ela para de funcionar na hora.

## Como funciona
- `server/index.js`: servidor MCP local (stdio), aberto pelo Claude Desktop.
- `server/ferramentas.js`: as ferramentas (`crm_quem_sou`, `crm_minha_semana`, `crm_identificar_caso`, `crm_resumo_caso`).
- `server/instrucoes.js`: o "manual do escritório" que o Claude segue (identificar o caso sozinho, não inventar, nunca enviar mensagem a cliente).
- `server/crm.js`: chama a API do CRM (`/api/claude/*`) com a chave (`Authorization: Bearer crm_...`).
- No CRM: `src/routes/claude.ts` (API), `src/routes/claudeChaves.ts` (chaves), `src/services/chavesClaude.ts` (regra das chaves; só o hash fica no banco), `src/services/claudeConsultasMysql.ts` (consultas, sem CPF, telefone ou endereço).

## Gerar o arquivo instalável
```sh
cd extensao-claude
npm install --omit=dev
npm run validate
npm run pack        # gera crm-juridico.mcpb (não vai para o git)
```

## Próximas fases
- **Fase 1:** registrar sozinho no CRM. O print do protocolo vira ação protocolada e prazo cumprido, a pasta para protocolo vira "Aguardando protocolo" e há "desfazer".
- **Fase 2:** casos parecidos já protocolados pela Dra. como base, e salvar a peça no processo.
