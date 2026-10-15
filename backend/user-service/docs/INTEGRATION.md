# Integration Contract — User Service ↔ Auth Service

**Status:** Contract defined, integration NOT implemented.  
**Last reviewed:** Step 8 (2026-10-14)

---

## 1. Current API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/health` | None | Liveness probe |
| POST | `/api/v1/auth/dev-login` | email + password | Create dev session (rate-limited) |
| POST | `/api/v1/auth/dev-logout` | Bearer (dev) | Revoke current dev session |
| GET | `/api/v1/users/me` | Bearer (dev) | View own profile |
| PATCH | `/api/v1/users/me` | Bearer (dev) | Update own profile fields |
| PATCH | `/api/v1/users/me/password` | Bearer (dev) | Change password (rate-limited) |

All responses use envelope: `{ success, message, data }` / `{ success: false, message, errors }`.

---

## 2. Current Standalone Development Authentication

| Aspect | Behavior |
|---|---|
| Mode | `AUTH_MODE=dev` (production startup blocked) |
| Token format | 96-char hex opaque string (48 random bytes) |
| Storage | SHA-256 hash in `DevSession` table on `user_db` |
| Lifetime | 8 hours (configurable via `DEV_SESSION_TTL_MS`) |
| Revocation | Explicit (`dev-logout`) or on password change (all other sessions) |
| Optional gate | `X-Dev-Api-Key` header when `DEV_API_KEY` is set |
| Login rate limit | `AUTH_RATE_LIMIT_MAX` (default 20 per 15 min window) |

This mechanism exists only for standalone Phase 2 development. **It must never run in production.**

---

## 3. Trusted Identity Information Expected by the API

The API requires the following claims to be available on `req.user` after authentication:

| Field | Type | Description |
|---|---|---|
| `id` | string (UUID) | Unique user identifier — the only identity source for all `/users/me/*` operations |
| `email` | string | User's email address |
| `role` | string | e.g. `USER`, `ADMIN` |
| `sessionId` | string (UUID) | Current session identifier (used for session-scoped operations) |
| `authMode` | string | `"dev"` now, will be `"jwt"` after integration |

**Critical rule:** The user ID is ALWAYS extracted from the server-side authenticated session — never from request body, query parameters, or headers. This must be preserved after JWT integration.

---

## 4. Future JWT Validation Requirements

When `AUTH_MODE=jwt` is activated:

| Requirement | Detail |
|---|---|
| Token source | Access tokens issued by auth-service |
| Verification | `jwt.verify(token, secretOrKey)` with shared `JWT_SECRET` or JWKS endpoint |
| Claims to validate | `iss` (issuer), `aud` (audience), `exp` (expiry), `iat` (issued-at), `sub` (subject = user id) |
| Algorithm | Must be explicitly whitelisted (e.g. `["HS256"]` or `["RS256"]`) — never `"none"` |
| Header extraction | `Authorization: Bearer <token>` — same header format as dev mode |
| Token type | `typ === "access"` (reject refresh tokens used as access tokens) |
| Middleware replacement | `authenticate.js` swaps DevSession DB lookup for JWT verify + user existence check |
| User existence | After JWT verification, user must still exist in `UserProfile` table — return `404` if missing |

---

## 5. Identity Mapping: Profile IDs vs Account IDs

Phase 2 uses **independent `UserProfile` rows** in `user_db` with their own UUIDs. These are NOT auth-service account IDs.

### Two models for integration:

**Model A — Shared UUID (recommended):**
- auth-service `User.id` and user-service `UserProfile.id` are the same UUID
- At registration, auth-service publishes an event or calls user-service internal API to create `UserProfile` with the same `id`
- No mapping table needed; `sub` claim directly maps to `UserProfile.id`

**Model B — Separate IDs with mapping:**
- Each service has its own ID
- Mapping table (`authUserId → profileId`) maintained by user-service or a shared identity service
- JWT `sub` → lookup mapping → `UserProfile.id`
- Adds latency and a lookup dependency on every request

**Decision required:** Which model to adopt. This affects registration flow, data migration, and JWT verification path.

---

## 6. Password Change Coordination

Phase 2: Password is stored ONLY in `user_service` (`user_db` → `UserProfile.passwordHash`). Password change is local; other dev sessions are revoked.

Post-integration requirements:

