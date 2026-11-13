// Approved four-record setup. Default mode is read-only; never starts Nest/AppModule.
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import { ProviderType, UserRole } from '../dist/common/constants/roles.js';
import { ModeratorAssignmentsService } from '../dist/users/moderator-assignments.service.js';
import {
  ModeratorAssignment,
  ModeratorAssignmentSchema,
} from '../dist/users/schemas/moderator-assignment.schema.js';
import { AirlinesService } from '../dist/airlines/airlines.service.js';
import { PendingAirlineLogoResolver } from '../dist/airlines/airline-logo.interface.js';
import {
  Airline,
  AirlineSchema,
} from '../dist/airlines/schemas/airline.schema.js';
import {
  AirlinePolicy,
  AirlinePolicySchema,
} from '../dist/airlines/schemas/airline-policy.schema.js';
import { AirportsService } from '../dist/airports/airports.service.js';
import {
  Airport,
  AirportSchema,
} from '../dist/airports/schemas/airport.schema.js';
import { FlightsService } from '../dist/flights/flights.service.js';
import { FlightEventsService } from '../dist/flights/flight-events.service.js';
import { PendingFlightBookingHistoryReader } from '../dist/flights/flight-booking-history.interface.js';
import {
  CreateFlightDto,
  CreateCabinDto,
} from '../dist/flights/dto/flight.dto.js';
import { localToUtc } from '../dist/flights/catalogue-validation.js';
import { Flight, FlightSchema } from '../dist/flights/schemas/flight.schema.js';
import {
  CabinInventory,
  CabinInventorySchema,
} from '../dist/flights/schemas/cabin-inventory.schema.js';
import {
  FlightEvent,
  FlightEventSchema,
} from '../dist/flights/schemas/flight-event.schema.js';

export const AIRLINE_ID = '6af5e840db2c2f01f1792830';
const target = 'travel-platform';
const definitions = [
  {
    flightNumber: 'YS9101',
    departureAirport: 'CAI',
    arrivalAirport: 'DXB',
    departureLocal: '2026-11-26T10:00',
    arrivalLocal: '2026-11-26T15:00',
  },
  {
    flightNumber: 'YS9102',
    departureAirport: 'DXB',
    arrivalAirport: 'CAI',
    departureLocal: '2026-11-29T10:00',
    arrivalLocal: '2026-11-29T12:00',
  },
];
const cabinBody = {
  cabinClass: 'Economy',
  seatCount: 10,
  price: 1000,
  freeBaggage: 1,
  maxBagWeightKg: 23,
};
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

function context(connection) {
  requireCondition(
    connection.name === target,
    'Unexpected target database; no fixture writes permitted',
  );
  const model = (entity, schema) => {
    if (connection.models[entity.name]) return connection.models[entity.name];
    const copy = schema.clone();
    copy.set('autoCreate', false);
    copy.set('autoIndex', false);
    return connection.model(entity.name, copy);
  };
  const models = {
    flights: model(Flight, FlightSchema),
    cabins: model(CabinInventory, CabinInventorySchema),
    airlines: model(Airline, AirlineSchema),
    airports: model(Airport, AirportSchema),
    policies: model(AirlinePolicy, AirlinePolicySchema),
    assignments: model(ModeratorAssignment, ModeratorAssignmentSchema),
    events: model(FlightEvent, FlightEventSchema),
  };
  const assignments = new ModeratorAssignmentsService(models.assignments);
  const airlines = new AirlinesService(
    models.airlines,
    models.policies,
    assignments,
    new PendingAirlineLogoResolver(),
  );
  const airports = new AirportsService(models.airports);
  const events = new FlightEventsService(models.events); // No lifecycle hooks, dispatcher or timers.
  const service = new FlightsService(
    models.flights,
    models.cabins,
    models.airlines,
    models.events,
    airports,
    airlines,
    assignments,
    events,
    new PendingFlightBookingHistoryReader(),
  );
  return { ...models, assignmentsService: assignments, service };
}

async function assertIndexes(connection) {
  for (const [collection, key] of [
    ['flights', { airlineId: 1, flightNumber: 1, departureDate: 1 }],
    ['cabininventories', { flightId: 1, cabinClass: 1 }],
  ]) {
    const indexes = await connection.db
      .collection(collection)
      .listIndexes()
      .toArray();
    requireCondition(
      indexes.some(
        (index) =>
          index.unique &&
          !index.partialFilterExpression &&
          !index.sparse &&
          JSON.stringify(index.key) === JSON.stringify(key),
      ),
      `Required unique index missing on ${collection}; no index will be created`,
    );
  }
}

