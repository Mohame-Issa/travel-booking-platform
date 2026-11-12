// Disposable local databases only. Never loads .env or imports AppModule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  AIRLINE_ID,
  createOmarFixtures,
  inspectOmarFixtures,
} from '../scripts/omar-booking-fixtures.mjs';
import { loadReferenceData } from '../dist/seed/reference-data.js';
import { seedData } from '../dist/seed/seed-data.js';

async function localFixture(t) {
  const mongo = await MongoMemoryReplSet.create({
    binary: { version: '8.2.6' },
    replSet: { count: 1 },
  });
  const connection = await mongoose
    .createConnection(mongo.getUri('travel-platform'), {
      monitorCommands: true,
    })
    .asPromise();
  t.after(async () => {
    await connection.close();
    await mongo.stop();
  });
  const data = await loadReferenceData(
    new URL('../../docs/requirements/', import.meta.url),
  );
  await seedData(connection, data); // This disposable local instance only, no accounts or demo seed.
  await connection
    .model('Airline')
    .create({
      _id: new mongoose.Types.ObjectId(AIRLINE_ID),
      name: 'Yassin Demo Air',
      code: 'YS',
      currency: 'EGP',
    });
  const moderatorId = new mongoose.Types.ObjectId();
  await connection.db
    .collection('users')
    .insertOne({
      _id: moderatorId,
      role: 'airline_moderator',
      status: 'active',
      mustChangePassword: true,
    });
  await connection
    .model('ModeratorAssignment')
    .create({
      moderatorId,
      providerType: 'airline',
      providerId: new mongoose.Types.ObjectId(AIRLINE_ID),
      assignedBy: null,
    });
  await connection.db
    .collection('flights')
    .createIndex(
      { airlineId: 1, flightNumber: 1, departureDate: 1 },
      { unique: true },
    );
  await connection.db
    .collection('cabininventories')
    .createIndex({ flightId: 1, cabinClass: 1 }, { unique: true });
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
        'findAndModify',
      ].includes(event.commandName)
    )
      writes.push({
        command: event.commandName,
        collection: event.command[event.commandName],
      });
  });
  // The explicitly approved fixture dates are fixed; tests must remain independent of wall-clock date.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 12, 12) });
  return { connection, writes };
}

test(
  'fixture setup uses real flight validation, inserts only four records, and preserves inventory on rerun',
  { timeout: 240000 },
  async (t) => {
    const { connection, writes } = await localFixture(t);
    const preserved = async () =>
      JSON.stringify(
        await Promise.all(
          ['airports', 'airlines', 'users', 'moderatorassignments'].map(
            (name) =>
              connection.db.collection(name).find().sort({ _id: 1 }).toArray(),
          ),
        ),
      );
    const before = await preserved();
    assert.equal(
      (await inspectOmarFixtures(connection)).flights[0].flightId,
      null,
    );
    assert.deepEqual(writes, []);
    const first = await createOmarFixtures(connection);
    assert.equal(first.createdFlights, 2);
    assert.equal(first.createdCabins, 2);
    assert.ok(
      first.flights.every(
        (item) =>
          item.flightId &&
          item.cabinId &&
          item.status === 'Scheduled' &&
          item.availableSeats === 10 &&
          item.price === 1000,
      ),
    );
    assert.equal(
      first.flights[0].departureTime.toISOString(),
      '2026-11-26T08:00:00.000Z',
    );
    assert.equal(
      first.flights[1].arrivalTime.toISOString(),
      '2026-11-29T10:00:00.000Z',
    );
    assert.ok(
      writes.every(
        (write) =>
          write.command === 'insert' &&
          ['flights', 'cabininventories'].includes(write.collection),
      ),
    );
    assert.equal(await preserved(), before);
    await connection.db
      .collection('cabininventories')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(first.flights[0].cabinId) },
        { $set: { bookedSeats: 3, heldSeats: 1 } },
      );
    writes.length = 0;
    const repeat = await createOmarFixtures(connection);
    assert.equal(repeat.createdFlights, 0);
    assert.equal(repeat.createdCabins, 0);
    assert.deepEqual(
      repeat.flights.map((item) => [item.flightId, item.cabinId]),
      first.flights.map((item) => [item.flightId, item.cabinId]),
    );
    assert.equal(repeat.flights[0].bookedSeats, 3);
    assert.equal(repeat.flights[0].heldSeats, 1);
    assert.equal(repeat.flights[0].availableSeats, 6);
    assert.deepEqual(writes, []);
    assert.equal(await preserved(), before);
  },
);

test(
  'fixture setup rejects the wrong database without writes',
  { timeout: 240000 },
  async (t) => {
    const { connection, writes } = await localFixture(t);
    await assert.rejects(
      createOmarFixtures(connection.useDb('wrong-target')),
      /Unexpected target/,
    );
    assert.deepEqual(writes, []);
  },
);

test(
  'second cabin insertion failure rolls back both flights and cabins',
  { timeout: 240000 },
  async (t) => {
    const { connection } = await localFixture(t);
    await inspectOmarFixtures(connection);
    const model = connection.model('CabinInventory'),
      original = model.create;
    let calls = 0;
    model.create = function (...args) {
      if (++calls === 2) throw new Error('Isolated test fault');
      return original.apply(this, args);
    };
    try {
      await assert.rejects(
        createOmarFixtures(connection),
        /Isolated test fault/,
      );
    } finally {
      model.create = original;
    }
    assert.equal(await connection.db.collection('flights').countDocuments(), 0);
    assert.equal(
      await connection.db.collection('cabininventories').countDocuments(),
      0,
    );
  },
);

test(
  'existing fixture changes are rejected without overwriting them',
  { timeout: 240000 },
  async (t) => {
    const { connection, writes } = await localFixture(t);
    const first = await createOmarFixtures(connection);
    const id = new mongoose.Types.ObjectId(first.flights[0].cabinId);
    await connection.db
      .collection('cabininventories')
      .updateOne({ _id: id }, { $set: { price: 2000 } });
    writes.length = 0;
    await assert.rejects(
      createOmarFixtures(connection),
      /will not be overwritten/,
    );
    assert.deepEqual(writes, []);
    assert.equal(
      (await connection.db.collection('cabininventories').findOne({ _id: id }))
        .price,
      2000,
    );
  },
);

test(
  'concurrent fixture runners reuse unique identities without duplicate records',
  { timeout: 240000 },
  async (t) => {
    const { connection } = await localFixture(t);
    const [first, second] = await Promise.all([
      createOmarFixtures(connection),
      createOmarFixtures(connection),
    ]);
    assert.deepEqual(
      first.flights.map((item) => item.flightId),
      second.flights.map((item) => item.flightId),
    );
    assert.equal(await connection.db.collection('flights').countDocuments(), 2);
    assert.equal(
      await connection.db.collection('cabininventories').countDocuments(),
      2,
    );
  },
);
