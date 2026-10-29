/** Port of QualityAssessmentEngine.compute (0-100, no LLM). */
export function qualityScore(
  analysis: Record<string, unknown>,
  repairCount = 0,
): number {
  let score = 0;
  const summary = String(analysis.summary || '');
  const words = summary.trim() ? summary.trim().split(/\s+/).length : 0;
  if (words >= 50 && words <= 60) score += 0.35;
  else if (words >= 45 && words <= 65) score += 0.25;
  else score += Math.max(0, Math.min(0.2, words / 100));
  const entities = analysis.entities;
  const people = analysis.people;
  if (Array.isArray(entities) && entities.length) score += 0.2;
  if (Array.isArray(people) && people.length) score += 0.15;
  const loc = (analysis.location || {}) as Record<string, unknown>;
  if (loc.district) score += 0.1;
  const conf = analysis.confidence;
  if (typeof conf === 'number')
    score += Math.min(0.2, Math.max(0, (conf - 0.5) * 0.4));
  score -= Math.min(0.15, 0.05 * repairCount);
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

const SENTIMENTS = new Set(['Problem', 'Positive', 'Negative', 'Statement']);

/** Schema checks used before DecisionEngine. */
export function validationIssues(
  analysis: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const issues: Array<Record<string, unknown>> = [];
  const sentiment = String(analysis.sentiment || '');
  if (!SENTIMENTS.has(sentiment))
    issues.push({ severity: 'ERROR', repaired: false, field: 'sentiment' });
  if (!String(analysis.category || '').trim())
    issues.push({ severity: 'ERROR', repaired: false, field: 'category' });
  if (!String(analysis.summary || '').trim())
    issues.push({ severity: 'ERROR', repaired: false, field: 'summary' });
  const loc = analysis.location;
  if (!loc || typeof loc !== 'object')
    issues.push({ severity: 'ERROR', repaired: false, field: 'location' });
  return issues;
}
