# Omar flight-booking test data — read-only check and conditional setup

Date: November 12, 2026. Repository: `D:\Projects\travel-booking-platform`.
Yassin explicitly approved this four-record setup on November 12, 2026.
It has now been applied and independently verified; the execution record is below.
This authorization does not cover general seeding or unrelated database changes.

## Pre-creation read-only snapshot

After the connection was configured privately in the ignored `backend/.env`,
native-driver count/find queries succeeded against the configured database
`travel-platform`. No application/model startup, index creation or writes ran.

| Collection | Exact record count | Result |
| --- | --- | --- |
| airports | 8 | All eight records read; airport IDs are IATA strings. |
| airlines | 1 | Active Yassin Demo Air, code YS, currency EGP. |
| flights | 0 | No shared flight IDs currently available. |
| cabininventories | 0 | No bookable cabin inventory currently available. |

Existing airline ID: **`6af5e840db2c2f01f1792830`**, verified as BSON **ObjectId**.
Existing airports (all read from MongoDB, not inferred from the CSV):

| Airport `_id` / IATA | Name | City ID | Country | IANA zone |
| --- | --- | --- | --- | --- |
| CAI | Cairo International Airport | cairo | EG | Africa/Cairo |
| CDG | Charles de Gaulle Airport | paris | FR | Europe/Paris |
| DXB | Dubai International Airport | dubai | AE | Asia/Dubai |
| FRA | Frankfurt Airport | frankfurt | DE | Europe/Berlin |
| HND | Haneda Airport | tokyo | JP | Asia/Tokyo |
| JFK | John F. Kennedy International Airport | new_york | US | America/New_York |
| LHR | Heathrow Airport | london | GB | Europe/London |
| RUH | King Khalid International Airport | riyadh | SA | Asia/Riyadh |

Collection metadata listing was rejected with server code 8000. Independent
`countDocuments` and projected `find` queries succeeded for every collection;
the reported counts are verified. Zero records does not distinguish a missing
collection from an existing empty collection. No result was truncated.

Never paste configuration values into a prompt. The inspector uses the native
MongoDB driver and explicit projections, without importing AppModule or
registering Mongoose models. Its read-only report is restricted to:

| Collection | Allowed report fields |
| --- | --- |
| airports | `_id`, iataCode, name, cityId, countryCode, timeZone |
| airlines | `_id`, name, code, currency, status |
| flights | `_id`, airlineId, flightNumber, departureAirport, arrivalAirport, departureDate, departureTime, arrivalTime, status |
| cabininventories | `_id`, flightId, cabinClass, seatCount, bookedSeats, heldSeats, price |

No users, credentials, passenger details or booking records are read. No seed,
application startup, model initialization, index creation or database write is
part of this inspection. Reads are bounded; if counts exceed the report limits,
report truncation and retrieve further pages as needed.

For usable booking fixtures, verify that both airports really exist, the airline
is active, the flight is future/Scheduled and the cabin has enough seats:
`seatCount - bookedSeats - heldSeats`. Report the actual stored IDs and types,
especially whether airport `_id` values are the expected IATA strings or a legacy
representation. Do not rewrite legacy data during inspection. Report statuses as
stored; the read-only check must not mark flights Departed.

## Exact approved setup

Reuse the existing airline ObjectId and CAI/DXB airport string IDs. No reference,
airline, account, assignment, hotel or policy changes are proposed. No general
seed command is needed for these fixtures.

Create only these **two new Scheduled flights** and **one Economy cabin for each**:

| Proposed flight number | Route | Departure local | Arrival local | Departure UTC | Arrival UTC |
| --- | --- | --- | --- | --- | --- |
| YS9101 | CAI → DXB | 2026-11-26 10:00 Africa/Cairo | 2026-11-26 15:00 Asia/Dubai | 2026-11-26T08:00:00Z | 2026-11-26T11:00:00Z |
| YS9102 | DXB → CAI | 2026-11-29 10:00 Asia/Dubai | 2026-11-29 12:00 Africa/Cairo | 2026-11-29T06:00:00Z | 2026-11-29T10:00:00Z |

The existing local-time converter was used to verify those proposed UTC values.
Each new flight starts with bookingCount/inventoryRevision zero. Each new cabin
would have 10 seats, bookedSeats 0, heldSeats 0, fare **1,000 EGP**, freeBaggage 1
and maxBagWeightKg 23. Those are explicit test-fixture values, not new pricing rules.

This was a **four-record insert-only setup**. Actual flight/cabin ObjectIds
are recorded below from the fresh database read-back. The existing
provider/policies stayed untouched. This data
setup does not implement or verify Omar's booking/refund/hold workflows.

Before an approved run, recheck provider/reference existence, future dates,
natural-key conflicts and collection/index assumptions. Preserve existing
matching fixtures and any inventory/history; stop on unexpected conflicts.
Use a persistent fixture identity/manifest and transactions so retries cannot
duplicate fixtures. Missing collections may need creation as part of the approved
insert operation; any extra index/schema/data change must be disclosed separately.

