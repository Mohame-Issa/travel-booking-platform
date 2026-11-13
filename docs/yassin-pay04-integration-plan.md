# PAY-04 catalogue correction and integration plan

> Integration was subsequently prepared in a separate worktree without committing
> or merging branches. See [the current integration results](yassin-integration-results.md).
> The original currency workspace remains unchanged; the preparation history below
> describes the earlier work stage.

Review date: November 13, 2026. No shared database was accessed or changed.
No branch switch, merge/rebase, commit, push or staging was performed.

## Authoritative contract

The Mandatory workbook's PAY-04 requires all flight/hotel prices, payments and
refunds to use one platform currency. Fetched `origin/develop` is
`1a83d7b5a4e57d4fdb517ecb7e6582a628bc428d`. Its shared
`backend/src/common/constants/currencies.ts` defines `PLATFORM_CURRENCY = 'EGP'`.
That file documents Mohamed Amr's November 11 decision. Payment validation rejects
other currencies. Earlier reports treating mixed-provider price comparisons as
an unresolved currency interpretation were incomplete and are superseded here.
No FX source, conversion or price relabelling is required or introduced.

## Local changes

| Files | Change |
| --- | --- |
| `backend/src/common/constants/currencies.ts` | Bring only the missing PLATFORM_CURRENCY export and its comment verbatim from develop. This is the necessary shared integration; the resulting file has no diff against develop. |
| `backend/src/airlines/dto/airline.dto.ts`, `airlines/schemas/airline.schema.ts` | API and schema accept only EGP provider currency. |
| `backend/src/airlines/airlines.service.ts` | Validate internal creation too; reject monetary operations on legacy foreign-currency providers with the existing validation error format. |
| `backend/src/flights/flights.service.ts` | Require an EGP airline for creation, cabin price changes and price details; searches always select EGP airlines. Flight/CabinInventory inherit their pricing currency from the airline; no duplicate currency field is added. |
| `backend/src/flights/dto/flight.dto.ts` | Optional search currency accepts only EGP; update price/currency Swagger descriptions. |
| `backend/src/hotels/schemas/hotel.schema.ts`, `hotels/hotels-search.service.ts`, `hotels/dto/search-hotels.dto.ts` | Hotel schema accepts only EGP, search excludes legacy foreign-currency hotels, optional foreign filters return validation errors. Room rates inherit the hotel's currency. No Hashad management/booking file changes. |
| `backend/src/seed/seed-data.ts` | New demo providers use the shared constant; official country currencies stay unchanged. Existing records/passwords/assignments retain the original idempotent seed behavior. No seed was run. |
| `backend/src/flights/catalogue-schemas.spec.ts`, `backend/test/catalogue.e2e.mjs` | EGP acceptance; all six other supported currency codes rejected in schemas/DTOs/API; legacy raw-BSON fixtures excluded from unfiltered searches without modifying prices; internal service validation and blocked legacy flight pricing tested. Other valid catalogue fixtures now use EGP. |
| README, implementation/follow-up guides, AI_PROMPTS | Correct the currency interpretation, describe behavior, retain historical records and log assistance. |

Legacy foreign-currency data is not converted, reset or migrated. It is omitted
from search; direct flight price details and new price writes are rejected with
400 VALIDATION_FAILED until the provider is reviewed through a separately approved
data correction. Existing schedule/cancellation operations remain available.
Country CSV currencies and preferred itinerary display currencies remain the seven
SUPPORTED_CURRENCIES. EGP-only provider pricing is a different concern.

Hashad must use these shared hotel schemas and EGP contract in his future writers;
no hotel-management endpoint or booking behavior was implemented here. Omar's
hard-coded USD booking currency remains his issue; this patch does not fix it or
claim end-to-end payment integration. Hotel-local versus UTC "today" remains a
separate unresolved question and was not changed.

## Previously pushed work still unmerged

`1bfea8ffd925456a5ba2a2ce911aa7b99a82fa7b` is already in develop through PR #5.
Do not reapply the whole original implementation.

`cadd1262d35008832dfdf4b756b0b453b848c567` is the only current feature commit
absent from develop. Its five files are:

- `AI_PROMPTS.txt`
- `backend/src/flights/catalogue-schemas.spec.ts` — typed schema.paths fix
- `backend/scripts/omar-booking-fixtures.mjs`
- `backend/test/omar-fixtures.e2e.mjs`
- `docs/omar-booking-test-data-plan.md`

The current PAY-04 correction is uncommitted on top of that feature commit.

## Safe integration procedure — plan only, requires publication approval

1. Preserve this working tree and the untracked ZIP. Review/commit only the
   currency patch and related documentation once authorized; never add .env,
   generated output or the ZIP.
2. After approval, fetch develop again. Create a separate integration worktree /
   branch from that latest tip, leaving the current workspace intact. Do not reset,
   overwrite, rebase or force-push the existing branch.
3. Apply `cadd126` once, then the reviewed currency patch. Because the shared
   constant is already upstream, keep develop's shared currency file unchanged.
   Do not replay `1bfea8f` or copy the old AppModule/package/lock/config files over
   develop: that would remove payments/refunds and other teammate updates.
4. Reconcile AI_PROMPTS by preserving every teammate entry and appending Yassin's
   new entries once. Do not resolve conflicts by taking the entire older file.
   Preserve the TypeScript schema test fix alongside the new currency tests.
5. Review the resulting PR diff against latest develop. It must contain only
   Yassin's remaining files/edits, with no Omar/Hashad/payment/refund implementation
   changes. Omar's branch is a separate integration and must not be pulled in here.
6. Install dependencies from develop's lockfile in the isolated integration tree
   and run TypeScript no-emit, build, lint, unit tests and all three isolated API/
   database test files, including `test/omar-fixtures.e2e.mjs`. Do not run the
   fixture helper CLI or start the app against the shared database.
7. With separate authorization, publish a normal feature-branch push and a draft
   PR targeting develop. The team reviews/merges later; no direct develop/main push.

Any production/provider currency cleanup is a separate approval and migration
discussion. This task made no shared reads or writes.

## Executed verification

On November 13, 2026:

| Check | Result |
| --- | --- |
| `tsc --noEmit --incremental false --pretty false` | Passed, including the TypeScript schema test fix. |
| `npm run build` | Passed. |
| `npm run lint` | Passed. |
| `npm test` | 62 passed, 7 files. |
| `node --test --test-concurrency=1 test/phase1.e2e.mjs test/catalogue.e2e.mjs test/omar-fixtures.e2e.mjs` | 43 passed, 0 failed/skipped. Isolated local MongoDB only, no .env loading. Includes all 14 assigned HTTP methods and actual AppModule/Swagger startup with isolated configuration. |
| `git diff --check` | Passed. |
| Shared currency file versus `origin/develop` | Identical. |

One new internal-service rejection test initially asserted a synchronous exception
as an already-created promise. It was corrected to invoke the service within the
async assertion; the full integration rerun passed. No production failure was
hidden or test skipped. No shared database connection or seed/helper apply ran.
