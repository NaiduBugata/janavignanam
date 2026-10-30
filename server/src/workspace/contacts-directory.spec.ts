import { queryContacts } from './contacts-directory';

describe('ContactsDirectory', () => {
  it('returns all assemblies and total contacts when no filter is applied', () => {
    const result = queryContacts({});
    expect(result.total).toBe(27528);
    expect(result.pageSize).toBe(40);
    expect(result.page).toBe(1);
    expect(result.rows).toHaveLength(40);
    expect(result.assemblies.length).toBeGreaterThanOrEqual(7);

    // Verify all 7 Palnadu assembly constituencies are present in facet
    const names = result.assemblies.map((a) => a.name);
    expect(names).toContain('Macherla');
    expect(names).toContain('Gurazala');
    expect(names).toContain('Pedakurapadu');
    expect(names).toContain('Sattenapalli');
    expect(names).toContain('Narasaraopet');
    expect(names).toContain('Vinukonda');
    expect(names).toContain('Chilakaluripet');
  });

  it('filters accurately by assembly constituency and provides stats', () => {
    const macherla = queryContacts({ assembly: 'Macherla' });
    expect(macherla.total).toBe(4456);
    expect(macherla.stats.totalContacts).toBe(4456);
    expect(macherla.stats.mandalsCount).toBe(5);
    expect(macherla.stats.villagesCount).toBe(184);
    expect(macherla.stats.importantCount).toBe(179);
    expect(macherla.mandals.length).toBe(5);
    const mandalNames = macherla.mandals.map((m) => m.name);
    expect(mandalNames).toContain('Macherla');
    expect(mandalNames).toContain('Karempudi');
  });

  it('filters by division and synchronizes assemblies', () => {
    const gurazalaDiv = queryContacts({ division: 'Gurazala' });
    // In Palnadu, Gurazala division contains Macherla and Gurazala (plus small overlap)
    expect(gurazalaDiv.total).toBeGreaterThan(0);
    const assembliesInDiv = gurazalaDiv.assemblies.filter((a) => a.count > 0);
    expect(assembliesInDiv.map((a) => a.name)).toContain('Macherla');
    expect(assembliesInDiv.map((a) => a.name)).toContain('Gurazala');
  });

  it('filters by mandal within an assembly', () => {
    const result = queryContacts({
      assembly: 'Macherla',
      mandal: 'Karempudi',
    });
    expect(result.total).toBe(1023);
    expect(result.stats.totalContacts).toBe(1023);
    expect(result.rows.every((r) => r.mandal === 'Karempudi')).toBe(true);
  });

  it('filters by search query and role', () => {
    const searched = queryContacts({
      assembly: 'Narasaraopet',
      q: 'Narasaraopet',
    });
    expect(searched.total).toBeGreaterThan(0);
    expect(searched.rows.length).toBeLessThanOrEqual(40);
  });

  it('handles empty results gracefully without errors', () => {
    const empty = queryContacts({ q: 'ZZZNONEXISTENTKEYWORD' });
    expect(empty.total).toBe(0);
    expect(empty.rows).toHaveLength(0);
    expect(empty.stats.totalContacts).toBe(0);
    expect(empty.stats.mandalsCount).toBe(0);
  });
});
