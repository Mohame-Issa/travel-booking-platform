import { dayDate } from './itinerary-dates.js';

export interface CityGroup {
  cityId: string;
  firstDayNumber: number;
  lastDayNumber: number;
  dayCount: number;
  /** Date of the first day, YYYY-MM-DD. */
  startDate: string;
  /** Date of the last day, YYYY-MM-DD. */
  endDate: string;
}

/**
 * ITN-09: consecutive days in the same city form one group.
 * Example: Cairo, Cairo, Luxor, Cairo -> [Cairo x2] [Luxor x1] [Cairo x1].
 * `days` must be sorted by dayNumber. Recomputed on every read, so deleting
 * or reordering days (ITN-07, ITN-08) always gives the right groups.
 */
export function buildCityGroups(
  startDate: Date,
  days: { dayNumber: number; cityId: string }[],
): CityGroup[] {
  const groups: CityGroup[] = [];
  for (const day of days) {
    const last = groups.at(-1);
    if (last && last.cityId === day.cityId) {
      last.lastDayNumber = day.dayNumber;
      last.dayCount += 1;
      last.endDate = dayDate(startDate, day.dayNumber);
    } else {
      const date = dayDate(startDate, day.dayNumber);
      groups.push({
        cityId: day.cityId,
        firstDayNumber: day.dayNumber,
        lastDayNumber: day.dayNumber,
        dayCount: 1,
        startDate: date,
        endDate: date,
      });
    }
  }
  return groups;
}
