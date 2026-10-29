import { mergeSourceResults } from './combined-cycle';
import type { SourceCollectionResult } from '../sources/source-collector';

function src(
  source: SourceCollectionResult['source'],
  exitCode: number,
  found = 1,
): SourceCollectionResult {
  return {
    source,
    status: exitCode === 0 ? 'success' : 'failed',
    startedAt: 't',
    completedAt: 't',
    durationMs: 1,
    itemsFound: found,
    itemsNew: exitCode === 0 ? 1 : 0,
    itemsDuplicate: 0,
    itemsFailed: exitCode === 0 ? 0 : 1,
    errors: exitCode === 0 ? [] : [`${source}_failed`],
    articles: [],
    exitCode,
  };
}

describe('mergeSourceResults', () => {
  it('succeeds only when every source exits 0', () => {
    const ok = mergeSourceResults([
      src('lokal', 0),
      src('youtube', 0),
      src('sakshi', 0),
    ]);
    expect(ok.exitCode).toBe(0);
    expect(ok.status).toBe('Finished Successfully');
  });

  it('keeps later source counts when YouTube fails (partial)', () => {
    const partial = mergeSourceResults([
      src('lokal', 0, 3),
      src('youtube', 1, 0),
      src('sakshi', 0, 2),
    ]);
    expect(partial.exitCode).toBe(1);
    expect(partial.lokal_processed).toBe(3);
    expect(partial.sakshi_processed).toBe(2);
    expect(partial.errors).toEqual(['youtube_failed']);
  });
});
