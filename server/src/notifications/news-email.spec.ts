import { newsEmailContent, sendNewArticlesEmail } from './news-email';

describe('new articles email', () => {
  const at = new Date('2026-09-29T08:09:28.757Z');

  it('lists critical issues first with the same fields as the old WhatsApp alert', () => {
    const { subject, html } = newsEmailContent(
      [
        {
          title: 'Janasena joining',
          summary: 'A youth leader joined <b>Janasena</b>',
          source: 'youtube',
          location: { district: 'Palnadu' },
          source_url: 'https://youtu.be/x',
        },
        {
          title: 'Drainage overflow',
          problem: 'Sewage on the main road',
          sentiment: 'Problem',
          severity: 'high',
          source: 'lokal',
          location: { town: 'Narasaraopet' },
          source_url: 'javascript:alert(1)',
        },
      ],
      at,
    );
    expect(subject).toMatch(
      /^MediaSphere: 2 new articles, 1 critical \| .+ IST$/,
    );
    expect(html.indexOf('CRITICAL ISSUE: Drainage overflow')).toBeLessThan(
      html.indexOf('Janasena joining'),
    );
    expect(html).toContain('<strong>Problem:</strong> Sewage on the main road');
    expect(html).toContain('<strong>Priority:</strong> HIGH');
    expect(html).toContain('<strong>Priority:</strong> INFO');
    expect(html).toContain('<strong>Location:</strong> Narasaraopet');
    expect(html).toContain('A youth leader joined &lt;b&gt;Janasena&lt;/b&gt;');
    expect(html).toContain('href="https://youtu.be/x"');
    expect(html).not.toContain('javascript:');
  });

  it('sends nothing when the cycle added no article or news email is turned off', async () => {
    const fetchImpl = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    await expect(
      sendNewArticlesEmail({ articles: [], fetchImpl }),
    ).resolves.toMatchObject({ skipped: true, skip_reason: 'no_new_articles' });
    const previous = process.env.NEWS_EMAIL_ENABLED;
    process.env.NEWS_EMAIL_ENABLED = 'false';
    await expect(
      sendNewArticlesEmail({ articles: [{ title: 'x' }], fetchImpl }),
    ).resolves.toMatchObject({ skip_reason: 'news_email_disabled' });
    if (previous === undefined) delete process.env.NEWS_EMAIL_ENABLED;
    else process.env.NEWS_EMAIL_ENABLED = previous;
  });
});
