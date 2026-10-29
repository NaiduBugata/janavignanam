import type { SourceCollectionResult } from '../sources/source-collector';

/**
 * Merge semantics from Flask pipeline/runner.py::_merge_stats + exit rule:
 * overall exit is 0 only when every executed source exit code is 0.
 * A failed source does not skip later sources (caller runs them first).
 */
export function mergeSourceResults(results: SourceCollectionResult[]): {
  exitCode: number;
  status: string;
  articles_fetched: number;
  duplicates: number;
  inserted: number;
  lokal_processed: number;
  youtube_processed: number;
  sakshi_processed: number;
  errors: string[];
} {
  const by = (name: string) => results.find((r) => r.source === name);
  const lokal = by('lokal');
  const youtube = by('youtube');
  const sakshi = by('sakshi');
  const errors = results.flatMap((r) => r.errors);
  const exitCode = results.every(
    (r) => r.exitCode === 0 || r.status === 'skipped',
  )
    ? 0
    : 1;
  return {
    exitCode,
    status: exitCode === 0 ? 'Finished Successfully' : 'Completed with errors',
    articles_fetched: results.reduce((n, r) => n + r.itemsFound, 0),
    duplicates: results.reduce((n, r) => n + r.itemsDuplicate, 0),
    inserted: results.reduce((n, r) => n + r.itemsNew, 0),
    lokal_processed: lokal?.itemsFound ?? 0,
    youtube_processed: youtube?.itemsFound ?? 0,
    sakshi_processed: sakshi?.itemsFound ?? 0,
    errors,
  };
}
