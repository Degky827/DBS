# KYC Service

This service is the third backend module in the Meridian banking platform. It is intentionally independent from the `auth-service` and `user-service`, but it reuses the same identity and service conventions.

## Goals

- manage KYC submissions for bank customers
- retrieve customer profile data from the user-service
- validate user identity with OCR and provider-backed verification
- keep provider secrets server-side and never expose them to the frontend
- expose operations under `/api/v1/kyc`

## Local setup

```bash
cd backend/kyc-service
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm test
npm run test:ocr
npm run dev
```

The OCR smoke test uses a generated fictional image and downloads Tesseract's English model on first use, so that first run needs network access.

## Health check

```bash
curl http://localhost:5003/api/v1/kyc/health
```

## Docker Compose

Compose passes `backend/kyc-service/.env` to the KYC container. The `DATABASE_URL` in that file is used by the container, so use the Neon URL for Neon or `postgresql://auth:auth@postgres:5432/kyc_db?schema=public` for the Compose-managed database. For direct commands on Windows, a local Docker database is reached through `localhost` instead of the Compose hostname `postgres`.

On a fresh Postgres data volume, Compose initializes the dedicated `kyc_db` database and starts the service after PostgreSQL is healthy:

```bash
docker compose up --build kyc-service
```

The SQL initialization script runs only when PostgreSQL initializes a new data directory. If your existing Postgres volume predates the KYC service, create the database once:

```bash
docker exec banking-postgres psql -U auth -d postgres -c "CREATE DATABASE kyc_db;"
```

## Initial API

All customer routes use a bearer access token issued by `auth-service`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/kyc/health` | Health check |
| `POST` | `/api/v1/kyc/submissions` | Create a submission for the authenticated customer after confirming their user-service profile |
| `GET` | `/api/v1/kyc/status` | Retrieve the authenticated customer's latest submission status |

KYC ownership is keyed by the verified JWT `sub` claim. The service does not accept a customer ID from the request. Profile details remain owned by user-service and are not copied into KYC records. OpenAPI and Swagger UI are available at `/api/v1/kyc/docs`.

## Current implementation status

- Steps 1-5 are implemented: customer authentication, encrypted document upload, OCR/correction, Didit sessions and webhooks, profile comparison, and officer decisions.
- Step 6 documentation and deployment setup are in place; live database migration/integration and production retention operations still need environment validation.

## Document handling and privacy

- Supported upload formats are JPEG, PNG, and WebP; file signatures must match declared MIME type.
- Images are decoded and normalized with an input-pixel ceiling before OCR; EXIF metadata is not passed to OCR. Uploads are size-limited and rate-limited.
- Images are encrypted with AES-256-GCM outside public serving paths. OCR text, extracted/corrected fields, and hosted-provider session URLs are also encrypted before database persistence.
- Generate a fresh 32-byte key as 64 hexadecimal characters and configure it as `STORAGE_ENCRYPTION_KEY` locally or `KYC_STORAGE_ENCRYPTION_KEY` in Compose. Store it in a secret manager and back it up securely. Losing or rotating it without re-encrypting data makes files and OCR unreadable.
- Document/image/field reads and corrections are owner-scoped. Images use `Cache-Control: private, no-store`.
- OCR is informational only and does not establish document authenticity.
- Delete documents when no longer needed. A production retention schedule, automated cleanup, encrypted database backups, and key rotation process must be configured before processing real identity documents.
- Application logs exclude request bodies and redact provider tokens, OCR text, extracted fields, and document storage paths.

## Production operations checklist

- Obtain a compliance-approved retention period and legal-hold rules before scheduling deletion. The service does not guess a retention window or automatically delete identity records.
- Encrypt PostgreSQL backups and the document-storage volume, restrict backup access, and test restoration without exposing data to ordinary logs.
- Keep `STORAGE_ENCRYPTION_KEY` in a secret manager with a protected backup. This service currently uses one active key and has no online re-encryption/rotation workflow; do not replace the key while encrypted records remain.
- Document an incident owner and escalation path. For a suspected provider-secret compromise, disable affected verification calls, rotate the Didit API key and webhook secret, and use `DIDIT_WEBHOOK_SECRET_PREVIOUS` only during the documented rotation overlap. Contain access to the database and storage volume, preserve audit evidence, and follow applicable notification requirements.
- Alert on database unavailability, repeated provider failures, and webhook delivery errors; periodically verify database and encrypted-file recovery from backups.

## Didit setup and behavior

Create and publish a KYC workflow, then configure:

- `DIDIT_API_KEY`: server-only Didit application key, sent in the `x-api-key` header
- `DIDIT_WORKFLOW_ID`: published workflow UUID
- `DIDIT_WEBHOOK_SECRET`: webhook destination signing secret
- `DIDIT_WEBHOOK_SECRET_PREVIOUS`: previous secret during the provider's 24-hour rotation overlap, if rotating
- `DIDIT_API_BASE_URL`: fixed to `https://verification.didit.me`

