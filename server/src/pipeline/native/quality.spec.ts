import { qualityScore, validationIssues } from './quality';
import { scoreConstituency } from './constituency';
import { titlesMatch } from './fuzzy-title';

describe('constituency, quality, fuzzy', () => {
  it('accepts a Narasaraopet article and rejects an unrelated one', () => {
    expect(scoreConstituency('నరసరావుపేట లో రోడ్డు పనులు').valid).toBe(true);
    expect(scoreConstituency('Mumbai cinema premiere tonight').valid).toBe(
      false,
    );
  });

  it('scores summary and entities the way the Python engine does', () => {
    const score = qualityScore({
      summary: 'word '.repeat(55),
      entities: ['x'],
      people: ['y'],
      location: { district: 'Palnadu' },
    });
    expect(score).toBeGreaterThan(50);
  });

  it('flags an empty summary', () => {
    expect(
      validationIssues({
        sentiment: 'Statement',
        category: 'c',
        summary: '',
        location: {},
      }).some((i) => i.field === 'summary'),
    ).toBe(true);
  });

  it('matches near-duplicate Sakshi titles', () => {
    expect(
      titlesMatch('Narasaraopet road works', 'Narasaraopet road works today'),
    ).toBe(true);
  });
});
