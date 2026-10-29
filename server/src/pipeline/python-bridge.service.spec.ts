import { ConfigService } from '@nestjs/config';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PythonBridgeService } from './python-bridge.service';

/**
 * The bridge is exercised against a tiny stand-in script rather than the real
 * `run_all_pipelines.py`, because the real cycle writes to production Mongo and
 * burns Groq quota. The stand-in reproduces what the bridge actually depends on:
 * the `COMBINED PIPELINE CYCLE END | ...` summary line on stderr and the exit
 * code. `node` is used as the interpreter so the suite has no Python dependency.
 */
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'mediasphere-bridge-'));

const CYCLE_FIXTURE = `
const mode = process.argv[2];
console.error('COMBINED PIPELINE CYCLE START');
if (mode === 'ok') {
  console.error('COMBINED PIPELINE CYCLE END | exit=0 | inserted=4 | duplicates=2 | fetched=11 | sakshi=3');
  process.exit(0);
}
if (mode === 'fail') {
  console.error('COMBINED PIPELINE CYCLE END | exit=1 | inserted=0 | duplicates=0 | fetched=0 | sakshi=0');
  process.exit(1);
}
if (mode === 'silent') {
  process.exit(0);
}
if (mode === 'hang') {
  setInterval(() => {}, 1000);
}
`;
writeFileSync(join(FIXTURE_DIR, 'cycle.js'), CYCLE_FIXTURE, 'utf8');

function makeBridge(args: string[], timeoutMs = 20000): PythonBridgeService {
  const values: Record<string, unknown> = {
    'pipeline.python.executable': process.execPath,
    'pipeline.python.cwd': FIXTURE_DIR,
    'pipeline.python.script': 'cycle.js',
    'pipeline.python.args': args,
    'pipeline.python.timeoutMs': timeoutMs,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new PythonBridgeService(config);
}

describe('PythonBridgeService (Option B execution bridge)', () => {
  it('parses the combined-cycle summary line on success', async () => {
    const result = await makeBridge(['ok']).runCombinedOnce();
    expect(result.exitCode).toBe(0);
    expect(result.parsed).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.stats).toMatchObject({
      inserted: 4,
      duplicates: 2,
      articles_fetched: 11,
      sakshi_processed: 3,
    });
    expect(result.stats.errors).toEqual([]);
  });

  it('surfaces a non-zero exit code as a cycle error', async () => {
    const result = await makeBridge(['fail']).runCombinedOnce();
    expect(result.exitCode).toBe(1);
    expect(result.stats.errors).toContain('combined_cycle_exit_code=1');
  });

  it('returns zeroed stats when the summary line is missing', async () => {
    const result = await makeBridge(['silent']).runCombinedOnce();
    expect(result.exitCode).toBe(0);
    expect(result.parsed).toBe(false);
    expect(result.stats.inserted).toBe(0);
  });

  it('kills and reports a run that exceeds the timeout', async () => {
    const result = await makeBridge(['hang'], 400).runCombinedOnce();
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stats.errors.join(' ')).toContain('python_bridge_timeout');
  }, 40000);

  it('never throws when the interpreter cannot be spawned', async () => {
    const values: Record<string, unknown> = {
      'pipeline.python.executable': 'definitely-not-on-path-xyz',
      'pipeline.python.cwd': FIXTURE_DIR,
      'pipeline.python.script': 'cycle.js',
      'pipeline.python.args': ['ok'],
      'pipeline.python.timeoutMs': 5000,
    };
    const bridge = new PythonBridgeService({
      get: (k: string) => values[k],
    } as unknown as ConfigService);
    const result = await bridge.runCombinedOnce();
    expect(result.exitCode).toBe(1);
    expect(result.stats.errors.join(' ')).toContain(
      'python_bridge_spawn_failed',
    );
  });

  it('describes the exact command it will run', () => {
    expect(makeBridge(['--once']).describe()).toContain('cycle.js --once');
  });
});