Configuring `.env` or replying "ready" to the earlier read-only inspection did
not authorize writes. Yassin subsequently gave explicit approval for this exact
target and four-record setup. No broader write authorization was inferred.

## Safety conditions for any approved setup

1. Recheck the configured database, stored reference IDs, active provider and
   future dates immediately before an approved run. If the snapshot has changed,
   stop and revise the plan; do not silently create replacement providers/references.
2. Make setup idempotent using persistent fixture identities and the flight/cabin
   natural keys. Preserve any existing fixture's dates, inventory, status, prices
   and history. Stop on unexpected conflicts instead of overwriting records.
3. Validate the four proposed documents with the existing schemas and use one
   transaction for their creation. Any additional collection/index prerequisite
   must be disclosed before it runs; no blanket model/index initialization is allowed.
4. Do not modify existing provider/policy/reference fields, user accounts, passwords
   or moderator assignments. Do not create bookings/holds, change existing inventory,
   issue refunds, send notifications, wipe collections or execute a general seed.
5. After approved creation, rerun the read-only inventory and report the real IDs,
   routes, UTC times, cabin class, currency and free seats. Cleanup needs separate
   approval; never delete fixtures once booking history exists.

## Execution and actual IDs

The dedicated `backend/scripts/omar-booking-fixtures.mjs` helper rechecked the
target, existing provider/airport references, absent flight numbers and existing
unique indexes before insertion. It uses the real shared ValidationPipe,
CreateFlightDto, FlightsService.create and assigned-provider check. The Economy
cabins use CreateCabinDto and the existing CabinInventory schema inside the same
outer transaction. Mongoose transaction async-local storage attaches flight
creation to that transaction; no service or shared schema was rewritten.

The helper never starts AppModule, workers or event dispatchers. Model autoCreate
and autoIndex are disabled; no collection/index initialization or general seed ran
against the shared database.
An existing active assigned moderator supplies the provider-ownership context for
the offline approved task; there is no login/session creation or account change.

| Flight | Flight ObjectId | Economy cabin ObjectId | Route |
| --- | --- | --- | --- |
| YS9101 | `6af6352590d9abe3123922b7` | `6af6352590d9abe3123922b8` | CAI → DXB |
| YS9102 | `6af6352590d9abe3123922b9` | `6af6352590d9abe3123922ba` | DXB → CAI |

Both flights are Scheduled, with bookingCount 0 and inventoryRevision 0. Both
Economy cabins have seatCount 10, bookedSeats 0, heldSeats 0, price 1000 EGP,
freeBaggage 1 and maxBagWeightKg 23. The UTC/local times match the approved table.
Airport IDs are the existing **strings** CAI/DXB. Flight, cabin and airline
references were independently confirmed as BSON **ObjectIds**.

The first run committed two flights and two cabins in one transaction. MongoDB
command monitoring recorded exactly four inserts, into flights/cabininventories
only. There were no updates/deletes, account/provider/reference changes, index
commands, bookings, payments or notifications.

A second apply run returned the same IDs, created 0 flights and 0 cabins, and
recorded **zero write commands**. A separate native-driver read confirmed both
flight documents and their linked cabins. Existing matching fixtures are reused;
unexpected changes or partial/conflicting fixtures are rejected, not overwritten.
The existing unique indexes also protect concurrent runs from duplicates.

## Local verification and rerun commands

Executed successfully after the helper was added:

- `tsc --noEmit --incremental false --pretty false`: passed.
- `npm run build`: passed.
- `npm run lint`: passed.
- `npm test -- src/flights/catalogue-schemas.spec.ts`: 10 passed.
- `node --test --test-concurrency=1 test/omar-fixtures.e2e.mjs`: 5 passed on
  disposable local replica sets, without .env loading or shared-database access.
- `git diff --check`: passed.

The fixture safety tests cover no-op reruns with booked/held counts preserved,
unchanged providers/references/accounts, wrong-target rejection, all-four rollback
after an injected second-cabin failure, conflicts and concurrent duplicate prevention.

From `backend/`, the helper defaults to read-only checking:

```powershell
node --env-file-if-exists=.env scripts/omar-booking-fixtures.mjs --check
```

The exact authorized setup can be rerun with `--apply`; a matching existing setup
causes no writes. Never substitute the general seed command or broaden the target.
The helper imports compiled `dist/` services, so build first if source changes.
The fixture creation itself performed no commit, push, branch switch or merge.
Yassin subsequently approved publishing the five pending project files on the
existing feature branch. Pre-publication checks passed: TypeScript no-emit, build,
lint, all 55 unit tests and all 41 integration tests (including the five fixture
safety cases). No shared-database helper execution or writes were repeated during
publication, and no unrelated teammate implementation was changed. The old ZIP,
private .env and generated files are excluded. No merge into develop/main is part
of this publication.
