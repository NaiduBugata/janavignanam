import {
  LOKAL_BACKOFF_FACTOR,
  LOKAL_BASE_URL,
  LOKAL_HEADERS,
  LOKAL_MAX_RETRIES,
  LOKAL_PAGE_SIZE,
  LOKAL_POST_TYPES,
  LOKAL_TAG_ID,
  LOKAL_TIMEOUT_MS,
} from './lokal.constants';

export function buildLokalPageUrl(page: number): string {
  return (
    `${LOKAL_BASE_URL}?tag_id=${LOKAL_TAG_ID}&post_type=${LOKAL_POST_TYPES}` +
    `&page_size=${LOKAL_PAGE_SIZE}&page=${page}`
  );
}

export async function fetchLokalPage(
  page: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const url = buildLokalPageUrl(page);
  for (let attempt = 1; attempt <= LOKAL_MAX_RETRIES; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: LOKAL_HEADERS,
        signal: AbortSignal.timeout(LOKAL_TIMEOUT_MS),
      });
      if (response.status !== 200) {
        if (attempt >= LOKAL_MAX_RETRIES) return null;
        await delay(LOKAL_BACKOFF_FACTOR ** attempt * 1000);
        continue;
      }
      try {
        const payload = (await response.json()) as unknown;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
          return null;
        return payload as Record<string, unknown>;
      } catch {
        return null;
      }
    } catch {
      if (attempt < LOKAL_MAX_RETRIES) {
        await delay(LOKAL_BACKOFF_FACTOR ** attempt * 1000);
        continue;
      }
      return null;
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
