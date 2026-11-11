# Yassin Shawr: flights, search and seeding

Implementation location: `D:\Projects\travel-booking-platform`.
Branch: `feature/GEN-12-shared-schemas-seeding`. Existing uncommitted Phase 1
work was reviewed and retained. No branch switch, commit, push, PR or merge is
part of this work. The original Phase 1 design record remains in
`phase-1-yassin.md`; this document describes the current implementation.
The focused follow-up findings and owner acceptance contracts are recorded in
[`yassin-follow-up-review.md`](yassin-follow-up-review.md).

Business rules come from the Mandatory worksheet of
`requirements/Final_ SP1_Reviewed_Requirements.xlsx`, with ownership from
`requirements/Milestone_1_Work_Split.pdf`, pages 3-4.

## Scope and file review

All source paths below are relative to `backend/src/`.

| Files | Requirements and review outcome |
| --- | --- |
| `seed/schemas/reference-data.schema.ts`, `airports/schemas/airport.schema.ts` | GEN-12, FLT-02: retained official string primary keys, country/city references and IANA zones. |
| `seed/reference-data.ts`, `seed/reference-data.module.ts` | GEN-12: retained CSV parsing, duplicate/missing-field/reference checks and the exported reference model registrations. |
| `seed/seed-options.ts`, `seed/seed-data.ts`, `seed/run-seed.ts` | ACC-18, GEN-12/13: retained credential validation, salted hashes, transactions, targeted upserts and check mode. Existing accounts/assignments/provider profiles are preserved. |
| `airlines/schemas/airline.schema.ts` | FLT-01: retained unique code, logo URL, supported currency and fixture identity; required provider status. |
| `airlines/schemas/airline-policy.schema.ts`, `cancellation-tier.schema.ts` | FLT-08/09: retained bag limits and unique cancellation thresholds; corrected ObjectId schema declaration. |
| `flights/schemas/flight.schema.ts`, `catalogue.constants.ts` | FLT-03/05/30: retained local-date uniqueness and fixed statuses; corrected ObjectId declaration, required status and added the inventory revision used by transaction coordination. |
| `flights/schemas/cabin-inventory.schema.ts` | FLT-04/05/11: retained fixed cabins, counts and uniqueness; corrected reference type and finite numeric validation. |
| `hotels/schemas/hotel.schema.ts`, `room.schema.ts` | HTL-11/12: retained individual rooms, currency, ratings and status; corrected ObjectId declaration, required status and finite pricing. |
| `hotels/schemas/room-availability.schema.ts`, `hotel-policy.schema.ts` | HTL-04/09/10/11/12: retained the one shared availability model and policy shape; corrected ObjectId schema declarations. |
| `airlines/airlines.*`, `airlines/dto/airline.dto.ts`, `airlines/airline-logo.interface.ts` | FLT-01/08/09: new protected APIs and documented upload integration contract. |
| `airports/airports.*`, `airports/dto/airport.dto.ts` | FLT-02: public, filtered, read-only airport lookup with shared pagination. |
| `flights/flights.*`, `flights/dto/flight.dto.ts`, `flights/catalogue-validation.ts` | FLT-03/04/05/06/11/12/15/17/30, GEN-02/03/04/05/06/13: schedule, inventory, search, validation and local-time responses. |
| `flights/flight-events.service.ts`, `flights/schemas/flight-event.schema.ts` | FLT-05/06: transactional event persistence, awaited consumer delivery, retry and deduplication contract. |
| `flights/flight-booking-history.interface.ts` | FLT-05: proposed read-only owner adapter for legacy flights without a stored lifetime booking count; unknown history fails explicitly. |
| `hotels/hotels-catalogue.module.ts`, `hotels/hotels-search.*`, `hotels/dto/search-hotels.dto.ts`, `hotels/room-search.ts` | HTL-11/12: whole-stay, room-count, occupancy, price and rating search. |

`app.module.ts` registers AirlinesModule, AirportsModule, FlightsModule and
HotelsCatalogueModule. Public static search routes precede dynamic `:id` routes.
Authentication, account, shared guard/helper/interface and placeholder modules
were not rewritten. No hotel-management, booking, hold, passenger, payment or
refund service is introduced. There are no new package dependencies beyond the
Phase 1 csv-parse and mongodb-memory-server additions.

