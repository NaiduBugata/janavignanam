import { discoverGroqApiKeys, GroqKeyRotator } from './groq-keys';

describe('discoverGroqApiKeys', () => {
  it('orders numbered keys, then list, then single, and dedupes', () => {
    const keys = discoverGroqApiKeys({
      GROQ_API_KEY_2: 'k2',
      GROQ_API_KEY_1: 'k1',
      GROQ_API_KEYS: 'k3,k1',
      GROQ_API_KEY: 'k4',
    });
    expect(keys).toEqual(['k1', 'k2', 'k3', 'k4']);
  });
});

describe('GroqKeyRotator', () => {
  it('cools a key down after 429 and uses the next key', () => {
    const rot = new GroqKeyRotator(['a', 'b'], 30);
    const first = rot.acquire(1_000);
    expect(first).toBe(1);
    rot.coolDown(1, 1_000);
    const second = rot.acquire(1_000);
    expect(second).toBe(2);
  });
});
