import {
  SAKSHI_HEADERS,
  SAKSHI_PERMANENT_STATUSES,
  SAKSHI_TRANSIENT_STATUSES,
  sakshiMaxRetries,
  sakshiTimeoutMs,
} from './sakshi.constants';

export class PermanentHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly url: string,
  ) {
    super(`HTTP ${statusCode} for ${url}`);
    this.name = 'PermanentHttpError';
  }
}

export class TransientHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly url: string,
  ) {
    super(`HTTP ${statusCode} for ${url}`);
    this.name = 'TransientHttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchSakshiHtml(
  url: string,
  fetchImpl: typeof fetch = fetch,
  options?: { timeoutMs?: number; maxRetries?: number; retryDelayMs?: number },
): Promise<string> {
  const maxRetries = options?.maxRetries ?? sakshiMaxRetries();
  const timeoutMs = options?.timeoutMs ?? sakshiTimeoutMs();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: SAKSHI_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 403) {
        if (attempt >= 2) throw new PermanentHttpError(403, url);
        lastError = new TransientHttpError(403, url);
        const delay = options?.retryDelayMs ?? 250;
        if (delay > 0) await sleep(delay);
        continue;
      }
      if (SAKSHI_PERMANENT_STATUSES.has(response.status)) {
        throw new PermanentHttpError(response.status, url);
      }
      if (SAKSHI_TRANSIENT_STATUSES.has(response.status) || !response.ok) {
        throw new TransientHttpError(response.status || 0, url);
      }
      return await response.text();
    } catch (err) {
      if (err instanceof PermanentHttpError) throw err;
      lastError = err;
      if (attempt >= maxRetries) break;
      const delay = options?.retryDelayMs ?? 1000 * attempt;
      if (delay > 0) await sleep(delay);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('sakshi_fetch_failed');
}
