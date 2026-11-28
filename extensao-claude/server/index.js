#!/usr/bin/env node
/**
 * Extensão do CRM jurídico para o Claude Desktop (servidor MCP local, stdio).
 * Lê o endereço do CRM e a chave da pessoa das variáveis CRM_URL e CRM_CHAVE,
 * que o Claude Desktop preenche com as configurações da extensão.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { criarCrm } from './crm.js';
import { FERRAMENTAS } from './ferramentas.js';
import { INSTRUCOES } from './instrucoes.js';

const crm = criarCrm({ url: process.env.CRM_URL, chave: process.env.CRM_CHAVE });
const server = new McpServer({ name: 'crm-juridico', version: '0.1.0' }, { instructions: INSTRUCOES });

function esquema(parametros) {
  const forma = {};
  for (const [nome, p] of Object.entries(parametros)) {
    let campo = p.tipo === 'number' ? z.number().int().positive() : z.string().max(4000);
    campo = campo.describe(p.descricao);
    forma[nome] = p.opcional ? campo.optional() : campo;
  }
  return forma;
}

for (const f of FERRAMENTAS) {
  server.registerTool(
    f.nome,
    { title: f.titulo, description: f.descricao, inputSchema: esquema(f.parametros), annotations: { readOnlyHint: true, openWorldHint: false } },
    async (args) => {
      try {
        const r = await f.executar(crm, args || {});
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: String(e && e.message ? e.message : e) }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