### ObjectId compatibility correction

Under the installed Nest/Mongoose combination, using `Types.ObjectId` as a
decorator schema type produced `Mixed` paths. Newly created flight references
were stored as strings, breaking ObjectId-based search. Yassin-owned schemas now
use `MongoSchema.Types.ObjectId` in decorators and `Types.ObjectId` as the
TypeScript field type. Tests verify the actual compiled schema path types.
No existing database records were migrated. If an earlier draft was manually
used to create records, inspect their BSON reference types before integrating;
any shared-database correction needs separate approval.

The same inspection found that Mohamed Amr's shared ModeratorAssignment schema
currently exposes moderatorId/providerId as Mixed. It was not changed here.
The seed supplies actual ObjectId values, and the real HTTP authorization tests
pass with those assignments. Amr should confirm/correct the shared declaration
before other modules create assignments from raw string IDs. This is an owner
integration issue, not a reason to introduce a duplicate assignment schema.

## API

The global prefix is `/api`. Swagger is at `/api/docs` and `/api/docs-json`.
Protected endpoints use the existing httpOnly cookie session and role guard.
Moderators may manage only their assigned airline. Profile creation is admin-only;
flight/cabin/policy modifications are airline-moderator-only.

| Method | Path | Requirement |
| --- | --- | --- |
| POST | `/api/airlines` | FLT-01 |
| GET | `/api/airlines/:id` | FLT-01 |
| PATCH | `/api/airlines/:id` | FLT-01 |
| PUT | `/api/airlines/:id/baggage-policy` | FLT-08 |
| PUT | `/api/airlines/:id/cancellation-policy` | FLT-09 |
| GET | `/api/airports` | FLT-02 |
| POST | `/api/flights` | FLT-03 |
| GET | `/api/flights/:id` | FLT-17 |
| PATCH | `/api/flights/:id` | FLT-05 |
| POST | `/api/flights/:id/cancel` | FLT-06 |
| POST | `/api/flights/:id/cabins` | FLT-04 |
| PATCH | `/api/flights/:id/cabins/:cabinId` | FLT-04/05 |
| GET | `/api/flights/search` | FLT-11/12/15 |
| GET | `/api/hotels/search` | HTL-11/12 |

Examples of request bodies:

```json
{"name":"Example Air","code":"EA","currency":"EGP"}
```

```json
{"airlineId":"<assigned-airline-object-id>","flightNumber":"EA123","departureAirport":"CAI","arrivalAirport":"DXB","departureLocal":"2026-12-01T10:00","arrivalLocal":"2026-12-01T15:00"}
```

```json
{"cabinClass":"Economy","seatCount":120,"price":4000,"freeBaggage":1,"maxBagWeightKg":23}
```

```json
{"tiers":[{"daysBefore":7,"refundPercentage":80},{"daysBefore":0,"refundPercentage":20}]}
```

Flight cancellation requires `{"confirmed":true}` and returns HTTP 200. Repeating
an already completed cancellation returns the existing cancelled flight without
creating another event. Other invalid state changes return 409. DTO validation
returns 400 with shared field-level details, missing documents return 404, and
role/provider restrictions return 401/403. Duplicate indexes return 409 through
the existing global filter. Swagger documents successful response and error schemas.

### Times, states and inventory

Create/update accepts airport-local `YYYY-MM-DDTHH:mm[:ss]`, with an optional
matching UTC offset such as `-04:00`. Native Intl IANA data converts each input
independently to UTC. Invalid dates and nonexistent DST times are rejected.
Repeated DST times require the explicit matching offset to select the intended
instant; mismatching offsets are rejected. `Z` is not a local-time input.
Responses include UTC instants, local wall times and
origin/destination airport objects with IANA zones.

Flight.departureDate is computed from the origin-local calendar date, including
departures that fall on the previous UTC date. The airline/flight-number/local-date
index is unique. Scheduled flights become Departed through a periodic worker;
search and mutations also check the exact departure cutoff immediately.

