# Travel Planning and Booking Platform

Software Project I, Winter 2026. NestJS backend, MongoDB Atlas, Swagger UI
(Milestone 1). The Next.js frontend comes in Milestone 2.

- Requirements: `docs/requirements/` (the Excel **Mandatory** sheet is authoritative)
- Team coding rules for humans and AI tools: [`AI_RULES.md`](AI_RULES.md)
- AI prompt log: [`AI_PROMPTS.txt`](AI_PROMPTS.txt)

## Backend setup

You need **Node.js 22 or newer** (`node -v`) and git.

1. Get the code and switch to the integration branch:
   ```bash
   git clone <repo-url>
   cd travel-booking-platform
   git checkout develop
   ```
2. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
3. Create your environment file. Copy `/.env.example` to `backend/.env`:
   ```bash
   cp ../.env.example .env
   ```
   Then open `backend/.env` and fill in:
   - `MONGODB_URI`: the shared Atlas connection string the team leader sends you privately.
   - `JWT_SECRET`: generate your own with `openssl rand -hex 32` and paste the output.
   - Leave the optional values empty unless you need them.

   `backend/.env` is git-ignored. Never commit it or paste it into an AI tool.
4. Start the API in watch mode:
   ```bash
   npm run start:dev
   ```
   You should see `Connected to database "..."` and the Swagger URL.
5. Open Swagger UI at **http://localhost:3000/api/docs**.
   Check that `GET /api/health` returns `"database": "connected"`.

### Trying protected endpoints in Swagger

1. `POST /api/auth/register`, then `POST /api/auth/login` with the same email
   and password.
2. The browser now holds httpOnly cookies, and every following "Try it out"
   request sends them automatically. `GET /api/auth/me` shows who you are.
3. The access token lasts 15 minutes. Call `POST /api/auth/refresh` to get a
   new one. After 30 minutes without any request the session expires and you
   must log in again.

If login works but `/api/auth/me` still says `AUTH_REQUIRED`, your browser is
refusing Secure cookies on `http://localhost` (Safari does this). Use Chrome or
Firefox, or set `COOKIE_SECURE=false` in your `backend/.env`.

### Useful commands (run in `backend/`)

| Command | What it does |
|---|---|
| `npm run start:dev` | Run the API and restart on file changes |
| `npm run build` | Compile to `dist/` (must pass before a PR) |
| `npm run lint` | Lint the code |
| `npm test` | Run unit tests |

## Git workflow

- `main`: stable milestone releases. `develop`: integration branch.
- Branch from the latest `develop`: `feature/<REQ-ID>-<description>`,
  e.g. `feature/HTL-16-hotel-booking`.
- Commit messages: `feat(hotels): add room availability`.
- Open a pull request into `develop` that lists the requirement IDs. The team
  leader reviews and merges.
