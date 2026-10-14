# Future Integration Plan — User Service ↔ Auth Service

This document describes how the standalone Phase 2 User Service should integrate with Phase 1 Auth Service. **None of this is implemented yet.**

## Current standalone mode (Phase 2)

| Concern | Current behavior |
|---|---|
| Auth mode | `AUTH_MODE=dev` |
| Identity proof | Opaque token from `POST /api/v1/auth/dev-login` (email + password against local `UserProfile`) |
| Token storage | SHA-256 hash in `DevSession` table on **user_db** |
| User store | Independent `UserProfile` rows on **user_db** (not `auth_db`) |
| Production | Service **refuses to start** if `NODE_ENV=production` and `AUTH_MODE=dev` |

This mode exists only so Profile / Update Profile / Change Password can be developed and tested without connecting to auth-service. **It is not production-ready.**

## Required future work

### 1. JWT verification (replace DevSession)

- Set `AUTH_MODE=jwt` once implemented.
- Verify access tokens issued by auth-service:
  - Shared secret (`JWT_SECRET`) **or** JWKS discovery
  - Validate `iss`, `aud`, `exp`, and `typ === "access"`
  - Map JWT `sub` → user id
- Middleware change: replace `authenticate.js` DevSession lookup with `jwt.verify`.
- Remove or gate `dev-login` / `dev-logout` behind non-production only (already blocked in production via env validation).

### 2. Consistent user identity

Auth-service `User.id` and user-service `UserProfile.id` must be the same UUID for a given person, or an explicit mapping table must exist.

Recommended options:

1. **Shared identity at creation** — auth-service remains the source of truth for account creation; user-service either:
   - reads the same Postgres database (service separation weakened), or
   - receives a signed internal event / API call after registration to create a `UserProfile` with the **same id**.
2. **Profile-as-extension** — user-service stores only profile extension fields keyed by auth `userId` (no duplicate email/password).

Phase 2 deliberately duplicates a minimal local user for standalone testing. Before integration, decide which identity model to keep and migrate seed/dev users accordingly.

### 3. Password change → refresh token revocation

When password changes in user-service (post-integration):

1. Update password hash (user-service or auth-service, single writer preferred).
2. Call auth-service internal endpoint (or publish event) to run `refreshTokenRepository.revokeAllForUser(userId)`.
3. Optionally force re-login by shortening access-token TTL or adding a `tokenVersion` / `passwordChangedAt` claim checked on JWT verify.

Until then, password changes in user-service only revoke **local DevSessions**.

### 4. Email / username uniqueness

Phase 2 keeps `email` and `username` immutable on profile update. After integration:

- Enforce uniqueness against the canonical account store.
- Require verification flows before email changes.
- Avoid dual-writes without a single source of truth.

### 5. What not to do

- Do not accept `userId` from request body/header as identity in production.
- Do not share bcrypt password hashes between services by copy-paste.
- Do not run `AUTH_MODE=dev` in any shared or production environment.
- Do not point user-service `DATABASE_URL` at `auth_db` without an explicit multi-service data model decision.

## Suggested integration sequence

1. Implement JWT verification middleware in user-service (`AUTH_MODE=jwt`).
2. Agree on identity model (same UUID vs extension table).
3. Backfill / migrate standalone `UserProfile` rows or drop password columns if profile-only.
4. Wire password-change side effects to auth-service token revocation.
5. Add service-to-service auth (internal network + mTLS or signed service tokens).
6. Update OpenAPI security scheme from `devBearer` to `bearerAuth` (JWT).
7. Only then enable user-service in docker-compose / shared environments.
