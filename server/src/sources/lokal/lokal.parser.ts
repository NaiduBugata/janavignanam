/**
 * Parse Lokal created_on the way sources/lokal/parser.py does.
 * Z and offsets become UTC. A naive timestamp is read as local time, then UTC.
 */
export function parsePostDate(value: unknown): Date | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace('Z', '+00:00');
  const hasZone =
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) || /[+-]\d{2}:\d{2}$/.test(normalized);
  const parsed = new Date(hasZone ? normalized : text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
