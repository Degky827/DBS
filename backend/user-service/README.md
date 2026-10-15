# User Service (Phase 2 — standalone)

Independent Express service for **profile viewing**, **profile updating**, and **password change**. Built for standalone development without connecting to `auth-service`.

> **Not production-ready.** Authentication uses opaque development sessions (`AUTH_MODE=dev`). See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the JWT integration plan.

## Service Overview

The User Service manages user profile information for the Digital Banking and Identity Verification Platform. It operates independently from `auth-service` with its own dedicated database (`user_db`).

**Responsibilities:**
- View authenticated user profiles
- Update permitted profile fields
- Change passwords (standalone development workflow)

**Separations:**
- Does NOT own authentication tokens or sessions in production
- Does NOT integrate with `auth-service` JWT yet
- Does NOT share a database with `auth-service`

## Technology Stack

- Node.js (CommonJS), Express 5
- PostgreSQL + Prisma 7 (`@prisma/adapter-pg`)
- Zod validation, bcryptjs
- Swagger UI, pino, helmet, express-rate-limit
- Tests: Node.js built-in test runner + supertest

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 18.x |
| PostgreSQL | >= 14 |
| npm | >= 9 |
| Docker (optional) | For local Postgres via `banking-postgres` |

## Port & Database

| Item | Value |
|---|---|
| Port | `5002` |
| Database | **`user_db`** (dedicated; do not use `auth_db`) |
| Schema | `public` |
| API prefix | `/api/v1` |

## Setup

### 1. Create the development database

Using the existing local Postgres (e.g. Docker `banking-postgres` on port 5432):

```bash
# from host
docker exec -it banking-postgres psql -U auth -d postgres -c "CREATE DATABASE user_db;"
```

Or with a local `psql`:

```bash
createdb -U auth user_db
```

Do **not** run this against `auth_db`.

### 2. Configure environment

```bash
cd backend/user-service
cp .env.example .env
# edit DATABASE_URL if needed
```

Key variables (see `.env.example` for placeholders):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5002` | |
| `DATABASE_URL` | `postgresql://DB_USER:DB_PASSWORD@localhost:5432/user_db?schema=public` | Dedicated DB |
| `AUTH_MODE` | `dev` | Must stay `dev` for standalone work |
| `DEV_SESSION_TTL_MS` | `28800000` (8h) | Dev session lifetime |
| `DEV_API_KEY` | empty | If set, require header `X-Dev-Api-Key` |
| `BCRYPT_ROUNDS` | `12` | |
| `ENABLE_API_DOCS` | `true` | Swagger at `/api/v1/docs` |

### 3. Install, migrate, seed

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

### 4. Run

```bash
npm run dev      # nodemon
# or
npm start
```

Service root: `http://localhost:5002/`  
Health: `http://localhost:5002/api/v1/health`  
Swagger: `http://localhost:5002/api/v1/docs`  
OpenAPI JSON: `http://localhost:5002/api/v1/openapi.json`

## Seeded development users

| Email | Username | Password |
|---|---|---|
| `demo.user@user.local` | `demo_user` | `DemoPass@1234` |
| `profile.editor@user.local` | `profile_editor` | `ProfilePass@1234` |

These users exist **only** in `user_db`. They are not copied from auth-service.

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/health` | None | Liveness probe |
| POST | `/api/v1/auth/dev-login` | email + password | Create dev session token |
| POST | `/api/v1/auth/dev-logout` | Bearer | Revoke current session |
| GET | `/api/v1/users/me` | Bearer | View profile |
| PATCH | `/api/v1/users/me` | Bearer | Update permitted profile fields |
| PATCH | `/api/v1/users/me/password` | Bearer | Change password |

The authoritative machine-readable contract is the OpenAPI specification at `GET /api/v1/openapi.json`.

### Permitted profile update fields

`firstName`, `middleName`, `lastName`, `phoneNumber`, `gender`, `dateOfBirth`,  
`addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `country`, `bio`, `avatarUrl`

**Not allowed:** `email`, `username`, `role`, `passwordHash`

### Change password rules

- `currentPassword` must match the stored hash (wrong value → `401`, no DB write)
- `newPassword` must be **12–72 characters** (no character-class composition rules)
- `newPassword` must differ from `currentPassword`
- `confirmNewPassword` must match `newPassword`
- On success, other development sessions for the user are revoked
- Passwords are never logged or returned in responses

### Update profile rules

- Identity comes only from the server-side session (`req.user.id`)
- At least one permitted field is required (empty body → `400`)
- Unexpected/protected fields (`email`, `username`, `role`, `id`, `passwordHash`, …) are rejected (`400`), not ignored
- `dateOfBirth` must be a real past date; `middleName: ""` clears the value
- A permitted body with unchanged values still returns `200` with the profile
- Missing user → `404`

## Example session

```bash
# Login (dev)
curl -s -X POST http://localhost:5002/api/v1/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo.user@user.local","password":"DemoPass@1234"}'

# Use token from data.token
TOKEN=...

curl -s http://localhost:5002/api/v1/users/me -H "Authorization: Bearer $TOKEN"

curl -s -X PATCH http://localhost:5002/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"city":"Dire Dawa","bio":"Updated bio"}'

curl -s -X PATCH http://localhost:5002/api/v1/users/me/password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"DemoPass@1234","newPassword":"BrandNewPass@123","confirmNewPassword":"BrandNewPass@123"}'
```

## Tests

```bash
npm test
```

Tests use an isolated in-process app instance. Ensure `DATABASE_URL` points at `user_db` (not `auth_db`) before running.

### Previously reported results

| Suite | Tests | Result | Date |
|---|---|---|---|
| Automated regression (`npm test`) | 24 | 24 passed | 2026-10-15 (Step 9) |
| Live HTTP integration (E2E) | 64 | 64 passed | 2026-10-15 (Step 9) |

These are previously reported results from Step 9. They were not re-executed during Step 10.

## Response envelope

Success:

```json
{ "success": true, "message": "Profile fetched", "data": { } }
```

Error:

```json
{ "success": false, "message": "Validation failed", "errors": { "city": "..." } }
```

## Boundaries

- Does **not** modify auth-service, its database, or docker-compose.
- Does **not** integrate with auth-service JWT yet.
- Production startup with `AUTH_MODE=dev` is blocked by design.
