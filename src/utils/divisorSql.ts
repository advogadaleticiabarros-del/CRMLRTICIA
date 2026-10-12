/**
 * Divide SQL em comandos, EM FLUXO: recebe o texto em pedaços (push) e devolve
 * os comandos já completos. Mesmas regras do divisor das migrations:
 *  - ';' dentro de aspas ('...', "...", `...`) não encerra comando (respeita \ de escape);
 *  - comentário `-- ...` vira uma quebra de linha; comentário /* ... *\/ some.
 *
 * Por que em fluxo (incidente 11/10/2026): a prova de restauração do backup
 * montava o dump inteiro num único texto. Com 656 MB de SQL (mídia do WhatsApp
 * guardada no banco), passou do limite do Node (~512 MB por texto) e a
 * restauração falhou com "Cannot create a string longer than 0x1fffffe8".
 * Aqui só o comando atual fica na memória.
 *
 * O texto é copiado em fatias (slice), não caractere a caractere: somar letra
 * por letra num INSERT de 40 MB (binário em hex) gastaria gigabytes de memória.
 */
export class DivisorSql {
  private atual = '';
  private aspas: '"' | "'" | '`' | null = null;
  private comentario: 'linha' | 'bloco' | null = null;
  private sobra = '';

  /** @param limiteCaracteres comando maior que isto é recusado com erro claro. */
  constructor(private readonly limiteCaracteres = Infinity) {}

  push(pedaco: string): string[] {
    return this.processar(this.sobra + pedaco, false);
  }

  /** Fim do texto: devolve o último comando (sem ';' final), se houver. */
  finalizar(): string[] {
    const out = this.processar(this.sobra, true);
    this.empurrar(out);
    return out;
  }

  private empurrar(out: string[]) {
    const s = this.atual.trim();
    if (s) out.push(s);
    this.atual = '';
  }

  private anexar(t: string, de: number, ate: number) {
    if (ate <= de) return;
    this.atual += t.slice(de, ate);
    if (this.atual.length > this.limiteCaracteres) {
      throw new Error(`Comando SQL de ${Math.round(this.atual.length / 1048576)} MB é maior que o limite de ${Math.round(this.limiteCaracteres / 1048576)} MB`);
    }
  }

  private processar(t: string, fim: boolean): string[] {
    const out: string[] = [];
    const n = t.length;
    this.sobra = '';
    let ini = 0; // início do trecho ainda não copiado para `atual`
    let i = 0;
    // Caractere que depende do próximo ('-', '/', '*', '\') no fim do pedaço
    // fica guardado para o próximo pedaço — menos no fim do texto.
    const precisaEsperar = () => i + 1 >= n && !fim;

    for (; i < n; i++) {
      const c = t[i];

      if (this.comentario === 'linha') {
        if (c === '\n') { this.comentario = null; this.atual += '\n'; ini = i + 1; }
        continue;
      }
      if (this.comentario === 'bloco') {
        if (c === '*') {
          if (precisaEsperar()) break;
          if (t[i + 1] === '/') { this.comentario = null; i++; ini = i + 1; }
        }
        continue;
      }
      if (this.aspas) {
        if (c === '\\') { if (precisaEsperar()) break; i++; continue; }
        if (c === this.aspas) this.aspas = null;
        continue;
      }

      if (c === '-' || c === '/') {
        if (precisaEsperar()) break;
        if (c === '-' && t[i + 1] === '-') { this.anexar(t, ini, i); this.comentario = 'linha'; continue; }
        if (c === '/' && t[i + 1] === '*') { this.anexar(t, ini, i); this.comentario = 'bloco'; i++; continue; }
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { this.aspas = c; continue; }
      if (c === ';') { this.anexar(t, ini, i); this.empurrar(out); ini = i + 1; }
    }

    if (i < n) this.sobra = t.slice(i); // parou esperando o próximo pedaço
    if (this.comentario === null) this.anexar(t, ini, i);
    // comentário de linha que termina no fim do texto vira quebra de linha (igual ao divisor antigo)
    else if (fim && this.comentario === 'linha') this.atual += '\n';
    return out;
  }
}