`availableSeats = seatCount - bookedSeats - heldSeats`. Only the booking owner
updates bookedSeats/heldSeats. Cabin capacity edits use an atomic database
predicate, inside a transaction, so they cannot undercut a concurrent hold.
Catalogue changes do not modify any agreed booking price. Quotes preserve the
provider's decimal fare instead of silently rounding every currency to two
decimal places. Decimal coefficients are multiplied before conversion back to
the JSON number, avoiding both 0.1 x 3 artifacts and intermediate x100 overflow.
Payment-specific minor-unit validation remains the payment owner's concern.
Unsafe numeric counts/pages and unrepresentable quote totals return validation
errors rather than silently losing precision.

Omar's booking transaction must touch `Flight.inventoryRevision` after checking
Scheduled + future departure, and increment lifetime `bookingCount` on the first
creation of each booking/segment. These writes belong in the same transaction as
the inventory change. Do not decrement lifetime bookingCount for an expired or
cancelled booking. Catalogue transactions touch the same flight document to
serialize with schedule/cancellation changes. This contract does not implement
holds or booking creation.

For legacy flights whose stored BSON `bookingCount` is absent, airport edits need
Omar's authoritative `FlightBookingHistoryReader` over every booking state and
both trip segments. Verified empty history permits the edit and initializes zero
inside the transaction; any history rejects it. The unintegrated fallback returns
501 because zero current seats is not proof of no historical bookings. No shared
data backfill was run. Existing records with stored zero retain the normal path.

### Search contracts

`GET /api/flights/search` requires departureAirport, arrivalAirport and
departureDate. Optional fields: tripType (`one-way`/`round-trip`), returnDate,
adults (default 1), children/infants (default 0), cabinClass, minPrice, maxPrice,
currency, sortBy (`price`/`duration`/`departureTime`), sortOrder (`asc`/`desc`), page.
Round trips require returnDate >= departureDate. Adults/children each use one
seat and the cabin fare; infants use no seat and cost 10%. At least one adult is
required and infants cannot exceed adults. Passenger DOB verification belongs
to Omar's booking flow (FLT-19).

The response is `{tripType, passengers, outbound:{items,meta}, return?:{items,meta}}`.
Each leg is independently paginated with page size 10. Options identify flightId
and cabinId and include local/UTC times, durationMinutes, seatsRemaining, price,
currency and totalPrice. Booking must validate the chronology and currency of
the chosen outbound/return pair and create the one payment/reference; search
does not create a booking. Empty pages use items/meta and an empty-search message.

Flight price filtering/sorting uses the displayed per-seated-passenger cabin
fare; totalPrice is the party quote. The workbook does not specify a separate
filter basis or display-currency conversion. Provider currencies are explicit;
optional currency filters narrow to one currency and no FX rate is invented.
Without that filter, min/max and price sorts currently compare raw numeric
provider amounts across currencies. This is not an economic value comparison;
the team must clarify the intended currency policy before changing it.

`GET /api/hotels/search` requires cityId and/or countryCode, checkInDate,
checkOutDate and guests; rooms defaults to 1. Optional minPrice/maxPrice,
minRating, currency, sortBy (`price`/`rating`), sortOrder and page are supported.
City/country IDs must be official and consistent. Date-only values are UTC
calendar dates, check-in cannot precede today's UTC date, and checkout is exclusive.
The UTC "today" rule is current behavior, not an explicit workbook requirement.
Hotel-local versus UTC validation requires clarification and an authoritative
timezone field if hotel-local is chosen; see the follow-up report's boundary cases.

Available rooms must be active and covered for every night, with no blocked or
confirmed overlap and no unexpired hold. Adjacent available ranges may cover the
stay; gaps do not. Expired holds do not block results. A hold without expiry is
treated conservatively as unavailable. The requested number of rooms must have
enough combined capacity. Price is the cheapest room that can participate in
such a selection; inclusive price filters apply to that value. Unrated hotels
are excluded when minRating is set. Sorting is stable with ID tie-breakers.

FlightsService.search and HotelsSearchService.search are exported for Nada's
itinerary searches. The services apply the shared validation pipe and DTO defaults
for internal callers too; reuse them instead of duplicating query logic.
Multi-airport city searches can call flight search per official
airport and combine/paginate the results in the itinerary layer.

## Teammate integration contracts

### Durable flight events: Omar Hashem

FlightsModule exports FlightEventsService. A booking consumer imports that module
and registers awaited handlers during module initialization:

```ts
this.events.on('flight.cancelled', async (event: FlightEventPayload) => {
  // Idempotently process event.eventId using the real booking/refund services.
});
```

