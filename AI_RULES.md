# AI Rules – Travel Booking Platform Backend

**Give this file to your AI tool at the start of every session**, together with
the requirements sheet and your section of the work split. It describes how the
code in `develop` is organised. Follow it so all 7 parts fit together.

---

## 0. Hard rules

1. Build **only your own section** of `Milestone_1_Work_Split.pdf`. Do not
   create your own copy of a schema, service or guard that a teammate owns.
   If you need something that is not merged yet, ask its owner. You can also
   use the interface in `backend/src/common/interfaces`.
2. Business rules and limits come from the **Mandatory** sheet of
   `Final_ SP1_Reviewed_Requirements.xlsx`. Quote the requirement ID in a
   code comment next to the rule. If a rule is unclear, ask the team. Do not guess.
3. **Never** paste `.env` contents, passwords, tokens or connection strings
   into an AI tool. Never commit `backend/.env`. Add new variable *names* to
   `/.env.example`.
4. **We all share one database.** Never drop or wipe a collection. Never run
   `deleteMany({})`. Delete only test data you created yourself. Tip: use a
   recognisable email domain such as `@yourname-test.example`.
5. Branch from `develop`: `feature/<REQ-ID>-<short-description>`. Never commit
   to `main` or `develop`. Open a PR into `develop` that lists the requirement IDs.
6. Commits: `feat(hotels): add room availability`, `fix(auth): ...`, `docs(api): ...`.
7. Add material prompts to `AI_PROMPTS.txt` using the format in the project
   description.

## 1. Folders

```
backend/src/
  common/            shared building blocks (team leader). Don't edit without asking.
    constants/       roles.ts (UserRole, UserStatus, ProviderType), error-codes.ts, pagination.ts
    decorators/      @Public, @Roles, @CurrentUser
    dto/             PaginationQueryDto, ErrorResponseDto, ApiPaginatedResponse
    exceptions/      ApiException
    guards/          RolesGuard (global), @CheckOwnership, @ModeratorOfProvider
    interfaces/      shared service contracts + DI tokens
    pipes/           global ValidationPipe, ParseObjectIdPipe
    placeholders/    TEMPORARY stand-ins for teammates' services
    utils/           paginate(), paginateArray()
  config/            environment validation
  auth/              login, sessions, cookies (Mohamed Amr)
  users/             User + ModeratorAssignment schemas, profile (Mohamed Amr)
  <feature>/         one folder per feature module, e.g. hotels/, flight-bookings/
```

Inside a feature module:

```
hotels/
  hotels.module.ts
  hotels.controller.ts
  hotels.service.ts          business logic + DB access
  schemas/hotel.schema.ts
  dto/create-hotel.dto.ts
  dto/hotel-response.dto.ts
```

Controllers stay thin: validate input (DTO), call the service, return the
result. All rules and database work belong in the service.

## 2. Naming

| Thing | Style | Example |
|---|---|---|
| Files | kebab-case, with a type suffix | `hotel-bookings.service.ts`, `create-hotel.dto.ts` |
| Classes | PascalCase | `HotelBookingsService`, `CreateHotelDto` |
| Schema class / model name | singular PascalCase | `HotelBooking` (inject with `HotelBooking.name`) |
| Collections | set explicitly, lowercase plural | `@Schema({ collection: 'hotelbookings', timestamps: true })` |
| Fields | camelCase; references end in `Id` | `userId`, `hotelId`, `checkInDate` |
| Routes | plural kebab-case nouns under `/api` | `/api/hotel-bookings/:id/cancel` |
| Error codes | UPPER_SNAKE_CASE in `error-codes.ts` | `ROOM_NOT_AVAILABLE` |
| Booking states | use `BookingStatus` enum | `BookingStatus.CONFIRMED` |

## 3. ESM imports (this project uses Nest 12 / ESM)

- Relative imports **must end in `.js`**, even though the file is `.ts`:
  `import { HotelsService } from './hotels.service.js';`
- `Connection` and `HydratedDocument` are **types only** in mongoose. Import
  them with `import type { Connection } from 'mongoose'` or
  `import { type Connection } from 'mongoose'`. Otherwise the app crashes at
  startup with *"does not provide an export named 'Connection'"*. `Model`,
  `Types` and `isValidObjectId` are normal imports.

## 4. Validation (GEN-02, GEN-13)

- A global `ValidationPipe` is already on. Every body and query **must** be a
  DTO class with `class-validator` decorators. Unknown fields are rejected
  automatically.
- Query numbers need `@Type(() => Number)` (from `class-transformer`).
- Route ids: `@Param('id', ParseObjectIdPipe) id: string`.
- Add `@ApiProperty()` / `@ApiPropertyOptional()` to every DTO field so Swagger shows it.
- Password rules: reuse `@IsValidPassword()` from `auth/password.rules.ts`.

## 5. Errors

Every error response has this shape (the global filter builds it):

```json
{ "statusCode": 409, "error": "Conflict", "code": "ROOM_NOT_AVAILABLE",
  "message": "This room is not available for the selected dates",
  "details": [{ "field": "checkIn", "messages": ["..."] }],
  "path": "/api/hotel-bookings", "timestamp": "..." }
```

- For business-rule errors throw `ApiException` with a code from
  `common/constants/error-codes.ts`. Add your module's codes to that file in your PR:
  ```ts
  throw new ApiException(HttpStatus.CONFLICT, ErrorCode.ROOM_NOT_AVAILABLE, 'This room is not available');
  ```
