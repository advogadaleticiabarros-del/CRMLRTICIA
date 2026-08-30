import { env, isProd } from './env';

// ── WebAuthn / Passkey (Face ID no iPhone) ───────────────────────────────
// rpID precisa ser exatamente o domínio (sem protocolo/porta) do CRM em
// produção, e origin a URL completa com protocolo. Errar isso é a forma
// mais comum de abrir uma brecha de phishing em WebAuthn (o navegador
// aceitaria uma credencial validada para um domínio errado) — por isso o
// padrão de produção NUNCA cai para localhost, mesmo sem env configurada.
const DEFAULT_PROD_RP_ID = 'crm.advogadaleticiabarros.com.br';
const DEFAULT_PROD_ORIGIN = 'https://crm.advogadaleticiabarros.com.br';

export const WEBAUTHN_RP_NAME = env.WEBAUTHN_RP_NAME || 'Letícia Barros — Advocacia';

export const WEBAUTHN_RP_ID = env.WEBAUTHN_RP_ID || (isProd ? DEFAULT_PROD_RP_ID : 'localhost');

export const WEBAUTHN_ORIGIN =
  env.WEBAUTHN_ORIGIN || (isProd ? DEFAULT_PROD_ORIGIN : `http://localhost:${env.PORT}`);

if (isProd && !env.WEBAUTHN_RP_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    `⚠️  WEBAUTHN_RP_ID não definido — usando o padrão (${WEBAUTHN_RP_ID}). ` +
      'Se o domínio real do CRM em produção for outro, defina WEBAUTHN_RP_ID e WEBAUTHN_ORIGIN ' +
      'no .env, senão o login por Face ID falha (o navegador recusa por segurança).'
  );
}
