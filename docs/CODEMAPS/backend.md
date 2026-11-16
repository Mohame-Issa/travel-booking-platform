<!-- Generated: 2026-11-13 | Files scanned: 127 (backend/src, non-spec) | Token estimate: ~900 -->
# Backend (NestJS 12 ESM, Mongoose 9) — `backend/src`

## Request chain
main.ts → prefix `/api` → cookieParser → ValidationPipe (common/pipes) → AuthGuard (auth/guards, global) → RolesGuard (common/guards, global) → controller → service → Mongoose model → AllExceptionsFilter (common/filters)

## Routes (owner module → service)
auth/        POST register|login|logout|refresh, PATCH change-password, GET me → AuthService, SessionsService
users/       GET|PATCH|DELETE /users/me → UsersService/AccountService; POST /admin/users/:id/reset-password → AccountService (audits)
airlines/    POST /airlines, GET|PATCH /airlines/:id, PUT /:id/baggage-policy|cancellation-policy → AirlinesService (logo → AIRLINE_LOGO_RESOLVER)
airports/    GET /airports → AirportsService
flights/     POST /flights, GET /flights/search|:id, PATCH /:id, POST /:id/cancel|cabins, PATCH /:id/cabins/:cabinId → FlightsService, FlightEventsService
hotels/      GET /hotels/search → HotelsSearchService (room-search.ts)
payments/    GET|POST /bookings/:type/:id/policies|accept-policies, POST /payments, /:id/retry, /webhook, GET /:id → PaymentsService, StripeWebhookService, PaymentExpiryService
refunds/     GET /refunds/:id → RefundsService (createRefund → NOTIFICATION_SERVICE)
audit/       GET /admin/audit-logs (admin) → AuditLogService.list                       [GEN-07]
notifications/ GET /notifications, PATCH /notifications/read-all, PATCH /notifications/:id/read → NotificationsService   [GEN-01]
uploads/     POST /uploads (multipart file), GET /uploads/files/:name (public) → UploadsService            [GEN-08]
health/      GET /health

## Shared DI tokens (common/interfaces) → binding
AUDIT_SERVICE            → audit/AuditLogService (@Global AuditModule)
NOTIFICATION_SERVICE     → notifications/NotificationsService (@Global NotificationsModule)
AIRLINE_LOGO_RESOLVER    → uploads/UploadAirlineLogoResolver (bound in AirlinesModule)
HOTEL_BOOKING_LIFECYCLE, HOTEL_BOOKING_PAYMENT_READER, HOTEL_UPCOMING_BOOKINGS_CHECKER,
FLIGHT_* (3)             → common/placeholders (TEMPORARY, 501 / false)
REFUND_SERVICE, REFUND_PREVIEW_SERVICE → refunds/

## Uploads flow (GEN-08)
client POST /api/uploads → store(): size ≤5MB, magic-byte PNG/JPEG → UPLOAD_DIR/<uuid>.<ext> + Upload row → {id,url}
owner endpoint (e.g. PATCH /airlines/:id {logoAssetId}) → attach(id, actor, {type,id}) → claims slot 0..limit-1 (unique index) → url
limits: airline 1, hotel/post/activity 5 (uploads/image-type.ts IMAGE_LIMITS)

## Key files
uploads/uploads.service.ts (store/findOwned/attach/detach/openFile)
uploads/airline-logo.resolver.ts (AirlineLogoResolver impl)
notifications/notifications.service.ts (notify/notifyMany/listMine/markRead/markAllRead)
audit/audit.service.ts (record/list)
common/utils/paginate.ts (page size 10, GEN-05)