- `NotFoundException('Hotel not found')` etc. also work and get a generic code.
- Do not catch errors only to re-format them. Do not send `res.status(...).json(...)` yourself.
- Mongo duplicate-key and invalid-id errors are converted automatically (409 / 400).
- Document errors in Swagger: `@ApiNotFoundResponse({ type: ErrorResponseDto })`.

## 6. Pagination (GEN-05)

Page size is fixed at **10**.

```ts
// DTO
export class SearchHotelsQueryDto extends PaginationQueryDto { /* your filters */ }

// Service
return paginate(this.hotelModel, filter, { page: query.page, sort: { pricePerNight: 1 } });
// -> { items: [...], meta: { page, pageSize: 10, totalItems, totalPages } }

// Controller (Swagger)
@ApiPaginatedResponse(HotelResponseDto)
```

For results built in memory (e.g. combined flight legs) use `paginateArray(list, page)`.

## 7. Authentication and guards

**Every route requires login by default.** The global `AuthGuard` checks the
httpOnly cookie, the 30-minute session, account status and forced password
change. Then the global `RolesGuard` checks `@Roles`.

| Need | Use |
|---|---|
| Guests may call it (search, public posts) | `@Public()` |
| Any logged-in user | nothing extra |
| Only some roles | `@Roles(UserRole.ADMIN)`, `@Roles(UserRole.HOTEL_MODERATOR, UserRole.ADMIN)` |
| The logged-in user | `@CurrentUser() user: AuthenticatedUser` or `@CurrentUser('id') userId: string` |
| Only the owner (ACC-11) | `@CheckOwnership({ model: Itinerary.name })` (options: `param`, `ownerField`, `bypassRoles`) |
| Moderator of the provider in the URL | `@ModeratorOfProvider(ProviderType.HOTEL)` or `@ModeratorOfProvider(ProviderType.HOTEL, 'hotelId')` |
| Moderator check when the provider id is NOT in the URL | inject `ModeratorAssignmentsService` and call `assertCanManage(user, ProviderType.AIRLINE, String(flight.airlineId))` in your service |
| Which provider a moderator owns | `ModeratorAssignmentsService.findByModerator(user.id)` |

Notes:
- Add `@ApiCookieAuth()` to protected controllers so Swagger shows the lock icon.
- Admins always pass the moderator-provider check. Use `@Roles` to decide
  whether admins may use the route at all.
- `ModeratorAssignmentsService` and `UsersService` are global, so you don't
  need to import `UsersModule`.
- **Never** read tokens yourself or put tokens in a response body.
- **Never** return a User document directly. Use `toPublicUser()` from
  `users/dto/user-response.dto.ts`, or select only the fields you need.
  To show an author, populate `name` only.
- Deactivated users (ACC-12) have `status: 'deactivated'`. Owners of posts,
  public itineraries, comments and reviews must hide or label their content
  ("Deleted user") based on that status.

## 8. Shared services (`common/interfaces`)

Inject through the token, typed by the interface, never through the concrete class:

```ts
constructor(@Inject(AUDIT_SERVICE) private readonly audit: AuditService) {}
```

| Token | Interface | Owner |
|---|---|---|
| `AUDIT_SERVICE` | `AuditService.record()` | Mohamed Hashad |
| `NOTIFICATION_SERVICE` | `NotificationService.notify()/notifyMany()` | Mohamed Hashad |
| `HOTEL_BOOKING_LIFECYCLE` | `BookingLifecycleService.confirmBooking()/releaseInventory()` | Mohamed Hashad |
| `HOTEL_UPCOMING_BOOKINGS_CHECKER` | `UpcomingConfirmedBookingsChecker` | Mohamed Hashad |
| `FLIGHT_BOOKING_LIFECYCLE` | `BookingLifecycleService` | Omar Hashem |
| `FLIGHT_UPCOMING_BOOKINGS_CHECKER` | `UpcomingConfirmedBookingsChecker` | Omar Hashem |
| `REFUND_SERVICE` | `RefundService.createRefund()` | Youssef Khafagy |
| `REFUND_PREVIEW_SERVICE` | `RefundPreviewService.previewRefund()` | Youssef Khafagy |
| `FLIGHT_BOOKING_PAYMENT_READER` | `BookingPaymentReader.getPaymentSnapshot()` | Omar Hashem |
| `HOTEL_BOOKING_PAYMENT_READER` | `BookingPaymentReader.getPaymentSnapshot()` | Mohamed Hashad |

Until the owner merges, `common/placeholders/placeholder-integrations.module.ts`
provides a **temporary placeholder** for each token. **Owners:** when you implement
yours, bind it in your module and export it, then delete the placeholder entry
in the same PR (instructions are at the top of that file). If you need to
change an interface, agree it with the team first, because other modules
depend on it.

## 9. Schemas

- `@Schema({ timestamps: true, collection: '...' })`. Use `HydratedDocument<T>`
  for the document type.
- Reference other documents with `Types.ObjectId` plus `ref: 'ModelName'`.
- Union and enum props need an explicit type: `@Prop({ type: String, enum: [...] })`.
- Money: store amounts as numbers in the provider's currency, plus a `currency` field.
- Dates: store UTC `Date`. Convert to airport local time only for display (GEN-06).

## 10. Before opening a PR

1. `cd backend && npm run build && npm run lint && npm test` all pass.
2. Start the app (`npm run start:dev`) and try every endpoint in Swagger
   (`http://localhost:3000/api/docs`), including error cases.
3. Delete the test data you created.
4. Check that `git status` shows no `.env` and no unrelated files.
