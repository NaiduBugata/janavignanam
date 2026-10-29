/**
 * Pure helpers that reproduce Flask api/app.py normalization and date-key
 * semantics for NestJS contract parity.
 */

export function falsyToEmptyString(value: unknown): string {
  // Python: value or ""
  if (
    value === null ||
    value === undefined ||
    value === false ||
    value === 0 ||
    value === ''
  ) {
    return '';
  }
  return String(value);
}

export function falsyToDefault(value: unknown, fallback: string): string {
  // Python: value or fallback  (empty string is falsy)
  if (
    value === null ||
    value === undefined ||
    value === false ||
    value === 0 ||
    value === ''
  ) {
    return fallback;
  }
  return String(value);
}

/**
 * Match datetime.fromisoformat(value.replace("Z", "+00:00")).
 */
export function parseFlaskDate(value: string): Date | null {
  if (!value) return null;
  const normalized = value.replace(/Z$/i, '+00:00');
  const t = Date.parse(normalized);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/**
 * Match Flask _date_key:
 *   parsed = fromisoformat(...); return parsed.date().isoformat()
 *
 * For offset-aware ISO timestamps, Python .date() is the wall-clock calendar
 * date in that offset (the YYYY-MM-DD prefix), not the UTC calendar date.
 */
export function flaskDateKey(value: string): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/Z$/i, '+00:00');
  // fromisoformat must succeed for Flask to return a key
  if (!parseFlaskDate(normalized)) return null;
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** UTC calendar date helpers — matches datetime.now(timezone.utc).date() */
export function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function utcDaysBackIso(daysBack: number): string {
  const d = new Date();
  const utc = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysBack,
  );
  return new Date(utc).toISOString().slice(0, 10);
}

export function entityDisplayName(entity: unknown): string | null {
  let name: unknown;
  if (entity && typeof entity === 'object' && !Array.isArray(entity)) {
    name = (entity as { name?: unknown }).name;
  } else if (entity === null || entity === undefined) {
    name = '';
  } else {
    name = String(entity);
  }
  if (name === null || name === undefined || name === '' || name === false) {
    return null;
  }
  return String(name);
}
