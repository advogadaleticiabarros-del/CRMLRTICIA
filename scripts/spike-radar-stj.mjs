// scripts/spike-radar-stj.mjs
// Spike: testa se dá pra extrair de forma confiável os Informativos de
// Jurisprudência do STJ (tema, número, data, resumo) de forma programática.
// NÃO automatizar em cima disso até este spike confirmar estabilidade —
// decisão registrada no spec docs/superpowers/specs/2026-08-21-briefing-matinal-design.md.
//
// Uso: node scripts/spike-radar-stj.mjs
// Saída: imprime o que conseguiu extrair da página mais recente de
// Informativos do STJ e grava scripts/spike-radar-stj-resultado.json com o
// veredito (estável/instável) e a amostra bruta, para revisão manual.

import { writeFileSync } from 'node:fs';

const URL_INFORMATIVOS = 'https://www.stj.jus.br/publicacaoinstitucional/index.php/informjurisprudencia';

async function main() {
  const resultado = { testadoEm: new Date().toISOString(), url: URL_INFORMATIVOS, veredito: null, amostra: null, erro: null };
  try {
    const res = await fetch(URL_INFORMATIVOS, { headers: { 'User-Agent': 'Mozilla/5.0 (spike CRMLRTICIA)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Checagem mínima: a página tem uma estrutura reconhecível de lista de edições?
    const temLinksDeEdicao = /informativo/i.test(html) && /\d{4}/.test(html);
    resultado.amostra = html.slice(0, 2000);
    resultado.veredito = temLinksDeEdicao
      ? 'PRECISA REVISÃO MANUAL — página respondeu e parece ter conteúdo de informativos, mas a extração estruturada (tema/número/data) não foi tentada neste spike. Abrir scripts/spike-radar-stj-resultado.json e inspecionar a amostra.'
      : 'INSTÁVEL — a página respondeu mas não bate o padrão esperado. Não prosseguir sem investigar outra fonte (ex.: Jurisprudência em Teses).';
  } catch (e) {
    resultado.erro = e.message;
    resultado.veredito = 'FALHOU — não foi possível acessar a fonte. Ver campo "erro".';
  }
  writeFileSync(new URL('./spike-radar-stj-resultado.json', import.meta.url), JSON.stringify(resultado, null, 2));
  console.log(resultado.veredito);
  console.log('Detalhes em scripts/spike-radar-stj-resultado.json');
}

main();
