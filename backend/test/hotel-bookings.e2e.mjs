// Mohamed Hashad: hotel reservations and inventory against a disposable local replica set.
// Never loads .env or touches the shared database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import { createValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import { AllExceptionsFilter } from '../dist/common/filters/all-exceptions.filter.js';
import { NotificationsModule } from '../dist/notifications/notifications.module.js';
import { UsersModule } from '../dist/users/users.module.js';
import { UploadsModule } from '../dist/uploads/uploads.module.js';
import { HotelBookingsModule } from '../dist/hotel-bookings/hotel-bookings.module.js';
import { HotelBookingsService } from '../dist/hotel-bookings/hotel-bookings.service.js';
import { HotelsCatalogueModule } from '../dist/hotels/hotels-catalogue.module.js';
import { HotelsModule } from '../dist/hotels/hotels.module.js';
import { HotelsService } from '../dist/hotels/hotels.service.js';

let mongo, app, db, bookings, hotels;
const DAY = 86_400_000;
const day = (n) => new Date(Date.UTC(2099, 0, 1) + n * DAY);
const iso = (n) => day(n).toISOString().slice(0, 10);
const user = () => String(new Types.ObjectId());
const code = async (promise) => {
  try {
    await promise;
  } catch (e) {
    return e.getResponse?.().code ?? e.message;
  }
  return 'resolved';
};

before(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1 } });
  class TestApp {}
  Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'hb-uploads-')) })],
      }),
      MongooseModule.forRoot(mongo.getUri('hashad_hotel_booking_tests')),
      UsersModule, // global ModeratorAssignmentsService for @ModeratorOfProvider
      NotificationsModule,
      UploadsModule,
      HotelsCatalogueModule, // first, so /hotels/search wins over /hotels/:id
      HotelBookingsModule,
      HotelsModule,
    ],
  })(TestApp);
  app = await NestFactory.create(TestApp, { logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  db = app.get(getConnectionToken());
  bookings = app.get(HotelBookingsService);
  hotels = app.get(HotelsService);
  for (const m of Object.values(db.models)) await m.init(); // build unique indexes before racing
});

after(async () => {
  if (app) await app.close();
  if (mongo) await mongo.stop();
});

async function hotelWithRooms(count, { status = 'active' } = {}) {
  const hotel = await db.model('Hotel').create({
    name: `H${Math.random()}`,
    address: 'Nile St',
    cityId: 'CAI',
    countryCode: 'EG',
    starClass: 4,
    currency: 'EGP',
    status,
  });
  const rooms = [];
  for (let i = 0; i < count; i++) {
    const room = await db.model('Room').create({
      hotelId: hotel._id,
      roomNumber: `${100 + i}`,
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNight: 1000 + i,
    });
    await db.model('RoomAvailability').create({ roomId: room._id, startDate: day(0), endDate: day(30), kind: 'Available' });
    rooms.push(room);
  }
  return { hotel, rooms };
}

const reserve = (hotel, rooms, from = 1, to = 4, userId = user()) =>
  bookings.create(
    {
      hotelId: String(hotel._id),
      checkInDate: iso(from),
      checkOutDate: iso(to),
      rooms: rooms.map((r) => ({ roomId: String(r._id), adults: 1, childrenAges: [] })),
    },
    userId,
  );

test('simultaneous requests for the last room: exactly one succeeds (HTL-18)', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(hotel, rooms)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 1);
  for (const r of results.filter((x) => x.status === 'rejected'))
    assert.equal(r.reason.getResponse().code, 'ROOM_NOT_AVAILABLE');
  assert.equal(await db.model('RoomAvailability').countDocuments({ roomId: rooms[0]._id, kind: 'Pending Payment' }), 1);
  assert.equal(await db.model('HotelBooking').countDocuments({ hotelId: hotel._id }), 1);
});

test('multi-room reservation holds all rooms or none (HTL-18)', async () => {
  const { hotel, rooms } = await hotelWithRooms(2);
  await db.model('RoomAvailability').create({ roomId: rooms[1]._id, startDate: day(2), endDate: day(3), kind: 'Blocked' });
  assert.equal(await code(reserve(hotel, rooms)), 'ROOM_NOT_AVAILABLE');
  assert.equal(await db.model('RoomAvailability').countDocuments({ roomId: rooms[0]._id, kind: 'Pending Payment' }), 0);
  assert.equal(await db.model('HotelBooking').countDocuments({ hotelId: hotel._id }), 0);
  const ok = await reserve(hotel, rooms, 5, 7);
  assert.equal(ok.rooms.length, 2);
  assert.equal(ok.totalAmount, 2 * 1000 + 2 * 1001);
});

