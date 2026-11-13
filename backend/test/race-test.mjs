// Fires 20 simultaneous holds at a cabin with 1 seat. Expect exactly one 201.
// Windows PowerShell:  $env:TEST_EMAIL="..."; $env:TEST_PASSWORD="..."; $env:FLIGHT_ID="..."; node scripts/race-test.mjs
const BASE = process.env.BASE ?? 'http://localhost:3000/api';
const { TEST_EMAIL, TEST_PASSWORD, FLIGHT_ID } = process.env;
const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
});
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const SEATS = Number(process.env.SEATS ?? 1);
const body = JSON.stringify({
  flightId: FLIGHT_ID, cabinClass: process.env.CABIN ?? 'Economy',
  passengers: Array.from({ length: SEATS }, (_, i) => ({
    fullName: `Race Test ${i + 1}`, dateOfBirth: '2000-01-01', passportNumber: `RACE${1000 + i}`,
  })),
});
const codes = await Promise.all(Array.from({ length: 20 }, () =>
  fetch(`${BASE}/flight-bookings/hold`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body }).then((r) => r.status)));
console.log(codes.reduce((a, c) => ((a[c] = (a[c] ?? 0) + 1), a), {}));
console.log(codes.filter((c) => c === 201).length === 1 ? 'PASS' : 'FAIL');