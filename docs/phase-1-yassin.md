# Yassin Shawr: Phase 1 schemas and seeding

> Historical Phase 1 design record. The current complete catalogue/search APIs,
> compatibility corrections, verification and integration contracts are described
> in [yassin-implementation.md](yassin-implementation.md). Statements below about
> missing runtime APIs or unchanged AppModule describe the original Phase 1 state.

This change implements the shared data layer for Yassin's section on pages 3-4
of `docs/requirements/Milestone_1_Work_Split.pdf`. Business requirements come
from the workbook's Mandatory sheet. It does not implement search, provider
management, booking, payment, refund, image upload or notification workflows.
There are no new HTTP endpoints in Phase 1, so no Swagger routes are added.

## Repository baseline and boundaries

Work started from `origin/develop` at `da7cea2` on
`feature/GEN-12-shared-schemas-seeding`. A fresh fetch on November 11, 2026
found no newer integration changes or teammate feature modules on develop.
The existing auth/accounts foundation and `common/` remain unchanged.
`app.module.ts` is unchanged; importing schemas has no effect on running APIs.

## Models and original identifiers

All schemas use explicit collection names and timestamps. Relative imports end
in `.js`. Cross-provider references use ObjectIds; reference-data IDs stay strings.

| Model | Collection | Identifier / important fields |
| --- | --- | --- |
| Country | countries | `_id = code` from Countries.csv; name, currency |
| City | cities | `_id = city_id`; cityId, name, countryCode |
| Airport | airports | `_id = iata_code`; iataCode, name, cityId, countryCode, timeZone |
| Attraction | attractions | `_id = attraction_id`; attractionId, name, cityId |
| Airline | airlines | unique code; name, logoUrl, currency, status |
| Flight | flights | airlineId, flightNumber, departureAirport, arrivalAirport, departureTime, arrivalTime, departureDate, status, bookingCount |
| CabinInventory | cabininventories | unique flightId + cabinClass; seatCount, bookedSeats, heldSeats, price, freeBaggage, maxBagWeightKg |
| AirlinePolicy | airlinepolicies | unique airlineId; extraBagPrice, maxExtraBags, cancellationTiers |
| Hotel | hotels | name, address, cityId, countryCode, description, photos, starClass, amenities, currency, status, averageRating, ratingCount |
| Room | rooms | unique hotelId + roomNumber; type, beds, maxOccupancy, pricePerNight, status |
| RoomAvailability | roomavailabilities | roomId, startDate, endDate, kind; optional bookingId, holdExpiresAt |
| HotelPolicy | hotelpolicies | unique hotelId; checkInTime, checkOutTime, cancellationTiers |

`ReferenceDataModule` exports all four reference model registrations. Other
feature modules can register the supplied schemas using `MongooseModule.forFeature`;
do not create second versions of these entities.

Supported currencies remain the existing `SUPPORTED_CURRENCIES` constant.
Country records persist the same currency codes; there is no competing currency
collection or enum. Tests compare the constant with the actual CSV values.
The official files currently contain eight countries, cities, airports and
attractions, and seven distinct currencies.

`departureTime` and `arrivalTime` are UTC dates. `departureDate` is the departure
airport's local calendar date, used by the unique airline/flight-number/date index
(FLT-03). Phase 2 services must convert airport-local inputs using Airport.timeZone,
validate future departures and the reference airport list, and update Scheduled
flights to Departed when due (FLT-02/03/30, GEN-06). This phase only defines the
fields and static schema invariants; it does not implement these workflows.

Cabin classes are exactly Economy, Premium Economy, Business and First (FLT-04).
Model validation rejects fractional counts, negative booked/held seats and total
counts above capacity (FLT-05). Atomic hold and capacity-edit checks still belong
in the appropriate future services: a Mongoose validation hook does not make
concurrent updates safe. Cabin prices and policies must be snapshotted by booking
owners so later catalogue edits do not change agreed booking prices.

Provider status is `active` or `deactivated`; Hotel.averageRating is `null` for
unrated hotels, otherwise 1-5. Reviews must maintain it together with ratingCount.
Room status uses the same active/deactivated values. Hotel management owns
validation of referenced cities/countries and non-overlapping availability writes.
MongoDB references alone do not enforce foreign keys or interval exclusion.

