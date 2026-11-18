# Yassin follow-up issue report — November 11, 2026

> Currency correction, November 13: PAY-04 explicitly requires one platform currency;
> latest develop defines EGP. The historical mixed-currency interpretation below is
> superseded by [the PAY-04 correction and integration plan](yassin-pay04-integration-plan.md).
> Current catalogue validation/search is EGP-only, with no FX or legacy price relabelling.

Scope: the current `feature/GEN-12-shared-schemas-seeding` working tree in
`D:\Projects\travel-booking-platform`. Existing uncommitted work was preserved.
Rules were checked against the official Mandatory workbook, the work split,
`AGENTS.md`, `AI_RULES.md`, README, source, shared interfaces and tests.
No shared database, secret file, branch switch or Git publication was used.
These findings distinguish observed behavior from proposed owner contracts.

## Confirmed defects and corrections

| Finding | Evidence / change | Regression coverage |
| --- | --- | --- |
| Legacy flights without stored `bookingCount` incorrectly produce a concurrency conflict for an otherwise valid airport edit (FLT-05). | Mongoose hydrates a missing counter to zero, but the update predicate `bookingCount: 0` does not match a missing BSON field. `flights/flights.service.ts` now detects absence inside the transaction and consults `flight-booking-history.interface.ts`. Verified no history allows the edit and initializes zero atomically. Any history rejects the edit. Unknown history returns an explicit 501 integration error, rather than a misleading 409 concurrency error. | Raw BSON `$unset` reproduces the legacy shape. Tests cover unknown / historical / verified-empty history, transaction-session propagation, actual stored initialization and normal current records. |
| Event delivery bypassed EventEmitter semantics. | `flight-events.service.ts` previously called `listeners()` results directly. A `once()` subscription was not removed, and normal function listeners lost their emitter receiver. Dispatch now invokes `rawListeners()` with `handler.call(this, payload)` and awaits completion. | One-shot removal, callback receiver and retention of subsequent events without a listener. |
| The logo resolver contract lacked the target airline ID. | `airline-logo.interface.ts` now passes `resolve(assetId, actorId, airlineId)`; `airlines.service.ts` verifies target existence before resolving. This makes target-specific asset authorization implementable without inferring the airline from the actor. | Unauthorized callers never reach the resolver; the fake resolver receives the actor and target; a failing resolver leaves a combined name/logo PATCH unchanged. |

The legacy guard is a safe integration correction, **not** an automatic historical
data migration. No booking-history implementation was guessed. A legacy airport
edit remains unavailable without Omar's authoritative adapter or a separately
approved, history-verified backfill. Zero booked/held seats cannot prove that no
cancelled or expired booking ever existed. Omar must also maintain the lifetime
counter and coordinate writes through `Flight.inventoryRevision` in his booking
transactions. Never decrement `bookingCount` after cancellation or expiry.

## Confirmed teammate dependencies

### Airline logo HTTP 501 — Mohamed Hashad (FLT-01, GEN-08)

`backend/src/airlines/airlines.module.ts` currently binds
`AIRLINE_LOGO_RESOLVER` to `PendingAirlineLogoResolver`. Supplying `logoAssetId`
to `PATCH /api/airlines/:id` therefore returns 501 `NOT_IMPLEMENTED`.
Name/code-only changes work. This is a real incomplete logo-edit integration,
not completion of FLT-01/GEN-08. The test resolver only proves the handoff.

Hashad must provide and coordinate:

1. The shared authenticated image upload/storage capability, opaque asset ID,
   persisted asset metadata and a usable served URL. Verify actual file contents
   as JPG/PNG and enforce the workbook's 5 MB limit on the server, rather than
   trusting a filename, client MIME type or arbitrary submitted URL.
2. An adapter implementing the existing
   `airlines/airline-logo.interface.ts` contract:
   `resolve(assetId: string, actorId: string, airlineId: string): Promise<string>`.
   It must authorize the actor's asset and target, reject missing/deleted/invalid
   assets, and return only an approved image URL. Existing moderator guards remain
   responsible for provider assignment authorization.
3. Export the adapter from the upload module and integrate its provider into
   `AirlinesModule`, **replacing its local fallback binding**. Merely registering
   the same token globally does not override that local provider. Agree the module
   import direction before wiring it; do not duplicate upload infrastructure.