test('adjacent bookable ranges cover a stay; a gap rejects it (HTL-04/11)', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const RA = db.model('RoomAvailability');
  await RA.deleteMany({ roomId: rooms[0]._id });
  await RA.create([
    { roomId: rooms[0]._id, startDate: day(1), endDate: day(3), kind: 'Available' },
    { roomId: rooms[0]._id, startDate: day(3), endDate: day(5), kind: 'Available' },
    { roomId: rooms[0]._id, startDate: day(6), endDate: day(9), kind: 'Available' },
  ]);
  assert.equal(await code(reserve(hotel, rooms, 4, 7)), 'ROOM_NOT_AVAILABLE');
  assert.ok((await reserve(hotel, rooms, 1, 5))._id);
});

test('confirm after verified payment: Confirmed, reference, rooms booked, one notification, idempotent (HTL-17)', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const b = await reserve(hotel, rooms);
  const paymentId = String(new Types.ObjectId());
  await bookings.confirmBooking({ bookingId: String(b._id), paymentId });
  await bookings.confirmBooking({ bookingId: String(b._id), paymentId });
  const saved = await db.model('HotelBooking').findById(b._id).lean();
  assert.equal(saved.status, 'Confirmed');
  assert.match(saved.reference, /^HB-[0-9A-F]{10}$/);
  assert.equal(saved.holdExpiresAt, null);
  const rows = await db.model('RoomAvailability').find({ bookingId: b._id }).lean();
  assert.deepEqual(rows.map((r) => [r.kind, r.holdExpiresAt]), [['Confirmed', null]]);
  assert.equal(await db.model('Notification').countDocuments({ type: 'booking_confirmed', 'data.bookingId': String(b._id) }), 1);
  const snap = await bookings.getPaymentSnapshot(String(b._id));
  assert.equal(snap.status, 'Confirmed');
  assert.equal(snap.holdExpiresAt, null);
  assert.equal(await bookings.hasUpcomingConfirmedBookings(String(saved.userId)), true);
});

test('release on failed/expired payment frees the rooms once and blocks a later confirm (PAY-01, GEN-11)', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const b = await reserve(hotel, rooms);
  await bookings.releaseInventory({ bookingId: String(b._id), reason: 'payment_expired' });
  await bookings.releaseInventory({ bookingId: String(b._id), reason: 'payment_expired' });
  assert.equal((await db.model('HotelBooking').findById(b._id).lean()).status, 'Expired');
  assert.equal(await db.model('RoomAvailability').countDocuments({ bookingId: b._id }), 0);
  assert.equal(await db.model('Notification').countDocuments({ type: 'payment_failed', 'data.bookingId': String(b._id) }), 1);
  assert.ok((await reserve(hotel, rooms))._id, 'released room is bookable again');
  const err = await bookings.confirmBooking({ bookingId: String(b._id), paymentId: String(new Types.ObjectId()) }).catch((e) => e);
  assert.equal(err.getStatus(), 409); // payments then refunds in full
});

test('a late payment after an expired hold cannot confirm rooms someone else took', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const first = await reserve(hotel, rooms);
  const past = new Date(Date.now() - 1000);
  await db.model('HotelBooking').updateOne({ _id: first._id }, { holdExpiresAt: past });
  await db.model('RoomAvailability').updateOne({ bookingId: first._id }, { holdExpiresAt: past });
  await reserve(hotel, rooms); // expired hold does not block (HTL-18)
  const err = await bookings.confirmBooking({ bookingId: String(first._id), paymentId: String(new Types.ObjectId()) }).catch((e) => e);
  assert.equal(err.getResponse().code, 'BOOKING_NOT_CONFIRMABLE');
});

test('sweep expires unpaid holds once past the webhook grace (HTL-18)', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const b = await reserve(hotel, rooms);
  await bookings.sweep(new Date(Date.now() + 11 * 60_000)); // inside the 2-minute grace
  assert.equal((await db.model('HotelBooking').findById(b._id).lean()).status, 'Pending Payment');
  await bookings.sweep(new Date(Date.now() + 13 * 60_000));
  assert.equal((await db.model('HotelBooking').findById(b._id).lean()).status, 'Expired');
});

test('sweep completes a confirmed stay once its check-out date is reached (GEN-11, HTL-23)', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const b = await reserve(hotel, rooms, 1, 3);
  await bookings.confirmBooking({ bookingId: String(b._id), paymentId: String(new Types.ObjectId()) });
  await bookings.sweep(new Date(+day(3) - 1));
  assert.equal((await db.model('HotelBooking').findById(b._id).lean()).status, 'Confirmed');
  await bookings.sweep(day(3));
  assert.equal((await db.model('HotelBooking').findById(b._id).lean()).status, 'Completed');
});

