import { describe, expect, it } from 'vitest';
import { buildCityGroups } from './city-groups.js';

const START = new Date('2026-12-01T00:00:00Z');
const days = (...cities: string[]) =>
  cities.map((cityId, i) => ({ dayNumber: i + 1, cityId }));

describe('buildCityGroups (ITN-09)', () => {
  it('groups consecutive days in the same city', () => {
    expect(
      buildCityGroups(START, days('cairo', 'cairo', 'luxor', 'cairo')),
    ).toEqual([
      {
        cityId: 'cairo',
        firstDayNumber: 1,
        lastDayNumber: 2,
        dayCount: 2,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
      },
      {
        cityId: 'luxor',
        firstDayNumber: 3,
        lastDayNumber: 3,
        dayCount: 1,
        startDate: '2026-12-03',
        endDate: '2026-12-03',
      },
      {
        cityId: 'cairo',
        firstDayNumber: 4,
        lastDayNumber: 4,
        dayCount: 1,
        startDate: '2026-12-04',
        endDate: '2026-12-04',
      },
    ]);
  });

  it('crosses month and year boundaries', () => {
    const groups = buildCityGroups(
      new Date('2026-12-30T00:00:00Z'),
      days('dubai', 'dubai', 'dubai'),
    );
    expect(groups[0]).toMatchObject({
      startDate: '2026-12-30',
      endDate: '2027-01-01',
      dayCount: 3,
    });
  });

  it('no days -> no groups', () => {
    expect(buildCityGroups(START, [])).toEqual([]);
  });
});