4. Coordinate single-logo replacement and cleanup: Airline has one `logoUrl`;
   replacing it must leave the previous image usable if the profile save fails.
   Asset deletion/garbage collection belongs to the upload owner. Add real upload
   tests for file format/size, asset ownership, replacement and served URLs.

No upload, audit, notification or hotel-management implementation was added here.

### Flight event consumer — Omar Hashem, with Hashad and Youssef Khafagy

Producer files: `flights/flights.service.ts`, `flight-events.service.ts`,
`schemas/flight-event.schema.ts`; registrations/exports: `flights.module.ts`.
There is no real flight-booking consumer in this working tree. Existing refund,
notification and lifecycle providers remain placeholders. Therefore real refund,
release, notification and durable business deduplication are **not verified**.

Verified transport contract:

| Property | Behavior |
| --- | --- |
| Subscription | Import the existing `FlightsModule`; register awaited `.on('flight.updated', handler)` and `.on('flight.cancelled', handler)` callbacks on its exported `FlightEventsService` during module initialization. Remove them on destruction. Avoid a second private emitter instance. Durable consumers should use `.on`, not `.once`. |
| Identity | Both topics carry stable `eventId` (outbox `_id`), `flightId`, `airlineId`, `occurredAt` (UTC ISO). Updates also carry previous/new departure and arrival UTC ISO strings. |
| Atomicity | Flight mutation and event insertion commit together. Outbox insertion failure rolls back the flight mutation. Dispatch failure after commit does not report an already-committed cancellation as failed. |
| Retry | Pending events persist with no subscriber. A 10-second poll claims up to 100 events with a 60-second lease. All currently registered handlers are awaited before acknowledgement; failures retain the event for retry. |
| Delivery limits | At least once, not exactly once. A crash after a side effect but before acknowledgement, lease expiry, or a later handler failure may replay an event. There is no durable per-subscriber offset or guaranteed per-flight ordering across workers/retries. A subscriber registered after another handler has already acknowledged an event does not get independent replay. |

Targeted tests cover failure/retry, stable identity after injected acknowledgement
loss, cancellation idempotence, transaction rollback and callback semantics. The
receipt in the replay test is an in-memory **test double**; it proves the consumer
contract, not production deduplication or actual money movement.

Omar's required integration and acceptance tests:

1. One booking orchestration consumer should durably record `(consumer, eventId)`
   and idempotent per-booking effects. Commit receipts consistently with booking
   and inventory writes; do not mark the entire event complete before every
   affected booking/effect has durable progress. Persist work for external effects
   so a crash between refund and notification cannot silently skip or duplicate it.
2. On `flight.updated`, find affected **Confirmed** bookings (including either
   round-trip segment) and issue the schedule-change notification. Handle stale,
   reordered updates and already-cancelled bookings explicitly; preserve agreed
   booking prices.
3. On `flight.cancelled`, cancel affected Confirmed bookings, request **100%**
   refunds, release unexpired pending holds exactly once, and send cancellation /
   refund notifications. A round trip or repeated event must not double-refund or
   release a counter twice. Retrying a failed side effect must resume safely.
4. Reuse `common/interfaces/refund.interface.ts` via `REFUND_SERVICE`:
   `createRefund({ bookingType: 'flight', bookingId, reason: 'flight_cancelled',
   fullRefund: true })`. The interface has no explicit idempotency key; Omar and
   refund owner Youssef must agree/enforce durable deduplication and external
   payment-provider idempotency. A returned `pending` refund is not a completed one.
5. Reuse Hashad's `NOTIFICATION_SERVICE` from
   `common/interfaces/notification.interface.ts`, including the defined
   `flight_schedule_changed`, `booking_cancelled` and `refund_issued` types.
   That interface also has no deduplication key; agree durable notification
   receipt/outbox behavior with Hashad. Do not acknowledge throwaway placeholders
   as completed business effects.
6. Implement the read-only `FlightBookingHistoryReader.hasAnyBooking(flightId,
   session)` contract over **all** booking states and both trip segments. Return
   false only when history is authoritatively absent; null means unknown.
   Replace the local fallback binding in `FlightsModule` during agreed integration.
   Serialize booking creation with catalogue edits using the same Flight document
   in the same transaction.
