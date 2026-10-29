import { parseRecipients } from './report-email';

describe('parseRecipients', () => {
  it('reads plain, quoted, bracketed, and named addresses', () => {
    expect(parseRecipients('a@x.com,b@y.org').valid).toEqual([
      'a@x.com',
      'b@y.org',
    ]);
    expect(parseRecipients('"a@x.com"').valid).toEqual(['a@x.com']);
    expect(parseRecipients('["a@x.com", "b@y.org"]').valid).toEqual([
      'a@x.com',
      'b@y.org',
    ]);
    expect(parseRecipients('a@x.com; b@y.org').valid).toEqual([
      'a@x.com',
      'b@y.org',
    ]);
    expect(parseRecipients('Desk <a@x.com>').valid).toEqual(['a@x.com']);
    expect(parseRecipients('mailto:a@x.com').valid).toEqual(['a@x.com']);
  });

  it('counts entries that are not addresses', () => {
    expect(parseRecipients('REPORT_RECIPIENTS=')).toEqual({
      valid: [],
      invalid: 1,
    });
    expect(parseRecipients('')).toEqual({ valid: [], invalid: 0 });
  });
});
