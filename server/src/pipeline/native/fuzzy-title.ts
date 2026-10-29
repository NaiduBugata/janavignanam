/** Sakshi title match threshold from database/mongo.py (0.72). */
export function titleSimilarity(a: string, b: string): number {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return 0;
  if (left === right || left.includes(right) || right.includes(left))
    return 0.93;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const bgA = bigrams(left);
  const bgB = bigrams(right);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of bgA) {
    total += n;
    overlap += Math.min(n, bgB.get(g) || 0);
  }
  for (const n of bgB.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

export function titlesMatch(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= 0.72;
}
