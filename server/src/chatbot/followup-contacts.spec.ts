import {
  followupBucket,
  followupContactsIn,
  recordFollowup,
  resetFollowupContacts,
} from './followup-contacts';

describe('follow-up contacts', () => {
  beforeEach(() => resetFollowupContacts());

  it('starts with 25 recent, 25 frequent, and pending contacts on the same mock number', () => {
    expect(followupContactsIn('recent')).toHaveLength(25);
    expect(followupContactsIn('frequent')).toHaveLength(25);
    expect(followupContactsIn('pending').length).toBeGreaterThanOrEqual(5);
    expect(followupContactsIn('pending').length).toBeLessThanOrEqual(10);
    expect(
      followupContactsIn('pending').every((row) => row.phone.endsWith('7879')),
    ).toBe(true);
  });

  it('moves a pending contact to recent, then to frequent after another follow-up', () => {
    const pending = followupContactsIn('pending')[0];
    expect(followupBucket(recordFollowup(pending.id)!)).toBe('recent');
    expect(followupBucket(recordFollowup(pending.id)!)).toBe('frequent');
    expect(
      followupContactsIn('pending').some((row) => row.id === pending.id),
    ).toBe(false);
  });
});