Import FlightEventPayload from `flights/flight-events.service.js`. Both topics
contain eventId, flightId, airlineId and occurredAt (UTC ISO string). The
`flight.updated` topic additionally contains previousDepartureTime,
previousArrivalTime, departureTime and arrivalTime (UTC ISO strings).

Flight changes and their outbox events commit in one MongoDB transaction.
An outage in dispatch after that commit leaves the event pending and does not
misreport the successfully committed flight change as an HTTP failure.
The dispatcher invokes subscribed handlers and awaits completion. Without a
consumer, events remain pending. Failures retain events for retry after a
60-second lease; a worker checks every 10 seconds. Delivery is **at least once**;
consumers must deduplicate eventId and remove handlers on module destruction.
Multiple consumers should complete idempotently because a later handler failure
can cause earlier handlers to see the event again. Long-running consumers must
also handle lease expiry/replay safely.
The transport has no durable per-subscriber offsets or guaranteed per-flight
ordering across retries/workers. Use one durable booking orchestrator for the
required consequences; a late subscriber does not independently replay already
acknowledged events. `.on()` and normal callback receiver semantics are supported;
the regression also checks correct `.once()` removal, though `.once()` is unsuitable
for a continuous booking consumer. Durable deduplication and real external effects
remain unverified until owner modules are integrated.

Omar owns the affected-booking cancellations, 100% provider-cancellation refunds,
hold release, and notifications. Those consequences remain pending until his
consumer is merged; no placeholder pretends they happened.

### Hotel availability: Mohamed Hashad

The existing RoomAvailability schema remains the single inventory representation.
Rows use roomId plus UTC-midnight `[startDate,endDate)` and kind `Available`,
`Blocked`, `Pending Payment`, or `Confirmed`. Occupancy rows may reference
bookingId; held rows carry holdExpiresAt. Search consumes this representation.
Hashad must confirm and write it consistently in his management/booking module,
including atomic overlap protection and whole-reservation lifecycle transitions.
Search is an availability snapshot, not a concurrency-safe reservation.
No hotel management or booking endpoint is added here.

HotelPolicy.checkInTime/checkOutTime must be configured by the owner; no business
defaults are invented. Reviews maintain averageRating/ratingCount. Administration
uses the existing active/deactivated provider status; search excludes deactivated
providers without changing existing confirmed bookings or inventory records.

### Airline logos: Mohamed Hashad

`PATCH /api/airlines/:id` accepts optional logoAssetId. AirlinesService delegates
to AIRLINE_LOGO_RESOLVER, defined in `airlines/airline-logo.interface.ts`:
`resolve(assetId, actorId, airlineId): Promise<string>`. Hashad's implementation must verify
upload ownership, JPG/PNG, <=5MB, one airline logo and the served asset URL.
Replace the module's PendingAirlineLogoResolver binding when integrating.
Until then, logo edits return 501; name/code edits work. No independent upload
service or unverified client-provided logo URL is introduced.
The detailed upload deliverables, safe replacement behavior and local DI binding
replacement are listed in the follow-up report. The resolver test is a test double,
not validation of actual uploaded files.

## Seeding, verification and operational notes

Keep credentials only in local environment variables. Existing .env.example
contains variable names; no new secret variable is required for the runtime APIs.
Use `npm run seed:check` for CSV validation without a database connection.
It still compiles generated build output. `npm run seed` defaults to check mode
but its launcher can load the local .env file. Writes require `--apply`:

```powershell
npm run seed -- --apply --with-demo
```

Do not run that command against the team's database without explicit approval.
It seeds reference data, the admin, test moderators and assigned fixture providers.
Existing accounts are never reset. Use `--reference-only` to omit accounts and
fixture providers. Transactions require Atlas or a local replica set. Index
initialization precedes data transactions and never drops/synchronizes indexes.

Verification commands (run sequentially from backend):

```powershell
npm run build
npm run lint
npm test
npm run test:integration
npm run seed:check
```

Do not run two build commands concurrently: nest-cli.json clears generated dist.
Unit tests cover schemas, reference data, time zones, DST and room availability.
Database tests cover seed reruns, preservation and rollback. HTTP tests use real
auth cookies against a disposable local MongoDB replica set, exercise all 14
routes, inspect Swagger request/response schemas and cover inventory races and
event retries. They never load .env or use the shared database. Test credentials
are generated per run. The first integration run may download MongoDB 8.2.6.

