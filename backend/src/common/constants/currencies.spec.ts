import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_CURRENCIES } from './currencies.js';

describe('SUPPORTED_CURRENCIES', () => {
  it('matches the currency column of docs/requirements/Countries.csv', () => {
    const csvPath = fileURLToPath(
      new URL('../../../../docs/requirements/Countries.csv', import.meta.url),
    );
    const [header, ...rows] = readFileSync(csvPath, 'utf8')
      .trim()
      .split(/\r?\n/);
    const col = header.split(',').indexOf('currency');
    const fromCsv = [
      ...new Set(rows.map((r) => r.split(',')[col].trim())),
    ].sort();
    expect([...SUPPORTED_CURRENCIES].sort()).toEqual(fromCsv);
  });
});
