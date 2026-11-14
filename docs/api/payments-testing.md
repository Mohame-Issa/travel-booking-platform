# Payments and refunds: test checklist (PAY-01 to PAY-04)

Owner: Youssef Khafagy. Branch: `feature/PAY-01-stripe-payments`.
Stripe runs in **test mode only**. Never use real card numbers or live keys.

## 0. Setup (once)

1. `backend/.env` (never committed). Fill in only on your own machine:
   - `STRIPE_SECRET_KEY=sk_test_...` (Stripe dashboard, Test mode, Developers, API keys)
   - `STRIPE_WEBHOOK_SECRET=whsec_...` (printed by `stripe listen`, step 3)
2. Start the API: `cd backend && npm run start:dev`, then open http://localhost:3000/api/docs
3. In a second terminal (Stripe CLI 1.55+ requires `--events`):
   `stripe listen --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,refund.updated,refund.failed --forward-to localhost:3000/api/payments/webhook`
   Keep the app, `stripe listen` and a third terminal for commands open at the same time.
4. Register and log in a test user in Swagger (`@yourname-test.example` email).
   Delete it when you are done (AI_RULES 0.4).

## 1. Automated tests

```bash
cd backend && npm run build && npm run lint && npm test
```

Covers: refund maths (FLT-09/HTL-10 tier rule, rounding), policy acceptance,
payment creation, webhook signature checks with real signed payloads,
idempotency (replays, double clicks, double refunds), retry, hold expiry and
late payments.

## 2. Swagger checks that work today

| Request | Expected |
|---|---|
| Any payments/refunds endpoint while logged out | 401 `AUTH_REQUIRED` |
| Same endpoint as admin or moderator | 403 `INSUFFICIENT_ROLE` |
| `GET /api/bookings/car/<24-hex id>/policies` | 400 `VALIDATION_FAILED` |
| `GET /api/bookings/flight/abc/policies` | 400 `VALIDATION_FAILED` |
| `POST /api/bookings/flight/<id>/accept-policies` with `{ "accepted": false }` | 400 |
| `POST /api/payments` with an extra `"amount": 1` | 400 (amount is never accepted from the client) |
| `GET /api/payments/<unknown id>` | 404 |
| `GET /api/refunds/abc` | 400 `INVALID_ID` |
| Booking endpoints before Omar's/Hashad's readers are merged | 501 `NOT_IMPLEMENTED` |

## 3. Stripe CLI checks that work today

`stripe trigger payment_intent.*` fails on new sandbox accounts (its fixture
sends `payment_method_types`, which Stripe now rejects). Create the test
payments directly instead, with the same settings our app uses:

| Command | Expected |
|---|---|
| `stripe payment_intents create --amount=5000 --currency=egp --payment-method=pm_card_visa --confirm=true -d "automatic_payment_methods[enabled]=true" -d "automatic_payment_methods[allow_redirects]=never"` | `status: succeeded`; `stripe listen` shows `payment_intent.succeeded` then `<-- [200]`; app log "No payment for PaymentIntent ...; ignoring" |
| Same with `--payment-method=pm_card_chargeDeclined` | prints `card_declined` (expected); PaymentIntent goes back to `requires_payment_method` (what retry relies on); `stripe listen` shows `payment_intent.payment_failed` then `<-- [200]` |
| `stripe events resend evt_...` (an id from above) | `[200]`; app log "Skipping already processed event" |
| `curl.exe -X POST http://localhost:3000/api/payments/webhook -H "Content-Type: application/json" -H "stripe-signature: t=1,v1=fake" -d "{}"` | 400 `INVALID_WEBHOOK_SIGNATURE` |

`[200]` proves the signature over the raw body was verified with
`STRIPE_WEBHOOK_SECRET`. `[400]` means the secret in `.env` does not match the
current `stripe listen` session (or the app was not restarted after changing it).
"Connection refused" means the app is not running.

Verified on 2026-11-12 by Youssef Khafagy: both events answered `[200]`.

## 4. End-to-end (needs a real Pending Payment booking)

Needs Omar Hashem's / Mohamed Hashad's booking module with the
`getPaymentSnapshot` reader. Create a flight hold or hotel reservation first.

| # | Step | Expected |
|---|---|---|
| 1 | `GET /api/bookings/flight/<id>/policies` | tiers + baggage (hotel: tiers + check-in/out), `accepted: false` |
| 2 | `POST /api/payments` before accepting | 409 `POLICIES_NOT_ACCEPTED` |
| 3 | `POST .../accept-policies` with `{ "accepted": true }` | `accepted: true`, `acceptedAt` set |
| 4 | `POST /api/payments` | 201, `status: pending`, `clientSecret`, amount from the booking |
| 5 | Same request again | same payment id (no second PaymentIntent) |
| 6 | `stripe payment_intents confirm pi_... --payment-method pm_card_chargeDeclined` | webhook 200; `GET /api/payments/:id` = `failed`; booking still Pending Payment |
| 7 | `POST /api/payments/:id/retry` | 200, `status: pending`, same `stripePaymentIntentId` |
| 8 | `stripe payment_intents confirm pi_... --payment-method pm_card_visa` | webhook 200; payment `succeeded`; booking **Confirmed** |
| 9 | Cancel the booking through Omar's endpoint | refund created; `GET /api/refunds/:id` shows amount, %, tier, status |
| 10 | New booking, create payment, wait 10 minutes | app log "Payment ... expired; inventory released"; payment `cancelled`; booking Expired |

## Test cards (Stripe test mode, for Stripe Elements in Milestone 2)

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0000 0000 0002` | declined |
| `4000 0000 0000 9995` | declined, insufficient funds |
| `4000 0025 0000 3155` | requires 3D Secure authentication |

Any future expiry date, any CVC. From the CLI use the payment methods
`pm_card_visa` and `pm_card_chargeDeclined`.