The two initial flight-search HTTP failures exposed the Mixed/ObjectId mismatch
described above and were fixed. A subsequent review reproduced and fixed quote
rounding to zero for valid small fares, post-commit dispatch errors, compatibility
with flights predating inventoryRevision, and acceptance of unsafe pagination.
Regression tests cover these cases. Full AppModule startup and Swagger JSON are
also tested with environment-file loading disabled and a disposable local database.
Final verification on November 11, 2026:

| Command | Result |
| --- | --- |
| `npm run build` | Passed |
| `npm run lint` | Passed without warnings |
| `npm test` | 55 passed, 0 failed, 7 files |
| `npm run test:integration` | 36 passed, 0 failed; includes all 14 HTTP methods, actual AppModule startup, Swagger verification and the focused follow-up regressions |
| `npm run seed:check` | Passed; 8 countries/cities/airports/attractions each, 7 currencies; no database connection |
| `git diff --check` | Passed |

Remote develop was checked read-only and still points to da7cea2. The working
branch was not changed. No shared-database writes, real-account changes, commits,
pushes, PRs or merges occurred. Shared-database setup, real logo uploads and real affected-
booking processing cannot be verified until the corresponding owner integrations
and approved environment are available.
The latest follow-up additionally verified legacy airport-edit guards, event
callback/replay semantics, current currency/date behavior and globally sorted
late pages on a local synthetic dataset. See the dedicated follow-up report for
actual timings, unresolved requirement questions and exact owner deliverables.

## Working diff inventory

The following files differ from develop, including the retained uncommitted
Phase 1 draft. No auth/, users/ or common/ file was modified.

```text
.env.example
AI_PROMPTS.txt
README.md
backend/package-lock.json
backend/package.json
backend/src/app.module.ts
backend/src/airlines/airline-logo.interface.ts
backend/src/airlines/airlines.controller.ts
backend/src/airlines/airlines.module.ts
backend/src/airlines/airlines.service.ts
backend/src/airlines/dto/airline.dto.ts
backend/src/airlines/schemas/airline-policy.schema.ts
backend/src/airlines/schemas/airline.schema.ts
backend/src/airlines/schemas/cancellation-tier.schema.ts
backend/src/airports/airports.controller.ts
backend/src/airports/airports.module.ts
backend/src/airports/airports.service.ts
backend/src/airports/dto/airport.dto.ts
backend/src/airports/schemas/airport.schema.ts
backend/src/flights/catalogue-schemas.spec.ts
backend/src/flights/catalogue-validation.spec.ts
backend/src/flights/catalogue-validation.ts
backend/src/flights/catalogue.constants.ts
backend/src/flights/dto/flight.dto.ts
backend/src/flights/flight-booking-history.interface.ts
backend/src/flights/flight-events.service.ts
backend/src/flights/flights.controller.ts
backend/src/flights/flights.module.ts
backend/src/flights/flights.service.ts
backend/src/flights/schemas/cabin-inventory.schema.ts
backend/src/flights/schemas/flight-event.schema.ts
backend/src/flights/schemas/flight.schema.ts
backend/src/hotels/dto/search-hotels.dto.ts
backend/src/hotels/hotels-catalogue.module.ts
backend/src/hotels/hotels-search.controller.ts
backend/src/hotels/hotels-search.service.ts
backend/src/hotels/room-search.spec.ts
backend/src/hotels/room-search.ts
backend/src/hotels/schemas/hotel-policy.schema.ts
backend/src/hotels/schemas/hotel.schema.ts
backend/src/hotels/schemas/room-availability.schema.ts
backend/src/hotels/schemas/room.schema.ts
backend/src/seed/reference-data.module.ts
backend/src/seed/reference-data.spec.ts
backend/src/seed/reference-data.ts
backend/src/seed/run-seed.ts
backend/src/seed/schemas/reference-data.schema.ts
backend/src/seed/seed-data.ts
backend/src/seed/seed-options.ts
backend/test/catalogue.e2e.mjs
backend/test/phase1.e2e.mjs
docs/phase-1-yassin.md
docs/yassin-implementation.md
docs/yassin-follow-up-review.md
```