async function readState(connection, ctx, session = null) {
  const provider = await ctx.airlines
    .findById(AIRLINE_ID)
    .session(session)
    .lean();
  requireCondition(
    provider?.name === 'Yassin Demo Air' &&
      provider.code === 'YS' &&
      provider.status === 'active' &&
      provider.currency === 'EGP',
    'Existing approved airline differs; stop without modifying it',
  );
  const airports = await ctx.airports
    .find({ _id: { $in: ['CAI', 'DXB'] } })
    .session(session)
    .lean();
  const zones = new Map(
    airports.map((airport) => [airport._id, airport.timeZone]),
  );
  requireCondition(
    airports.length === 2 &&
      airports.every((airport) => airport._id === airport.iataCode) &&
      zones.get('CAI') === 'Africa/Cairo' &&
      zones.get('DXB') === 'Asia/Dubai',
    'Official CAI/DXB references do not match the approved plan',
  );
  const validation = createValidationPipe();
  const cabinDto = await validation.transform(cabinBody, {
    type: 'body',
    metatype: CreateCabinDto,
  });
  const matches = await ctx.flights
    .find({
      flightNumber: { $in: definitions.map((item) => item.flightNumber) },
    })
    .session(session)
    .lean();
  const entries = [];
  for (const definition of definitions) {
    const dto = await validation.transform(
      { ...definition, airlineId: AIRLINE_ID },
      { type: 'body', metatype: CreateFlightDto },
    );
    const expected = {
      departureTime: localToUtc(
        dto.departureLocal,
        zones.get(dto.departureAirport),
      ),
      arrivalTime: localToUtc(dto.arrivalLocal, zones.get(dto.arrivalAirport)),
      departureDate: dto.departureLocal.slice(0, 10),
    };
    const found = matches.filter(
      (item) => item.flightNumber === dto.flightNumber,
    );
    requireCondition(
      found.length <= 1,
      'Duplicate fixture flight numbers exist; stop without modifying them',
    );
    const flight = found[0];
    let cabin;
    if (flight) {
      requireCondition(
        String(flight.airlineId) === AIRLINE_ID &&
          flight.departureAirport === dto.departureAirport &&
          flight.arrivalAirport === dto.arrivalAirport &&
          +flight.departureTime === +expected.departureTime &&
          +flight.arrivalTime === +expected.arrivalTime &&
          flight.departureDate === expected.departureDate,
        'Existing flight conflicts with the approved fixture; it will not be overwritten',
      );
      const foundCabins = await ctx.cabins
        .find({ flightId: flight._id, cabinClass: cabinDto.cabinClass })
        .session(session)
        .lean();
      requireCondition(
        foundCabins.length === 1,
        'Existing fixture flight must already have exactly one Economy cabin; no partial fixture repair is authorized',
      );
      cabin = foundCabins[0];
      requireCondition(
        Object.entries(cabinBody).every(([key, value]) => cabin[key] === value),
        'Existing fixture cabin differs; prices and capacity will not be overwritten',
      );
      requireCondition(
        Number.isInteger(cabin.bookedSeats) &&
          Number.isInteger(cabin.heldSeats) &&
          cabin.bookedSeats >= 0 &&
          cabin.heldSeats >= 0 &&
          cabin.bookedSeats + cabin.heldSeats <= cabin.seatCount,
        'Existing fixture inventory is invalid; no counters will be reset',
      );
    } else {
      requireCondition(
        expected.departureTime > new Date() &&
          expected.arrivalTime > expected.departureTime,
        'Approved fixture dates are no longer future/valid; obtain approval for new dates',
      );
    }
    entries.push({ dto, expected, flight, cabin });
  }
  return { provider, zones, cabinDto, entries };
}

async function existingActor(connection, ctx, session) {
  const assignments = await ctx.assignments
    .find({
      providerId: new mongoose.Types.ObjectId(AIRLINE_ID),
      providerType: ProviderType.AIRLINE,
    })
    .session(session)
    .lean();
  const ids = assignments.map((assignment) => assignment.moderatorId);
  const users = await connection.db
    .collection('users')
    .find(
      { _id: { $in: ids }, role: UserRole.AIRLINE_MODERATOR, status: 'active' },
      { projection: { _id: 1, role: 1 }, session },
    )
    .toArray();
  requireCondition(
    users.length === 1,
    'Exactly one existing active assigned airline moderator is required; no account will be created or changed',
  );
  // Offline task explicitly approved by the operator, not a login/session or password change.
  const actor = { id: String(users[0]._id), role: users[0].role };
  await ctx.assignmentsService.assertCanManage(
    actor,
    ProviderType.AIRLINE,
    AIRLINE_ID,
  );
  return actor;
}

