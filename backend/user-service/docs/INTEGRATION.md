# Integration Handoff — User Service ↔ Auth Service

**Status:** Contract defined, integration NOT implemented.  
**Last updated:** Step 10 (2026-10-15)

---

## A. Current Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  auth-service   │     │  user-service   │
│  (Phase 1)      │     │  (Phase 2)      │
│                 │     │                 │
│  Owns:          │     │  Owns:          │
│  - JWT tokens   │     │  - Profile data │
│  - Refresh tokens│   │  - Dev sessions │
│  - auth_db      │     │  - user_db      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
    ┌─────────┐            ┌─────────┐
    │ auth_db │            │ user_db │
    └─────────┘            └─────────┘
```

**Current state:**
- `auth-service`: owns Phase 1 authentication (JWT, refresh tokens, `auth_db`)
- `user-service`: independently manages profile information with standalone development authentication (`AUTH_MODE=dev`)
- `user_db`: dedicated User Service database — NOT shared with `auth-service`
- **No connection exists between the services.**

---

## B. Identity Model Decision

Phase 2 uses **independent `UserProfile` rows** in `user_db` with their own UUIDs. These are NOT auth-service account IDs.

### Option 1: Shared Immutable UUID

auth-service `User.id` and user-service `UserProfile.id` are the same UUID.

| Aspect | Detail |
|---|---|
| How | At registration, auth-service publishes an event or calls user-service internal API to create `UserProfile` with the same `id` |
| Pros | No mapping table; JWT `sub` directly maps to `UserProfile.id`; simple lookup |
| Cons | Requires coordination at registration time; couples service deployment ordering |
| Migration | Must backfill existing `UserProfile.rows` with matching auth-service IDs |

### Option 2: Separate IDs with Mapping Table

Each service maintains its own ID. A mapping table links them.

| Aspect | Detail |
|---|---|
| How | `authUserId → profileId` mapping maintained by user-service or shared identity service |
| Pros | Services remain independent; no coupling at registration |
| Cons | Extra lookup on every request; mapping table becomes a single point of failure; eventual consistency challenges |
| Migration | Must populate mapping table for all existing users |

### Risks of Assuming Two Independent UUIDs Represent the Same User

- Profile updates could target the wrong person
- Password changes could affect the wrong account
- Data leakage between users
- Irreversible data corruption if discovered late

### Decision

**UNRESOLVED.** This decision must be made before integration begins. It affects registration flow, data migration, and JWT verification path.

---

## C. Password Ownership

### Current State

The User Service has its own standalone development-login and password-change workflow:
- Passwords stored in `user_db` → `UserProfile.passwordHash` (bcryptjs, 12 rounds)
- `POST /api/v1/auth/dev-login` verifies credentials locally
- `PATCH /api/v1/users/me/password` changes password locally
- Other dev sessions revoked on password change

### Decision Required

The project owners must decide:

| Option | Description |
|---|---|
| **A. auth-service owns credentials** | auth-service becomes sole authority for password verification and changes. user-service calls auth-service internal API. `passwordHash` removed from `user_db`. |
| **B. user-service owns credentials** | user-service retains password ownership. auth-service delegates password operations via internal API. Requires formally defined cross-service contract. |

### Recommendation

**Option A (auth-service owns credentials)** is recommended because:
- Single authority for credential verification
- Refresh token revocation is co-located with password storage
- Reduces attack surface (one credential store, not two)
- Simplifies compliance auditing

**Avoid two independent production password authorities** unless the architecture explicitly requires and safely coordinates them.

---

## D. JWT Integration Requirements

When `AUTH_MODE=jwt` is activated, the following must be implemented:

| Requirement | Detail |
|---|---|
| **Issuer agreement** | Define expected `iss` claim value (e.g. `"auth-service"`) |
| **Audience agreement** | Define expected `aud` claim value (e.g. `"user-service"`) |
| **Signing algorithm** | Agree on algorithm (e.g. `HS256` or `RS256`). Never accept `"none"`. |
| **Verification keys** | Shared secret (`JWT_SECRET`) or JWKS endpoint for public key discovery |
| **Claims to validate** | `iss`, `aud`, `exp`, `iat`, `sub` (subject = user id), `typ === "access"` |
| **Header extraction** | `Authorization: Bearer <token>` — same header format as dev mode |
| **Trusted identity claim** | `sub` claim contains the user's unique identifier |
| **User existence check** | After JWT verification, user must exist in `UserProfile` table — return `404` if missing |
| **Reject invalid tokens** | Return `401` for malformed, expired, or invalid-signature tokens |
| **Never trust client-supplied user ID** | User ID always from verified JWT `sub` claim, never from request body/query/header |
| **Service-to-service auth** | If user-service calls auth-service internal APIs, define mTLS or signed service tokens |
| **Dev auth in production** | `AUTH_MODE=dev` must be blocked in production (already implemented) |

### Middleware Changes

The `authenticate.js` middleware must be replaced:
1. Extract Bearer token from `Authorization` header
2. Verify JWT signature, issuer, audience, expiry
3. Extract `sub` claim as user ID
4. Look up user in `UserProfile` table
5. Set `req.user` with verified identity
6. Reject with `401` on any failure

---

## E. Session Revocation and Password Changes

### Current Behavior (Development Only)

- `POST /api/v1/auth/dev-logout` revokes the current dev session
- `PATCH /api/v1/users/me/password` revokes all other dev sessions for the user
- No coordination with auth-service (not applicable in standalone mode)

### Post-Integration Requirements

| Concern | Requirement |
|---|---|
| **Password change** | When password changes, auth-service must revoke ALL refresh tokens for the user |
| **Logout** | When user logs out, auth-service must revoke the associated refresh token |
| **Session invalidation** | All active sessions must be invalidated on password change or account compromise |
| **Coordination mechanism** | user-service calls auth-service internal API, or publishes a `PASSWORD_CHANGED` event that auth-service consumes |
| **`passwordChangedAt`** | Already in `UserProfile` — can be used as a JWT claim (`password_version` or `pwd_chg`) to invalidate tokens issued before the change |

### Important

The User Service does **NOT** currently revoke auth-service refresh tokens. This coordination must be implemented during integration.

---

## F. Data Migration Plan

### Overview

Migration from standalone `user_db` profiles to integrated auth-service identity model.

### Pre-Migration

| Step | Detail |
|---|---|
| **Backup** | Full backup of `user_db` and `auth_db` before any migration |
| **Recovery plan** | Document rollback procedure; test restore from backup |
| **Duplicate detection** | Identify users with same email in both databases |
| **Identity mapping** | For each `UserProfile`, determine corresponding auth-service account (or create one) |

### Migration Steps

| Step | Detail |
|---|---|
| **1. Dry-run** | Run migration in read-only mode; report conflicts and missing mappings |
| **2. Validate** | Verify data integrity after dry-run; resolve conflicts |
| **3. Execute** | Run actual migration in a transaction where possible |
| **4. Verify** | Post-migration validation: all users have valid identity mappings |
| **5. Rollback** | If validation fails, restore from backup and abort |

### Data Protection

| Concern | Requirement |
|---|---|
| **Password hashes** | Never copy between services unless using the same bcrypt configuration; prefer re-registration or secure token-based migration |
| **Personal information** | Encrypt data in transit; minimize data exposure during migration |
| **Audit trail** | Log all migration actions for compliance |

---

## G. Integration Sequence

The following order is recommended. **Do not execute these steps now.**

| # | Step | Depends On |
|---|---|---|
| 1 | Approve identity and password ownership decisions | — |
| 2 | Define cross-service identity contract | Step 1 |
| 3 | Implement and test production JWT verification in user-service | Step 2 |
| 4 | Define profile-to-account identity mapping | Step 1 |
| 5 | Integrate user-service with agreed authentication mechanism | Steps 3, 4 |
| 6 | Coordinate password changes and session invalidation | Step 5 |
| 7 | Add service-specific configuration and orchestration | Step 5 |
| 8 | Integrate frontend after backend contracts are stable | Step 7 |
| 9 | Run cross-service integration and security tests | Step 8 |
| 10 | Review deployment readiness | Step 9 |

---

## H. Operational and Security Checklist

### Implemented Controls

| Control | Status |
|---|---|
| Field-level validation with Zod | Implemented |
| Password hashing (bcryptjs, 12 rounds) | Implemented |
| Rate limiting on auth endpoints | Implemented |
| Centralized error handling | Implemented |
| Structured logging with PII redaction | Implemented |
| Production auth bypass prevention | Implemented |
| Health check endpoint | Implemented |
| Graceful shutdown | Implemented |
| Database schema and migrations | Implemented |
| Automated test suite (24 tests) | Implemented |
| Live HTTP integration tests (64 tests) | Implemented |
| Swagger/OpenAPI documentation | Implemented |

### Production Readiness Tasks

| Task | Status | Blocker |
|---|---|---|
| Production JWT verification | Not started | Identity model decision |
| Identity model decision | Unresolved | Architectural decision |
| Password ownership decision | Unresolved | Architectural decision |
| Refresh-token revocation coordination | Not started | Password ownership decision |
| Service-to-service authentication | Not started | Internal API design |
| Safe migration planning | Not started | Identity model decision |
| Docker Compose integration | Not started | — |
| ESLint configuration | Not started | — |
| CI/CD pipeline | Not started | — |
| Production secret management | Not started | — |
| Monitoring, backups, recovery | Not started | — |

---

## I. API Contract Summary

All endpoints use the response envelope: `{ success, message, data }` / `{ success: false, message, errors }`.

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| GET | `/api/v1/health` | None | 200 | — |
| POST | `/api/v1/auth/dev-login` | email + password | 200 | 400, 401, 429 |
| POST | `/api/v1/auth/dev-logout` | Bearer (dev) | 200 | 401 |
| GET | `/api/v1/users/me` | Bearer (dev) | 200 | 401, 404, 500 |
| PATCH | `/api/v1/users/me` | Bearer (dev) | 200 | 400, 401, 404, 500 |
| PATCH | `/api/v1/users/me/password` | Bearer (dev) | 200 | 400, 401, 404, 429, 500 |

The authoritative machine-readable contract is the OpenAPI specification at `GET /api/v1/openapi.json`.

---

## J. Unresolved Architectural Decisions

| # | Decision | Options | Blocker? |
|---|---|---|---|
| 1 | Identity model | Shared UUID vs mapping table | Yes |
| 2 | Password ownership | auth-service vs user-service | Yes |
| 3 | Refresh token revocation trigger | Internal API call vs event | No |
| 4 | Profile-only fields | Keep email/username in user-service? | No |
| 5 | Service-to-service auth | mTLS vs signed tokens vs internal network | No |
| 6 | Dev users migration | Delete vs migrate to auth-service | No |