7. Exercise restart replay, duplicate events, concurrent cancellation, multiple
   bookings, both round-trip legs, partial refund/notification failure and lease
   expiry with the real owner modules. Those acceptance tests are still pending.

### RoomAvailability compatibility — Mohamed Hashad

Files: `hotels/schemas/{hotel,room,room-availability,hotel-policy}.schema.ts`,
`hotels/room-search.ts`, `hotels-search.service.ts`, `hotels-catalogue.module.ts`.
The shape is representationally compatible with the workbook's required
operations, **subject to owner agreement and transactional writers**. Hashad's
actual hotel booking/management implementation is absent, so its compatibility
cannot be asserted as tested.

| Operation / requirement | Existing shape and required writer behavior |
| --- | --- |
| Individual rooms and date ranges (HTL-04) | One Room per room number, unique within its hotel. Availability uses `roomId` and UTC-midnight encoded calendar dates `[startDate,endDate)`; adjacent checkout/check-in ranges do not overlap. These are calendar-date labels, not the instant a guest checks in. |
| Available / Booked / Blocked display (HTL-08) | `Available` ranges provide base coverage. `Blocked`, `Confirmed` and unexpired `Pending Payment` overlays remove availability. Displayed room state must be derived for the requested dates; `Room.status` is active/deactivated, not the stay's booking state. |
| Atomic multi-room hold and confirmation (HTL-18) | One occupancy row per reserved room can share one `bookingId`; held rows need the same authoritative 10-minute `holdExpiresAt`. Confirmation transitions the corresponding rows to `Confirmed`. Booking details/prices/passengers remain in Hashad's booking schema. |
| Expiry and cancellation (HTL-18/21) | Release/change only the matching booking's occupancy rows; preserve base Available ranges. Search ignores expired holds, blocks missing-expiry holds conservatively, and never performs booking cleanup. Whole-reservation cancellation must transition every reserved room atomically. |
| Management protection (HTL-05/06) | The index `{roomId,startDate,endDate,kind}` is not unique and does not prevent interval overlap. Use transactional per-room serialization for all management/booking writers (for example, write the same Room document/version), recheck overlaps and capacity, and protect Confirmed/unexpired held stays. A transaction that only reads overlapping rows and inserts a new row can still allow concurrent conflicting inserts. |
| Deletion/history and policy | Preserve authoritative reservation history to enforce “never reserved” deletion; absence of a current occupancy row is insufficient. HotelPolicy local check-in/out times need owner configuration. Reviews own averageRating/ratingCount. |

Do not replace this model with a second incompatible availability collection.
Agree enum names, interval boundaries, required booking references/hold expiry,
all lifecycle transitions, validation for the chosen write methods, and the
shared locking strategy before merging writer code. No management/booking
endpoints or booking lifecycle were implemented in this follow-up.

## Requirement ambiguities — clarification needed

| Question | Confirmed current behavior | Required decision |
| --- | --- | --- |
| Multiple provider currencies (FLT-15, HTL-12) | Min/max are inclusive numeric amounts in each provider's currency. Without `currency`, price sorts compare raw numbers: fixture USD 701 sorts before EGP 702 for both searches, without conversion. Explicit `currency=EGP` returns only EGP providers. Swagger now describes this limitation. | The workbook does not define a common search currency, FX source/time, rounding policy, or mandatory currency filter. Ask whether price operations must require/select one currency, group currencies, or use an explicitly specified conversion contract. Numeric ordering across currencies is not an economic cheapest-price comparison. No exchange rates or new blocking rule were invented. ITN-18 budget conversion is not sufficient authority to invent FLT/HTL search conversion. |
| Hotel “check-in is not in the past” (HTL-11) | Uses today's **UTC** calendar date. At 2099-12-01 23:30Z Dubai is already Dec 2, yet Dec 1 passes. At 2099-12-02 00:30Z New York is still Dec 1, yet Dec 1 fails. Boundary tests characterize both cases. | Clarify UTC, user's locale or hotel's local date. The workbook provides airport IANA zones but no hotel/city timezone field or explicit hotel “today” policy. GEN-06 addresses airport time display and does not settle this. Do not infer a hotel's timezone from an arbitrary airport or server timezone. If hotel-local is chosen, coordinate an authoritative hotel/city IANA field and migration, then change validation and tests. |