function report(state, createdFlights = 0, createdCabins = 0) {
  return {
    database: target,
    airlineId: AIRLINE_ID,
    airline: state.provider.name,
    currency: state.provider.currency,
    createdFlights,
    createdCabins,
    flights: state.entries.map(({ dto, expected, flight, cabin }) => ({
      flightNumber: dto.flightNumber,
      flightId: flight ? String(flight._id) : null,
      departureAirport: dto.departureAirport,
      arrivalAirport: dto.arrivalAirport,
      departureLocal: dto.departureLocal,
      departureTimeZone: state.zones.get(dto.departureAirport),
      departureTime: expected.departureTime,
      arrivalLocal: dto.arrivalLocal,
      arrivalTimeZone: state.zones.get(dto.arrivalAirport),
      arrivalTime: expected.arrivalTime,
      status: flight?.status ?? 'not-created',
      cabinId: cabin ? String(cabin._id) : null,
      cabinClass: cabinBody.cabinClass,
      seatCount: cabin?.seatCount ?? 10,
      price: cabin?.price ?? 1000,
      bookedSeats: cabin?.bookedSeats ?? null,
      heldSeats: cabin?.heldSeats ?? null,
      availableSeats: cabin
        ? cabin.seatCount - cabin.bookedSeats - cabin.heldSeats
        : null,
      freeBaggage: cabinBody.freeBaggage,
      maxBagWeightKg: cabinBody.maxBagWeightKg,
    })),
  };
}

export async function inspectOmarFixtures(connection) {
  const ctx = context(connection);
  await assertIndexes(connection);
  return report(await readState(connection, ctx));
}

export async function createOmarFixtures(connection) {
  const ctx = context(connection);
  await assertIndexes(connection); // Read-only metadata; never create/sync indexes.
  await readState(connection, ctx); // Complete preflight before the transaction can write.
  connection.base.set('transactionAsyncLocalStorage', true);
  let created;
  try {
    created = await connection.transaction(async (session) => {
      const state = await readState(connection, ctx, session);
      const actor = await existingActor(connection, ctx, session);
      let count = 0;
      for (const entry of state.entries) {
        if (entry.flight) continue; // Never reset counters, prices, status or history on rerun.
        // Real DTO + FlightsService.create: ownership, active airline, airports, IANA UTC conversion and FLT-03 rules.
        const flight = await ctx.service.create(entry.dto, actor);
        // Same CreateCabinDto + CabinInventorySchema as the API, inside this outer transaction.
        // createCabin() starts its own transaction; new uncommitted flights need no inventory revision update.
        await ctx.cabins.create([{ ...state.cabinDto, flightId: flight._id }], {
          session,
        });
        count++;
      }
      return count;
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const state = await readState(connection, ctx);
    requireCondition(
      state.entries.every((entry) => entry.flight && entry.cabin),
      'Concurrent fixture setup is incomplete; rerun the check, never overwrite',
    );
    return report(state);
  }
  return report(await readState(connection, ctx), created, created);
}

async function main() {
  let connection;
  let stage = 'configuration';
  try {
    requireCondition(
      process.argv
        .slice(2)
        .every((flag) => flag === '--check' || flag === '--apply') &&
        !(process.argv.includes('--check') && process.argv.includes('--apply')),
      'Use --check or --apply',
    );
    requireCondition(
      Boolean(process.env.MONGODB_URI),
      'MONGODB_URI must be configured privately',
    );
    connection = await mongoose
      .createConnection(process.env.MONGODB_URI, {
        autoCreate: false,
        autoIndex: false,
        monitorCommands: true,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      })
      .asPromise();
    const writes = [];
    connection.getClient().on('commandStarted', (event) => {
      if (
        [
          'insert',
          'update',
          'delete',
          'create',
          'createIndexes',
          'drop',
          'dropDatabase',
          'findAndModify',
        ].includes(event.commandName)
      ) {
        writes.push({
          command: event.commandName,
          collection: event.command[event.commandName],
          documents: event.command.documents?.length ?? null,
        });
      }
    });
    stage = 'preflight';
    const before = await inspectOmarFixtures(connection);
    console.log(JSON.stringify({ mode: 'preflight-read-only', ...before }));
    if (!process.argv.includes('--apply')) return;
    stage = 'transaction and read-back';
    const result = await createOmarFixtures(connection);
    console.log(
      JSON.stringify(
        { mode: 'apply-and-verify', ...result, observedWriteCommands: writes },
        null,
        2,
      ),
    );
  } catch (error) {
    // Never dump driver errors, URIs, account documents or environment values.
    console.error(
      JSON.stringify({
        ok: false,
        stage,
        errorType: error?.name ?? 'UnknownError',
        code: typeof error?.code === 'number' ? error.code : null,
        details:
          'Suppressed; inspect the controlled preflight and database state before retrying',
      }),
    );
    process.exitCode = 1;
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
