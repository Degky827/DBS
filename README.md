# Meridian — Digital Banking & Identity Verification Platform

Secure digital banking platform with authentication, user profiles, a KYC verification service, and planned wallet and payments modules.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Redux Toolkit, Axios |
| Auth service | Node.js, Express 5, Prisma, PostgreSQL |
| User service | Node.js, Express 5, Prisma, PostgreSQL |
| KYC service | Node.js, Express 5, Prisma, PostgreSQL |
| Infrastructure | Docker Compose, Swagger/OpenAPI |

## Repository layout

```
backend/
  auth-service/    # Registration, login, JWT, OTP, refresh tokens (:5001)
  user-service/    # Phase 2 profiles (standalone dev auth) (:5002)
  kyc-service/     # KYC submissions and verification workflow (:5003)
frontend/          # React SPA
docs/              # Product phases and sources
docker-compose.yml # Postgres, auth-service, user-service, KYC service, frontend, pgAdmin
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
cp .env.example .env
npm run dev            # http://localhost:5173 (or as configured)
```

The frontend uses `VITE_AUTH_API`, `VITE_USER_API`, and `VITE_KYC_API` from `frontend/.env` to reach the backend APIs. For a Vite dev server, allow `http://localhost:5173` in each backend's `CORS_ORIGIN`; the Compose defaults allow both Vite (`5173`) and the container-served UI (`8080`). In Compose, frontend API values are build-time arguments and can be overridden with the corresponding `VITE_*_API` variables.

### 5. KYC service (Phase 3)

The KYC service uses a dedicated `kyc_db` database. On a fresh Compose Postgres volume, the database is initialized automatically. For an existing volume, create it once:

```bash
docker exec banking-postgres psql -U auth -d postgres -c "CREATE DATABASE kyc_db;"

cd backend/kyc-service
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm test
npm run dev            # http://localhost:5003
```

Customer routes use an access JWT from auth-service. Set `KYC_STORAGE_ENCRYPTION_KEY` to a securely generated 64-character hexadecimal key before starting KYC in production Compose. Didit credentials and a published `DIDIT_WORKFLOW_ID` are required only to create provider sessions. See [the KYC service README](./backend/kyc-service/README.md) for setup and security details.

Or full stack:

```bash
docker compose up --build
```

Compose connects the KYC container to the local `kyc_db` database on the
`postgres` service by default. For an existing Postgres volume, create the
database once with the command above. Set `KYC_DATABASE_URL` in the Compose
environment only when intentionally using a different database.

## API overview

| Service | Base URL | Endpoints |
|---|---|---|
| Auth | `http://localhost:5001/api/v1` | register, login, refresh, logout, verify-email, forgot/reset password, `/me` |
| User | `http://localhost:5002/api/v1` | profiles, wallets, same-currency transfers, transaction history; external payments disabled pending provider configuration |
| KYC | `http://localhost:5003/api/v1/kyc` | submissions, documents/OCR, provider sessions, webhooks, review |

All APIs use the envelope `{ success, message, data | errors }`.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Registration, login, JWT | Done |
| 2 | Profile, update profile, change password | Done (user-service standalone) |
| 3 | KYC submissions, identity checks, and officer review | In progress |
| 4 | Wallets and transactions | Wallet creation, balance retrieval, and atomic transfers implemented; deposits, withdrawals, and provider-backed payments require trusted integrations |

## Security notes

- Passwords: bcrypt; refresh tokens hashed at rest
- Rate limiting and audit logging on auth-sensitive routes
- Never commit real secrets; use `.env` (gitignored)
- Production must not run `AUTH_MODE=dev`

## License

UNLICENSED — internal project.
