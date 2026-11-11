import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { SUPPORTED_CURRENCIES } from '../common/constants/currencies.js';

export interface ReferenceData {
  countries: { code: string; name: string; currency: string }[];
  cities: { city_id: string; name: string; country_code: string }[];
  airports: {
    iata_code: string;
    name: string;
    city_id: string;
    country_code: string;
    time_zone: string;
  }[];
  attractions: { attraction_id: string; name: string; city_id: string }[];
}

export async function loadReferenceData(
  directory: URL,
): Promise<ReferenceData> {
  const read = async <T>(name: string): Promise<T[]> =>
    parse(await readFile(new URL(name, directory), 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    }) as T[];
  const data: ReferenceData = {
    countries: await read('Countries.csv'),
    cities: await read('Cities.csv'),
    airports: await read('Airports.csv'),
    attractions: await read('Attractions.csv'),
  };
  validateReferenceData(data);
  return data;
}

export function validateReferenceData(data: ReferenceData): void {
  // GEN-12: validate all files before performing any database writes.
  const tables: [unknown, string[]][] = [
    [data.countries, ['code', 'name', 'currency']],
    [data.cities, ['city_id', 'name', 'country_code']],
    [
      data.airports,
      ['iata_code', 'name', 'city_id', 'country_code', 'time_zone'],
    ],
    [data.attractions, ['attraction_id', 'name', 'city_id']],
  ];
  for (const [rows, columns] of tables) {
    if (
      !Array.isArray(rows) ||
      !rows.length ||
      rows.some(
        (row: Record<string, unknown>) =>
          !row ||
          columns.some(
            (column) =>
              typeof row[column] !== 'string' ||
              !(row[column] as string).trim(),
          ),
      )
    )
      throw new Error(
        'Reference records must contain every required column as a nonempty string',
      );
  }
  const unique = (values: string[], label: string) => {
    if (
      values.some((value) => !value) ||
      new Set(values).size !== values.length
    )
      throw new Error(`Missing or duplicate identifier in ${label}`);
  };
  unique(
    data.countries.map((row) => row.code),
    'countries',
  );
  unique(
    data.cities.map((row) => row.city_id),
    'cities',
  );
  unique(
    data.airports.map((row) => row.iata_code),
    'airports',
  );
  unique(
    data.attractions.map((row) => row.attraction_id),
    'attractions',
  );
  const countries = new Map(data.countries.map((row) => [row.code, row]));
  const cities = new Map(data.cities.map((row) => [row.city_id, row]));
  for (const country of data.countries) {
    if (
      !/^[A-Z]{2}$/.test(country.code) ||
      !SUPPORTED_CURRENCIES.some((code) => code === country.currency) ||
      !country.name
    )
      throw new Error('Invalid country or unsupported currency');
  }
  for (const city of data.cities)
    if (!countries.has(city.country_code))
      throw new Error('City references unknown country');
  for (const airport of data.airports) {
    if (!/^[A-Z]{3}$/.test(airport.iata_code))
      throw new Error('Invalid airport IATA code');
    if (cities.get(airport.city_id)?.country_code !== airport.country_code)
      throw new Error(
        'Airport references unknown or inconsistent city/country',
      );
    new Intl.DateTimeFormat('en', { timeZone: airport.time_zone });
    if (!airport.time_zone.includes('/'))
      throw new Error('Airport must use its official IANA zone');
  }
  for (const attraction of data.attractions)
    if (!cities.has(attraction.city_id))
      throw new Error('Attraction references unknown city');
}
