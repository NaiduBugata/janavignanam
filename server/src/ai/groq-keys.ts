/**
 * Port of Flask `_discover_api_keys` in ai/telugu_ai_news_analyzer.py.
 * Order: GROQ_API_KEY_N (numeric sort), then GROQ_API_KEYS, then GROQ_API_KEY.
 * Deduped, first occurrence wins. Never logs key material.
 */
export function discoverGroqApiKeys(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const numbered: Array<[number, string]> = [];
  for (const [key, value] of Object.entries(env)) {
    const match = /^GROQ_API_KEY_(\d+)$/.exec(key);
    if (match && value && value.trim()) {
      numbered.push([parseInt(match[1], 10), value.trim()]);
    }
  }
  numbered.sort((a, b) => a[0] - b[0]);
  const discovered = numbered.map(([, v]) => v);

  const explicit = (env.GROQ_API_KEYS || '').trim();
  if (explicit) {
    for (const part of explicit.split(/[,;\s]+/)) {
      if (part.trim()) discovered.push(part.trim());
    }
  }

  const single = (env.GROQ_API_KEY || '').trim();
  if (single) discovered.push(single);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const key of discovered) {
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(key);
    }
  }
  return unique;
}

export interface KeyState {
  index: number;
  availableAt: number;
  totalRequests: number;
}

/** Round-robin with cooldown. Mirrors APIKeyManager.acquire (single-threaded). */
export class GroqKeyRotator {
  private next = 0;
  private readonly states: KeyState[];
  readonly cooldownMs: number;

  constructor(keys: string[], cooldownSeconds: number) {
    if (!keys.length) {
      throw new Error(
        'No Groq API keys found. Set GROQ_API_KEY, GROQ_API_KEYS, or GROQ_API_KEY_1 ... GROQ_API_KEY_N.',
      );
    }
    this.cooldownMs = cooldownSeconds * 1000;
    this.states = keys.map((_, i) => ({
      index: i + 1,
      availableAt: 0,
      totalRequests: 0,
    }));
  }

  /** Returns key index (1-based) or null if every key is cooling down. */
  acquire(now = Date.now()): number | null {
    for (let offset = 0; offset < this.states.length; offset++) {
      const i = (this.next + offset) % this.states.length;
      const state = this.states[i];
      if (state.availableAt <= now) {
        this.next = (i + 1) % this.states.length;
        state.totalRequests += 1;
        state.availableAt = now;
        return state.index;
      }
    }
    return null;
  }

  coolDown(index: number, now = Date.now()): void {
    const state = this.states.find((s) => s.index === index);
    if (state) state.availableAt = now + this.cooldownMs;
  }
}