## Coordination still required before booking integration

These are proposed schema contracts, not agreements already obtained:

- **Mohamed Hashad:** confirm RoomAvailability representation. This proposal uses
  UTC-midnight calendar-date ranges `[startDate, endDate)` with kinds `Available`,
  `Blocked`, `Pending Payment`, `Confirmed`. The optional bookingId/holdExpiresAt
  fields support integration, but no reservation or hold logic is implemented.
  Confirm overlap protection and inventory writing with his management/booking
  module before implementing hotel search. Confirm that empty HotelPolicy fields
  are explicitly configured rather than inventing default check-in/check-out times.
- **Omar Hashem:** confirm CabinInventory fields and the lifetime `Flight.bookingCount`
  marker. The proposed counter must include historical bookings, including cancelled
  and expired ones, so airport edits can be locked after any booking (FLT-05).
  His booking module owns counter changes, concurrency, holds and release logic.
- **Mohamed Hashad:** the airline logo URL is reserved for his upload service.
  No independent upload implementation or unvalidated URL-write endpoint is added.
- **Omar Rashed:** provider administration and reviews must use the existing status
  and averageRating/ratingCount fields when those modules are merged.

Cancellation tiers share `{ daysBefore, refundPercentage }`, with unique integer
thresholds >= 0 and percentages between 0 and 100 (FLT-09, HTL-10). Selection and
refund calculation are future service responsibilities.

## Safe seed process

Run from `backend/`:

```powershell
npm run seed:check
```

This compiles and checks all CSVs, duplicate IDs, cross-file references, IANA time
zones and supported currencies. It does not load `.env`, connect to MongoDB or write.

`npm run seed` also defaults to check mode. Its launcher can load `backend/.env`
locally when the operator intentionally prepares an actual seed. Never paste its
values into a prompt or commit that file.

Actual seeding requires an approved target and the explicit `--apply` flag.
No shared-database seed was run while implementing this change. Do not run the
commands below against the team's database until Yassin explicitly approves it.

```powershell
# Official references and the initial administrator:
npm run seed -- --apply

# Also create test airline/hotel moderators and their assigned fixture providers:
npm run seed -- --apply --with-demo

# Official references only; no accounts or fixture providers:
npm run seed -- --apply --reference-only
```

Variable names, with blank values, are documented in `/.env.example`:
MONGODB_URI, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD,
SEED_AIRLINE_MODERATOR_EMAIL, SEED_AIRLINE_MODERATOR_PASSWORD,
SEED_HOTEL_MODERATOR_EMAIL, SEED_HOTEL_MODERATOR_PASSWORD.

Credentials reuse `IsValidPassword` and email validation. Passwords are salted
with bcrypt; seeded moderators must change theirs. No passwords are printed.
The seed function accepts an explicit connection and never loads environment files.

Reference records are upserted by their official string IDs, setting only official
fields. Existing custom fields and unrelated records remain intact. Existing
accounts keep their passwords, status, profile and password-change flag. Existing
moderator assignments must already match; conflicting roles or assignments fail
rather than changing a teammate's data. All data writes use one transaction;
Atlas or a local replica set is required. Creating missing collections/indexes
happens before that transaction, and those structural changes can remain if a
later transaction fails. Existing indexes are not dropped or synchronized.

Optional fixture providers use immutable unique `seedKey` values. Reruns retain
their IDs even after their profiles/codes change. A collision with an unrelated
airline's unique code is an error, never a reason to repurpose that provider.
Setup failures return a nonzero exit code and a redacted message.

## Verification

```powershell
npm run build
npm run lint
npm test
npm run test:integration
npm run seed:check
```

Unit tests validate official references, currencies, password rules, schema
invariants and enum boundaries. Integration tests start a disposable local
MongoDB replica set using mongodb-memory-server, with no `.env` loading or access
to the shared database. They check repeated seeding, preserved fields and accounts,
salted passwords, moderator/provider references, transaction rollback and unique
indexes. The first run may download the MongoDB test binary.
