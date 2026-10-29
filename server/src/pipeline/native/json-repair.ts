/** Port of JSONRepairer: fence strip + first object extract. */
export function repairJson(raw: string): Record<string, unknown> {
  let text = (raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('model output is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}