async function expireHold(booking, msAgo) {
  const at = new Date(Date.now() - msAgo);
  await db.model('HotelBooking').updateOne({ _id: booking._id }, { holdExpiresAt: at });
  await db.model('RoomAvailability').updateOne({ bookingId: booking._id }, { holdExpiresAt: at });
}

test('payment confirmation is deterministic around the hold end (HTL-18)', async () => {
  const pay = () => String(new Types.ObjectId());
  const late = await hotelWithRooms(1);
  const b1 = await reserve(late.hotel, late.rooms);
  await expireHold(b1, 3 * 60_000); // beyond the grace, rooms still free
  assert.equal(await code(bookings.confirmBooking({ bookingId: String(b1._id), paymentId: pay() })), 'BOOKING_NOT_CONFIRMABLE');

  const ok = await hotelWithRooms(1);
  const b2 = await reserve(ok.hotel, ok.rooms);
  await expireHold(b2, 30_000); // webhook latency within the grace
  await bookings.confirmBooking({ bookingId: String(b2._id), paymentId: pay() });
  assert.equal((await db.model('HotelBooking').findById(b2._id).lean()).status, 'Confirmed');

  const gone = await hotelWithRooms(1);
  const b3 = await reserve(gone.hotel, gone.rooms);
  await expireHold(b3, 30_000);
  await db.model('Room').updateOne({ _id: gone.rooms[0]._id }, { status: 'deactivated' });
  assert.equal(await code(bookings.confirmBooking({ bookingId: String(b3._id), paymentId: pay() })), 'BOOKING_NOT_CONFIRMABLE');
});

test('hotel photo limit is checked before any upload changes (GEN-08)', async () => {
  const { hotel } = await hotelWithRooms(0);
  const urls = [1, 2, 3, 4, 5].map((i) => `https://seed.example/${i}.jpg`);
  await db.model('Hotel').updateOne({ _id: hotel._id }, { photos: urls });
  const assetId = String(new Types.ObjectId());
  assert.equal(await code(hotels.update(String(hotel._id), { addPhotoAssetIds: [assetId] }, user())), 'IMAGE_LIMIT_REACHED');
  assert.deepEqual((await db.model('Hotel').findById(hotel._id).lean()).photos, urls);
});

test('deactivated hotels cannot be booked', async () => {
  const { hotel, rooms } = await hotelWithRooms(1, { status: 'deactivated' });
  assert.equal(await code(reserve(hotel, rooms)), 'PROVIDER_DEACTIVATED');
});

test('inventory edits never override reservations (HTL-04/05/06)', async () => {
  const { hotel, rooms } = await hotelWithRooms(1);
  const [hid, rid] = [String(hotel._id), String(rooms[0]._id)];
  const b = await reserve(hotel, rooms, 2, 4);
  await bookings.confirmBooking({ bookingId: String(b._id), paymentId: String(new Types.ObjectId()) });
  assert.equal(await code(hotels.editAvailability(hid, rid, { action: 'block', startDate: iso(3), endDate: iso(5) })), 'RESERVATION_CONFLICT');
  assert.equal(await code(hotels.editAvailability(hid, rid, { action: 'remove', startDate: iso(1), endDate: iso(3) })), 'RESERVATION_CONFLICT');
  assert.equal(await code(hotels.updateRoom(hid, rid, { status: 'deactivated' })), 'RESERVATION_CONFLICT');
  assert.equal(await code(hotels.deleteRoom(hid, rid)), 'ROOM_HAS_RESERVATIONS');
  assert.equal(await code(hotels.addAvailability(hid, rid, { startDate: iso(10), endDate: iso(40) })), 'AVAILABILITY_OVERLAP');
  await hotels.editAvailability(hid, rid, { action: 'remove', startDate: iso(10), endDate: iso(12) });
  const avail = await db.model('RoomAvailability').find({ roomId: rooms[0]._id, kind: 'Available' }).sort({ startDate: 1 }).lean();
  assert.deepEqual(avail.map((r) => [r.startDate, r.endDate]), [[day(0), day(10)], [day(12), day(30)]]);
  const cal = await hotels.calendar(hid, { startDate: iso(0), endDate: iso(30) });
  assert.ok(cal[0].ranges.some((r) => r.status === 'Booked' && r.reference));
  const free = await hotels.freeRooms(hid, iso(5), iso(8));
  assert.deepEqual(free.map((r) => [r.nights, r.totalPrice]), [[3, 3000]]);
});

test('GET /api/hotels/search is not captured by GET /api/hotels/:id', async () => {
  const res = await request(app.getHttpServer()).get('/api/hotels/search');
  assert.notEqual(res.body.code, 'INVALID_ID');
});
