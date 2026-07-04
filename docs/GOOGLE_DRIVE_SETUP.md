# Google Drive — Configuração para Auto-Criar Pastas

## Situação Atual

❌ **Nenhuma conta Google configurada**

O sistema está pronto para criar pastas automaticamente no Google Drive, mas precisa de autenticação.

## Como Configurar

### 1️⃣ **No CRM — Conectar Google Drive**

1. Acesse o CRM na URL em produção (ex: `https://crm.advogadaleticiabarros.com.br`)
2. Vá para **Configurações** (engrenagem no canto superior direito)
3. Procure por **"Conectar Google Drive"** ou **"Google Workspace"**
4. Clique no botão para conectar
5. Você será redirecionado para login Google
6. Autorize o acesso (permita ler/escrever em Drive)
7. Você retorna ao CRM — conexão feita! ✅

### 2️⃣ **Verificar Conexão**

Execute no terminal:

```bash
npm run create:drive-folders
```

Esperado:
```
📁 ========================================
   Criar Pastas Drive Faltantes
   ========================================

🔍 Buscando casos em produção sem pasta Drive...

📧 Encontrados 1 caso(s) sem pasta Drive

[1/1] Ana Workflow - Processo...  ✅

✅ Concluído!
   ✅ 1 pasta(s) criada(s)
   ⚠️  0 caso(s) com falha
```

### 3️⃣ **A Partir de Agora**

Pastas serão criadas automaticamente:
- ✅ Ao criar novo caso manualmente
- ✅ Ao importar e-mail nas parcerias
- ✅ Ao avançar para "separacao_documentos" (produção)

## Scripts Úteis

```bash
# Verificar quais usuários têm auth Google
npm run check:google-auth

# Criar pastas para todos os casos em produção sem pasta
npm run create:drive-folders

# Reorganizar pastas de um cliente específico
npm run fix:aracelia
```

## Troubleshooting

**"Sem auth para user X"**
- Aquele usuário ainda não conectou Google Drive
- Peça para ele acessar Configurações e conectar

**Pasta criada mas com nome estranho**
- Verifique se `legal_area` está preenchida no caso
- Se não, a pasta será criada com nome genérico

**OAuth error no CRM**
- Verifique se `GOOGLE_CLIENT_ID` e `GOOGLE_REDIRECT_URI` estão corretos em `.env`
- Verifique se estão cadastrados como redirect URIs no Google Cloud Console
