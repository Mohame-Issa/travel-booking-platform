<!-- Generated: 2026-11-13 | Files scanned: 127 | Token estimate: ~350 -->
# Architecture

Single NestJS backend (`backend/`), frontend is Milestone 2 (`frontend/` empty scaffold).

```
client ──HTTP /api──> AppModule
  ├─ foundation: auth, users, common (guards, pipes, filters, paginate, interfaces, placeholders)
  ├─ catalogue: airlines, airports, flights (+events outbox), hotels search, seed
  ├─ money: payments (Stripe test mode, webhook), refunds
  └─ shared services (@Global): audit, notifications, uploads
         ▲ injected by token from any module (AUDIT_SERVICE, NOTIFICATION_SERVICE, UploadsService)
MongoDB (shared) · local disk UPLOAD_DIR (images) · Stripe (test)
```

Boundaries: modules talk through DI tokens in `common/interfaces`; unmerged owners are stubbed in `common/placeholders`.
