# Meridian — Digital Banking & Identity Verification Platform

Secure digital banking platform with authentication, user profiles, and planned KYC, wallet, and payments modules.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Redux Toolkit, Axios |
| Auth service | Node.js, Express 5, Prisma, PostgreSQL |
| User service | Node.js, Express 5, Prisma, PostgreSQL |
| Infrastructure | Docker Compose, Swagger/OpenAPI |

## Repository layout

```
backend/
  auth-service/    # Registration, login, JWT, OTP, refresh tokens (:5001)
  user-service/    # Phase 2 profiles (standalone dev auth) (:5002)
frontend/          # React SPA
docs/              # Product phases and sources
docker-compose.yml # Postgres, auth-service, frontend, pgAdmin
```

## Quick start

### Prerequisites

- Node.js 22+
- Docker (Postgres)

### 1. Infrastructure

```bash
docker compose up -d postgres
```

### 2. Auth service (Phase 1)

```bash
cd backend/auth-service
cp .env.example .env   # if present; or copy values from .env.example patterns
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed        # optional demo users
npm run dev            # http://localhost:5001
```

Swagger: `http://localhost:5001/api/v1/docs`

### 3. User service (Phase 2 — standalone)

Uses a **separate** database (`user_db`). See `backend/user-service/README.md`.

```bash
docker exec -it banking-postgres psql -U auth -d postgres -c "CREATE DATABASE user_db;"

cd backend/user-service
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev            # http://localhost:5002
```

Swagger: `http://localhost:5002/api/v1/docs`

> User-service auth is **development-only** (`AUTH_MODE=dev`). Not production-ready until JWT integration with auth-service (`backend/user-service/docs/INTEGRATION.md`).

### 4. Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173 (or as configured)
```

Or full stack:

```bash
docker compose up --build
```

## API overview

| Service | Base URL | Endpoints |
|---|---|---|
| Auth | `http://localhost:5001/api/v1` | register, login, refresh, logout, verify-email, forgot/reset password, `/me` |
| User | `http://localhost:5002/api/v1` | dev-login, `GET/PATCH /users/me`, `PATCH /users/me/password` |

All APIs use the envelope `{ success, message, data | errors }`.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Registration, login, JWT | Done |
| 2 | Profile, update profile, change password | Done (user-service standalone) |
| 3 | KYC, documents, verification status | Planned |
| 4 | Wallet, transactions, payments | Planned |

## Security notes

- Passwords: bcrypt; refresh tokens hashed at rest
- Rate limiting and audit logging on auth-sensitive routes
- Never commit real secrets; use `.env` (gitignored)
- Production must not run `AUTH_MODE=dev`

## License

UNLICENSED — internal project.
