import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { truthy } from '../common/utils/truthy';

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Mirrors Flask pipeline_config.PIPELINE_ADMIN_TOKEN (falls back to ADMIN_PASSWORD). */
function pipelineAdminToken(): string {
  return (
    (process.env.PIPELINE_ADMIN_TOKEN || '').trim() ||
    (process.env.ADMIN_PASSWORD || '').trim()
  );
}

/** Mirrors Flask admin.auth.admin_password() (falls back to PIPELINE_ADMIN_TOKEN). */
function adminPassword(): string {
  return (
    (process.env.ADMIN_PASSWORD || '').trim() ||
    (process.env.PIPELINE_ADMIN_TOKEN || '').trim()
  );
}

/** Mirrors Flask admin.fetch_service.fetch_interval_hours(). */
function fetchIntervalHours(): number {
  const pipelineHours = Math.max(0.1, floatEnv('PIPELINE_INTERVAL_HOURS', 1.0));
  if ((process.env.FETCH_INTERVAL_HOURS || '').trim()) {
    return Math.max(0.1, floatEnv('FETCH_INTERVAL_HOURS', pipelineHours));
  }
  return pipelineHours;
}

export default () => ({
  api: {
    host: process.env.API_HOST || '0.0.0.0',
    // Railway injects PORT. Prefer it so a copied API_PORT does not bind the wrong port.
    port: parseInt(process.env.PORT || process.env.API_PORT || '5000', 10),
  },
  corsOrigins: (
    process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  database: {
    uri:
      process.env.NEON_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.ERP_DATABASE_URL ||
      '',
    name: 'neondb',
    articlesCollection: process.env.MONGODB_COLLECTION || 'articles',
  },
  admin: {
    username: (process.env.ADMIN_USERNAME || '').trim(),
    password: adminPassword(),
    sessionSecret:
      (process.env.ADMIN_SESSION_SECRET || '').trim() ||
      adminPassword() ||
      'mediasphere-admin-dev-insecure',
    sessionTtlSeconds: intEnv('ADMIN_SESSION_TTL_SECONDS', 28800),
  },
  pipeline: {
    // Scheduler ownership flag. When true, the FLASK scheduler MUST be off.
    onApi: truthy(process.env.PIPELINE_ON_API),
    catchupOnStart: truthy(
      process.env.PIPELINE_CATCHUP_ON_START ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true'),
    ),
    intervalHours: Math.max(0.1, floatEnv('PIPELINE_INTERVAL_HOURS', 1.0)),
    lockTtlSeconds: Math.max(60, intEnv('PIPELINE_LOCK_TTL_SECONDS', 45 * 60)),
    adminToken: pipelineAdminToken(),
    stateId: 'pipeline',
    jobId: 'news_pipeline',
    fetchIntervalHours: fetchIntervalHours(),
    delayToleranceMinutes: Math.max(
      1,
      intEnv('FETCH_DELAY_TOLERANCE_MINUTES', 30),
    ),
    sources: {
      // Defaults mirror sources/youtube/config.py and sources/sakshi/config.py.
      youtubeEnabled: truthy(process.env.YOUTUBE_ENABLED ?? 'true'),
      sakshiEnabled: truthy(process.env.SAKSHI_ENABLED ?? 'true'),
    },
    // native = Nest collectors + Groq. python = Phase 3 subprocess bridge (tests).
    executor: (process.env.PIPELINE_EXECUTOR || 'native').toLowerCase(),
    // Option B bridge: used only when PIPELINE_EXECUTOR=python.
    python: {
      executable: process.env.PYTHON_EXECUTABLE || 'python',
      cwd: process.env.PIPELINE_PYTHON_CWD || '',
      script: process.env.PIPELINE_PYTHON_SCRIPT || 'run_all_pipelines.py',
      // Empty string means no args (fixtures). Undefined keeps Flask default --once.
      args:
        process.env.PIPELINE_PYTHON_ARGS === undefined
          ? ['--once']
          : process.env.PIPELINE_PYTHON_ARGS.split(' ')
              .map((s) => s.trim())
              .filter(Boolean),
      timeoutMs: intEnv(
        'PIPELINE_RUN_TIMEOUT_MS',
        Math.max(60, intEnv('PIPELINE_LOCK_TTL_SECONDS', 45 * 60)) * 1000,
      ),
    },
  },
  reports: {
    enabled: truthy(process.env.REPORT_ENABLED ?? 'true'),
    schedulerOnApi: truthy(process.env.REPORT_SCHEDULER_ON_API),
    catchupOnStart: truthy(process.env.REPORT_CATCHUP_ON_START),
    timezone: process.env.REPORT_TIMEZONE || 'Asia/Kolkata',
    hour: intEnv('REPORT_HOUR', 7),
    minute: intEnv('REPORT_MINUTE', 0),
    constituency: process.env.REPORT_CONSTITUENCY || 'Narasaraopet',
    outputDir:
      process.env.REPORT_OUTPUT_DIR || join(tmpdir(), 'mediasphere_reports'),
  },
  email: {
    enabled: process.env.EMAIL_ENABLED,
    provider: (process.env.EMAIL_PROVIDER || 'auto').toLowerCase(),
    recipients: process.env.REPORT_RECIPIENTS || '',
    resendApiKey: process.env.RESEND_API_KEY || '',
    smtpUsername: process.env.SMTP_USERNAME || '',
    smtpPassword: process.env.SMTP_PASSWORD || '',
  },
  whatsapp: {
    enabled: process.env.WHATSAPP_ENABLED,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    recipients: process.env.WHATSAPP_RECIPIENTS || '',
  },
});