| Concern | Requirement |
|---|---|
| Password ownership | Must be decided: either auth-service owns passwords (user-service calls auth-service to verify/update), or user-service owns them and auth-service delegates |
| Refresh token revocation | On password change, auth-service must revoke ALL refresh tokens for the user |
| Coordination mechanism | Either: (a) user-service calls auth-service internal API after password update, or (b) user-service publishes a `PASSWORD_CHANGED` event that auth-service consumes |
| `passwordChangedAt` | Already in `UserProfile` — can be used as a JWT claim (`password_version` or `pwd_chg`) to invalidate tokens issued before the change |
| Cross-service consistency | If auth-service is the password verifier, user-service should NOT store its own `passwordHash` — it becomes a profile-only service |

---

## 7. Service Ownership Matrix

| Resource | Phase 2 Owner | Post-Integration Owner |
|---|---|---|
| Passwords (hash) | user-service | **TBD** — auth-service (preferred) or user-service |
| Access tokens | None (opaque sessions) | auth-service (JWT) |
| Refresh tokens | None | auth-service |
| Dev sessions | user-service (`DevSession`) | Removed/replaced |
| User profile data | user-service | user-service |
| Email/username | user-service (standalone) | auth-service (canonical) |
| Password change event | Local only | Published to auth-service |

---

## 8. Error Response Contract

All errors follow the standard envelope. After JWT integration, these codes apply:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body failed Zod validation |
| 400 | `EMPTY_UPDATE` | Profile update with no permitted fields |
| 400 | `PASSWORD_REUSE` | New password same as current |
| 401 | `TOKEN_MISSING` | No Authorization header |
| 401 | `INVALID_SESSION` | Dev session invalid/expired |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |
| 401 | `INVALID_CURRENT_PASSWORD` | Wrong current password on change |
| 401 | `TOKEN_INVALID` | JWT verification fails (future) |
| 401 | `TOKEN_EXPIRED` | JWT expired (future) |
| 404 | `USER_NOT_FOUND` | Authenticated user no longer exists in UserProfile |
| 409 | `UNIQUE_CONSTRAINT` | Future: email/username already taken |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unhandled error (message sanitized in production) |

---

## 9. Unresolved Schema/Architecture Decisions

| # | Decision | Options | Blocker? |
|---|---|---|---|
| 1 | Identity model | Shared UUID vs mapping table | Yes — affects registration flow |
| 2 | Password ownership | auth-service vs user-service | Yes — affects whether `passwordHash` stays in `user_db` |
| 3 | Refresh token revocation trigger | Internal API call vs event/message queue | No — can start with API call |
| 4 | Profile-only fields | Does user-service keep email/username after integration? | No — can defer |
| 5 | Service-to-service auth | mTLS vs signed service tokens vs internal network only | No — internal network acceptable for now |
| 6 | Dev users migration | Delete seed users vs migrate to auth-service accounts | No —Phase 2 dev data can be dropped |

---

## 10. Readiness Checklist

### Ready for integration

- [x] API endpoints implemented and tested
- [x] Response envelope consistent across all endpoints
- [x] Field-level validation with Zod
- [x] Password hashing (bcryptjs, 12 rounds)
- [x] Rate limiting on auth and password-change endpoints
- [x] Error handling with centralized middleware
- [x] Database schema and migrations
- [x] Automated test suite (24 tests)
- [x] Swagger/OpenAPI documentation
- [x] Health check endpoint
- [x] Graceful shutdown
- [x] Structured logging with PII redaction

### Not ready / blocked

- [ ] JWT verification middleware (`AUTH_MODE=jwt`)
- [ ] Identity model decision (shared UUID vs mapping)
- [ ] Password ownership decision
- [ ] Refresh token revocation wiring
- [ ] Service-to-service authentication
- [ ] Dev-to-production migration plan for user data
- [ ] Docker Compose integration
- [ ] Linter (ESLint) not configured
- [ ] CI/CD pipeline

---

## 11. Suggested Integration Sequence

1. Decide identity model and password ownership
2. Implement JWT verification middleware in user-service (`AUTH_MODE=jwt`)
3. Implement auth-service internal endpoint or event for password-change → refresh-token revocation
4. Backfill or migrate standalone `UserProfile` rows
5. Add service-to-service auth (internal network + mTLS or signed tokens)
6. Update OpenAPI security scheme from `devBearer` to `bearerAuth` (JWT)
7. Gate `dev-login`/`dev-logout` behind non-production only
8. Add user-service to docker-compose (shared environment)
9. Remove or archive `DevSession` table and dev auth code
