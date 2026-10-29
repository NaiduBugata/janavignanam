import { isReligionStory } from './religion';

describe('religion filter', () => {
  it('drops worship and devotional items', () => {
    expect(isReligionStory('13/9/2026 ఆదివారం ఆరాధన నరసరావుపేట')).toBe(true);
    expect(isReligionStory('Sunday worship at Narasaraopet')).toBe(true);
    expect(isReligionStory('Village bhajan programme')).toBe(true);
  });

  it('keeps a civic story that only mentions a place of worship', () => {
    expect(isReligionStory('Theft reported near the Vinukonda temple')).toBe(
      false,
    );
    expect(isReligionStory('పూజ్యులు సభకు హాజరయ్యారు')).toBe(false);
    expect(isReligionStory('Road repair in Narasaraopet')).toBe(false);
  });
});