Register `POST https://<public-service-host>/api/v1/kyc/webhooks/didit` as a Didit destination. Subscribe to the event families the application needs, including session (`status.updated`, `data.updated`), user/business entity, activity, and transaction events. The endpoint reads the unparsed body, prefers `X-Signature-V2` (canonical JSON with sorted keys), supports exact-body `X-Signature` and the envelope-only `X-Signature-Simple` fallback, and accepts the corresponding previous-signature headers during key rotation. Freshness is checked against the signed body `timestamp`; the unsigned `X-Timestamp` header is ignored. The handler commits an idempotent event record and any linked KYC status update in one database transaction, then returns `202`. Raw webhook payloads and entity/transaction details are not persisted; non-session events are retained as normalized event metadata. With `X-Signature-Simple`, decision fields are ignored and only the signed session status is recorded. Session decisions never auto-approve a customer; final approval remains an officer action.

Didit's documentation homepage currently advertises 500 free verifications/month and the Create Session documentation says sandbox applications bypass credit checks. Account eligibility and actual limits must still be confirmed in the Didit console; the service does not rely on free-tier access.

Official references (checked 2026-10-26):

- [Create Session](https://docs.didit.me/sessions-api/create-session)
- [API Authentication](https://docs.didit.me/getting-started/api-authentication)
- [Retrieve Session Decision](https://docs.didit.me/sessions-api/retrieve-session)
- [Webhooks and signatures](https://docs.didit.me/integration/webhooks)
- [Didit Documentation](https://docs.didit.me/)

## Comparison and officer decision policy

Comparison checks extracted OCR labels for first name, last name, and date of birth against the user-service profile. Name normalization ignores case, whitespace, punctuation, and diacritics. Dates compare in ISO form and unambiguous localized forms; missing or ambiguous fields are `REVIEW_REQUIRED`. Source text remains unchanged, and persisted comparison results contain outcomes, not source values.

Only JWT roles `ADMIN`, `OFFICER`, or `VERIFICATION_OFFICER` can access the review queue or decide cases. Self-review is denied. Approval requires Didit, document, face-match, and liveness statuses all `Approved` and profile comparison `MATCH`; absent or inconclusive checks block approval. A rejection requires a reason.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/kyc/submissions/:submissionId/documents` | Upload and OCR an image (`document` multipart field) |
| `GET` | `/api/v1/kyc/documents/:documentId` | Read OCR fields and confidence |
| `GET` | `/api/v1/kyc/documents/:documentId/content` | Retrieve the owned image |
| `PATCH` | `/api/v1/kyc/documents/:documentId/corrections` | Correct extracted OCR values |
| `DELETE` | `/api/v1/kyc/documents/:documentId` | Delete owned document data |
| `POST` | `/api/v1/kyc/submissions/:submissionId/compare` | Compare corrected fields with the profile |
| `POST` | `/api/v1/kyc/submissions/:submissionId/verification-session` | Create or reuse a Didit hosted session |
| `POST` | `/api/v1/kyc/webhooks/didit` | Receive signed Didit status/data events |
| `GET` | `/api/v1/kyc/officer/reviews` | List cases awaiting officer review |
| `POST` | `/api/v1/kyc/officer/submissions/:submissionId/decision` | Record approval/rejection with reason |
