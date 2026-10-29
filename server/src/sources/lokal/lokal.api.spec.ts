import { buildLokalPageUrl, fetchLokalPage } from './lokal.api';

describe('lokal api', () => {
  it('builds the Flask page URL', () => {
    expect(buildLokalPageUrl(2)).toBe(
      'https://telugu.getlokalapp.com/api/posts?tag_id=374&post_type=1,2&page_size=100&page=2',
    );
  });

  it('retries 429 then returns JSON', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return { status: 429, json: async () => ({}) } as Response;
      }
      return {
        status: 200,
        json: async () => ({ results: [{ id: 1 }] }),
      } as Response;
    }) as typeof fetch;
    const body = await fetchLokalPage(1, fetchImpl);
    expect(calls).toBe(2);
    expect(body).toEqual({ results: [{ id: 1 }] });
  });
});
