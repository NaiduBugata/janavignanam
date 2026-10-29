import {
  describeFailure,
  FailureAlertGate,
  failureSignature,
  pipelineStatusWhatsAppEnabled,
} from './pipeline-alerts';

describe('pipeline alerts', () => {
  const errors = [
    'youtube_blocked:7/10(playability_login_required=7)',
    'sakshi_http_403',
  ];

  it('describes source problems in plain words', () => {
    expect(
      describeFailure([...errors, 'youtube:yt_x:Groq 429', 'ai_failed=1']),
    ).toBe(
      'YouTube refused captions to the server for 7 of 10 videos (playability_login_required=7); ' +
        'Sakshi website refused the server (HTTP 403); AI analysis failed for 1 article',
    );
  });

  it('keys the same problem the same way even when counts change', () => {
    expect(failureSignature(errors)).toBe(
      failureSignature([
        'sakshi_http_403',
        'youtube_blocked:3/9(player_http_429=3)',
      ]),
    );
    expect(failureSignature(errors)).not.toBe(
      failureSignature(['sakshi_http_403']),
    );
  });

  it('alerts once per problem, again after the repeat window or when the problem changes', () => {
    const gate = new FailureAlertGate();
    const hour = 3_600_000;
    const env = { PIPELINE_ALERT_REPEAT_HOURS: '12' };
    expect(gate.shouldAlert(errors, 0, env)).toBe(true);
    expect(gate.shouldAlert(errors, hour, env)).toBe(false);
    expect(gate.shouldAlert(['sakshi_http_403'], 2 * hour, env)).toBe(true);
    expect(gate.shouldAlert(['sakshi_http_403'], 3 * hour, env)).toBe(false);
    expect(gate.shouldAlert(['sakshi_http_403'], 15 * hour, env)).toBe(true);
    gate.clear();
    expect(gate.shouldAlert(['sakshi_http_403'], 16 * hour, env)).toBe(true);
  });

  it('sends the routine status message unless it is turned off', () => {
    expect(pipelineStatusWhatsAppEnabled({})).toBe(true);
    expect(
      pipelineStatusWhatsAppEnabled({ WHATSAPP_PIPELINE_STATUS: 'false' }),
    ).toBe(false);
  });
});
