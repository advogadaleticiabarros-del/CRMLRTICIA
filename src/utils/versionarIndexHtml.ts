// Cache-busting do index.html: cada deploy vira uma URL diferente para os scripts da
// tela e o CSS, para nenhum navegador rodar a tela de um deploy anterior.
//
// Antes (até 30/10/2026) a lista era fixa (app, whatsapp, portal-parceiro) e as telas
// novas ficavam de fora: a barra de progresso da Mesa do caso não chegou à Jessica
// porque o navegador continuou com o mesa.js antigo. Agora vale para todo script da
// raiz de public/; bibliotecas (/vendor/...) e o /socket.io/ ficam como estão.
export function versionarIndexHtml(raw: string, buildId: string): string {
  return raw
    .replace(/(src="\/[\w-]+\.js)"/g, `$1?v=${buildId}"`)
    .replace(/(href="\/styles\.css)"/, `$1?v=${buildId}"`);
}
