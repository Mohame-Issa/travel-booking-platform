import 'reflect-metadata';
import mongoose from 'mongoose';
import { loadReferenceData } from './reference-data.js';
import { seedData } from './seed-data.js';
import {
  validateSeedOptions,
  type SeedAccount,
  type SeedOptions,
} from './seed-options.js';

async function run() {
  const flags = new Set(process.argv.slice(2));
  if (
    [...flags].some(
      (flag) =>
        !['--check', '--apply', '--reference-only', '--with-demo'].includes(
          flag,
        ),
    )
  )
    throw new Error(
      'Supported seed flags: --check, --apply, --reference-only, --with-demo',
    );
  if (flags.has('--check') && flags.has('--apply'))
    throw new Error('--check cannot be combined with --apply');
  if (flags.has('--reference-only') && flags.has('--with-demo'))
    throw new Error('--reference-only cannot be combined with --with-demo');
  const data = await loadReferenceData(
    new URL('../../../docs/requirements/', import.meta.url),
  );
  if (!flags.has('--apply')) {
    console.log(
      JSON.stringify({
        mode: 'check',
        countries: data.countries.length,
        cities: data.cities.length,
        airports: data.airports.length,
        attractions: data.attractions.length,
        currencies: [
          ...new Set(data.countries.map((country) => country.currency)),
        ].sort(),
      }),
    );
    console.log(
      'No database connection or writes. Use --apply only after approving the target database.',
    );
    return;
  }
  const credentials = (prefix: string): SeedAccount => {
    const email = process.env[`${prefix}_EMAIL`],
      password = process.env[`${prefix}_PASSWORD`];
    if (!email || !password)
      throw new Error(
        `Set ${prefix}_EMAIL and ${prefix}_PASSWORD locally; values are never logged`,
      );
    return { email, password };
  };
  const options: SeedOptions = {};
  if (!flags.has('--reference-only')) options.admin = credentials('SEED_ADMIN');
  if (flags.has('--with-demo'))
    options.demo = {
      airlineModerator: credentials('SEED_AIRLINE_MODERATOR'),
      hotelModerator: credentials('SEED_HOTEL_MODERATOR'),
    };
  validateSeedOptions(options);
  if (!process.env.MONGODB_URI)
    throw new Error('MONGODB_URI is required in backend/.env');
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(
      'Seed complete:',
      JSON.stringify(await seedData(mongoose.connection, data, options)),
    );
  } finally {
    await mongoose.disconnect();
  }
}

try {
  await run();
} catch {
  // Connection and database errors can contain credential-bearing URLs or account data.
  // Print only our controlled setup messages; never dump the driver error.
  console.error(
    'Seeding failed. Check the seed environment variable names, CSV references, account roles and database access. Existing accounts and assignments are preserved.',
  );
  process.exitCode = 1;
}
