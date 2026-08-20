// src/services/googlePagination.ts
/**
 * Junta todas as páginas de uma listagem paginada no estilo Google Calendar API
 * (cada página devolve `items` + opcionalmente `nextPageToken`).
 * Extraído do GoogleCalendarService para ser testável sem falar com a API real.
 */
export async function collectAllPages<T>(
  fetchPage: (pageToken?: string) => Promise<{ items?: T[]; nextPageToken?: string | null }>
): Promise<T[]> {
  const all: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    all.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return all;
}
