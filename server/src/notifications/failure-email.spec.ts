import { failureEmailContent, sendPipelineFailureEmail } from './failure-email';

describe('pipeline failure email', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('names the problem, lists the errors, and escapes HTML', () => {
    const { subject, html } = failureEmailContent(
      'Sakshi website refused the server (HTTP 403)',
      ['sakshi_http_403', '<script>x</script>'],
      new Date('2026-09-28T13:22:12Z'),
    );
    expect(subject).toMatch(
      /^MediaSphere pipeline FAILED \| 28\/9\/2026, 6:52:12 pm IST$/,
    );
    expect(html).toContain('Sakshi website refused the server (HTTP 403)');
    expect(html).toContain('<code>sakshi_http_403</code>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('does not open a connection when email is off', async () => {
    process.env.EMAIL_ENABLED = 'false';
    const fetchImpl = (async () => {
      throw new Error('should not send');
    }) as typeof fetch;
    const result = await sendPipelineFailureEmail({
      reason: 'x',
      errors: ['x'],
      fetchImpl,
    });
    expect(result).toMatchObject({
      success: false,
      skipped: true,
      skip_reason: 'email_disabled',
    });
  });

  it('sends one Resend message to REPORT_RECIPIENTS', async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test';
    process.env.SMTP_FROM_EMAIL = 'from@example.com';
    process.env.REPORT_RECIPIENTS = 'desk@example.com';
    const bodies: Array<{ to: string[]; subject: string }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as Response;
    }) as typeof fetch;
    const result = await sendPipelineFailureEmail({
      reason: 'YouTube blocked',
      errors: ['youtube_blocked:8/8(x)'],
      fetchImpl,
    });
    expect(result.success).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].to).toEqual(['desk@example.com']);
    expect(bodies[0].subject).toMatch(/pipeline FAILED/);
  });
});