These are unresolved specification decisions, not claims that either current
interpretation is mandated. Existing behavior was documented rather than silently
changed. The boundary fixtures test validation even if no hotels match.

## Pagination and dataset assessment (GEN-05)

Both searches sort and paginate **after** full qualification, with stable ID
tie-breakers and ten-item pages. Flight queries already filter route, local date,
status, future departure, provider and cabin capacity in MongoDB. Hotel queries
filter destination/status/rating/currency, active rooms and overlapping ranges
before whole-stay qualification. Relevant existing indexes include the flight
route/date/status compound index, flight/cabin uniqueness, hotel destination and
status indexes, room hotel/number uniqueness and availability room/range index.

Remaining cost: all matching candidates are materialized; hotel grouping scans
free rooms per hotel. Large catalogues may need aggregation/lookup-based
qualification, indexed sorting, counts and final `$skip`/`$limit`, or an agreed
search read model. Simply applying skip/limit before cabin capacity, stay coverage,
occupancy or cheapest-room calculation would produce incorrect totals/pages.

The official references contain eight countries/cities/airports/attractions each;
that does **not** cap flights, hotels or rooms. No evaluation catalogue size or
latency target is specified in the reviewed workbook. A local synthetic test uses
500 matching flight/cabin options and 100 hotels / 1,000 rooms / 1,000 ranges,
checks globally ordered late pages and reports single-request timings. This is
a functional smoke measurement, not a production benchmark or evaluation SLA.
Database-level pagination is a scale improvement to prioritize if the team
supplies a larger evaluation fixture or measured latency/memory warrants it;
there is no independently confirmed mandatory pagination failure at the tested
scale. Obtain the expected evaluation volume before claiming optimization is
required or unnecessary.

## Verification

Executed sequentially on November 11, 2026:

| Command | Actual result |
| --- | --- |
| `npm run build` | Passed. |
| `npm run lint` | Passed, exit 0. |
| `npm test` | 55 passed, 0 failed, 7 files. |
| `npm run test:integration` | 36 passed, 0 failed, 0 skipped; includes seven new focused cases, all 14 assigned HTTP methods, Swagger schemas, actual AppModule startup and isolated seed integrity tests. |
| `npm run seed:check` | Passed: 8 countries, 8 cities, 8 airports, 8 attractions and 7 currencies; explicitly no database connection or writes. |
| `git diff --check` | Passed. |

Local single-request smoke timings from the executed test: 500 matching
flight/cabin options **179.4 ms**; 100 matching hotels / 1,000 rooms / 1,000
availability ranges **385.6 ms**. Both late-page ordering/count assertions passed.
These measurements include HTTP/application/database work on this machine and
are not a latency promise or a substitute for the actual evaluation fixture.

All database tests used disposable local MongoDB replica sets with generated
test credentials; environment-file loading was disabled. Real shared-database
data and external services are outside the verification boundary. No teammate
implementation, `common/`, `auth/` or `users/` file was changed; no branch switch,
commit, push or merge occurred. The previously exported ZIP was not regenerated
and therefore predates this follow-up.

Follow-up changes are limited to the flight service/module/controller, the new
booking-history contract, event dispatch, airline resolver/service, flight/hotel
query Swagger descriptions, `backend/test/catalogue.e2e.mjs`, README, this report,
`yassin-implementation.md` and `AI_PROMPTS.txt`. The working tree also retains the
earlier uncommitted implementation, so ordinary `git diff --stat` alone omits the
new source directories until they are tracked; see the full file inventory in
`yassin-implementation.md`. Nothing was staged as part of this review.

## Prioritized remaining actions

1. Integrate Omar's durable booking orchestration and Youssef/Hashad's real refund
   and notification services, with the failure/replay acceptance tests above.
   Agree the booking-history adapter or an approved verified legacy backfill.
2. Obtain Hashad's logo upload adapter and agree RoomAvailability writer/lifecycle
   contracts before merging hotel booking/management code.
3. Resolve search currency comparison and hotel "today" policy with the team /
   requirements authority; implement the agreed interpretation with regressions.
4. Obtain the expected evaluation catalogue volume and performance target; use
   those measurements to decide whether database-level search pagination is needed.
