# Backup and Recovery

**Applies to:** production and staging Docker Compose deployments  
**Last updated:** 2026-11-02

The repository ships two scripts:

| Script | Purpose |
| --- | --- |
| `scripts/backup.sh` | Creates a dated backup set of all databases and document volumes |
| `scripts/restore.sh` | Rehearses a restore into throw-away databases, or restores in place |

Both operate through Docker Compose, so database credentials stay inside the
PostgreSQL container and are never read on the host.

---

## 1. Recovery objectives

| Objective | Target | Notes |
| --- | --- | --- |
| RPO | 24 hours | Matches the daily backup schedule; shorten the interval or add WAL archiving if a smaller RPO is required |
| RTO | 2 hours | Measured by the monthly restore drill |
| Retention | 30 days | `BACKUP_RETENTION_DAYS`; copy sets off-host for longer retention |

Backups must be copied to storage that is independent of the application host.
A backup that only exists on the same disk as PostgreSQL does not satisfy this
policy.

---

## 2. What is backed up

| Asset | Source | Contents |
| --- | --- | --- |
| `auth_db` | `postgres` container | Accounts, credentials, sessions, MFA state |
| `user_db` | `postgres` container | Profiles, wallets, ledger, payments, policies |
| `kyc_db` | `postgres` container | Verification submissions and provider state |
| KYC documents | `kyc_storage` volume | Encrypted identity documents |
| Avatars | `user_uploads` volume | Profile images |

Not included:

- TLS certificates in `certs/` — keep them in the certificate manager or
  secret store that issued them.
- `.env` and secret values — keep them in the secret manager. Backups are
  useless without the KYC encryption keys and JWT/MFA keys.
- Redis — holds only rate-limit windows and short-TTL read caches, all of them
  rebuilt on their own. No session, credential, ledger or KYC record lives there,
  so a restore never has to include it. RabbitMQ and object storage are still not
  part of the deployment.

---

## 3. Prerequisites

- Docker Engine with the Compose plugin, on the host that runs the stack.
- `sha256sum`, `tar`, and `gzip`.
- GPG 2.2+ on the backup host when encryption is enabled.
- A GPG public key for backups. The private key belongs in an offline vault or
  HSM and must not live on the application host.
- The Compose file used by the deployment. Production uses
  `docker-compose.yml`; local development uses `docker-compose.dev.yml`.

Verify the stack is reachable before scheduling anything:

```bash
docker compose ps
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER"
```

---

## 4. Running a backup

```bash
# Production stack
BACKUP_GPG_RECIPIENT=backup@meridian-bank.internal ./scripts/backup.sh

# Local development stack without encryption
COMPOSE_FILE=docker-compose.dev.yml ./scripts/backup.sh
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMPOSE_FILE` | `docker-compose.yml` | Compose file to run against |
| `BACKUP_ROOT` | `<repo>/backups` | Output directory |
| `BACKUP_RETENTION_DAYS` | `30` | Delete sets older than this; `0` disables pruning |
| `BACKUP_GPG_RECIPIENT` | empty | Encrypt every artifact with this key |
| `BACKUP_REQUIRE_ENCRYPTION` | `false` | Fail when no recipient is configured |
| `BACKUP_SKIP_DOCUMENTS` | `false` | Skip the two volume archives |

Set `BACKUP_REQUIRE_ENCRYPTION=true` in production so a missing recipient fails
the job instead of silently writing plaintext dumps.

### Output layout

```text
backups/sets/20261102T020000Z/
├── manifest.json
├── SHA256SUMS
├── postgres/
│   ├── auth_db.dump.gpg
│   ├── user_db.dump.gpg
│   └── kyc_db.dump.gpg
└── documents/
    ├── storage.tar.gz.gpg
    └── uploads.tar.gz.gpg
```

`manifest.json` records the timestamp, encryption state, file sizes, and
SHA-256 hashes. `SHA256SUMS` is what the restore script verifies before it
touches a database.

Each dump is validated with `pg_restore --list` immediately after it is
written. Each volume archive is checked with `gzip -t`. A backup set is only
reported as complete after every artifact has been written and hashed.

### Schedule

Run daily with cron or a systemd timer. Example cron entry (02:00 UTC):

```cron
0 2 * * * cd /opt/meridian && BACKUP_GPG_RECIPIENT=backup@meridian-bank.internal BACKUP_REQUIRE_ENCRYPTION=true BACKUP_ROOT=/backup ./scripts/backup.sh >> /var/log/meridian-backup.log 2>&1
```

### Off-host copy

Copy completed sets to object storage after every run and verify the copy
before pruning the local set:

```bash
aws s3 sync /backup/sets/ s3://meridian-backups/sets/ --sse AES256
```

Use a credential that can write backups but cannot delete production data.
Apply a lifecycle rule for long-term retention and object-lock if the
regulatory requirement is immutable backups.

---

## 5. Restore drill (non-destructive)

Run this at least monthly, and after any schema migration that touches
financial tables.

```bash
LATEST="$(ls -d backups/sets/* | tail -1)"
./scripts/restore.sh --backup "$LATEST" --suffix _drill
```

The drill:

1. Verifies every file against `SHA256SUMS`.
2. Decrypts the volume archives and checks that they are readable.
3. Creates `auth_db_drill`, `user_db_drill`, and `kyc_db_drill`.
4. Restores each dump with `pg_restore --exit-on-error`.
5. Confirms each database contains tables.
6. Runs `backend/user-service/prisma/verifyLedger.js` against
   `user_db_drill`.
7. Drops the drill databases (unless `--keep` is passed).

It never stops services and never writes to a live database. Record the start
and end time, the number of restored tables, and the ledger result in the
operations log.

Useful flags:

| Flag | Effect |
| --- | --- |
| `--keep` | Leave the `_drill` databases in place for inspection |
| `--skip-ledger-verify` | Skip the double-entry check (not recommended) |

### Reading the result

- **"Restore drill passed"** — all dumps restored, tables exist, and the ledger
  is balanced. The backup is usable.
- **Checksum failure** — the artifact was corrupted or modified. Discard the
  set, investigate storage, and restore from an off-host copy.
- **`pg_restore` failure** — the dump is truncated or was produced by an
  incompatible PostgreSQL major version. Keep the failed set for diagnosis and
  restore an older set.
- **Ledger failure** — do not promote the backup. The restored copy has
  inconsistent wallets or postings; check the restore log and the backup
  source.

---

## 6. In-place restore (destructive)

Use this only when the live databases must be replaced, for example after data
corruption. It stops the application, writes a safety backup, replaces all
three databases and both document volumes, restarts the stack, and verifies the
ledger.

```bash
./scripts/restore.sh --backup backups/sets/20261102T020000Z --in-place
```

Without `--yes`, the script asks you to type the backup timestamp. Add
`--yes` only in an automated recovery runbook with an approved incident.

Pass `--migrate` when the backup predates the current release; it runs
`prisma migrate deploy` for each service after the data is restored.

### What happens

1. Confirmation.
2. `docker compose stop auth-service user-service kyc-service frontend`.
3. A new safety backup set is written with `scripts/backup.sh`.
4. Each live database is dropped with `WITH (FORCE)` and recreated.
5. Dumps are restored with `--no-owner --no-privileges --exit-on-error`.
6. `kyc_storage` and `user_uploads` are emptied and extracted from the set.
7. Optional migrations run through the `*-migrate` images.
8. `docker compose up -d` restarts the stack.
9. The script waits for the user-service health endpoint and runs the ledger
   check against the restored `user_db`.

If any step fails, the script stops before starting the application services.
The pre-restore safety backup remains under `backups/sets/`.

### Post-restore checklist

- [ ] All three services report healthy.
- [ ] Sign-in works with a known account.
- [ ] Wallet balance matches the pre-incident ledger report.
- [ ] Recent transactions are present and open correctly.
- [ ] A KYC document opens for an approved submission.
- [ ] Ledger verification passes.
- [ ] MFA and step-up still work for an enrolled staff account.
- [ ] Background jobs (payment reconciliation) run without errors.
- [ ] The incident record names the backup set that was restored.

---

## 7. Ledger verification

`verifyLedger.js` is read-only. It checks that journal entries balance, that
wallet and ledger-account balances agree, that transaction status matches its
reversals, and that migrated `LEGACY` rows were not treated as ledger entries.

The restore script runs it automatically. To run it manually against a
restored copy:

```bash
docker compose run --rm --no-deps -T \
  -e DATABASE_URL="postgresql://<user>:<encoded-password>@postgres:5432/user_db_drill?schema=public" \
  user-service node prisma/verifyLedger.js
```

Financial operations must stay disabled until this passes.

---

## 8. Security requirements

- Encrypt every artifact before it leaves the host.
- Keep the private key offline; the host only needs the public key.
- Backups contain PII, identity documents, password hashes, and session
  metadata. Treat them as production data.
- Restrict `backups/` to the deployment user (`chmod 700` on directories,
  `chmod 600` on files — the scripts do this).
- Store off-host credentials in a secret manager, not in cron files.
- Log backup start, completion, size, and result. Alert on failure.
- Test that the documented restore procedure works with the current release.

---

## 9. Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `postgres container is not running` | Stack is down | Start PostgreSQL before scheduling a backup |
| `gpg is required` | GPG missing on the host | Install GPG or run the backup where the keyring exists |
| Empty archive | Service volume path changed | Confirm `STORAGE_DIR`/`AVATAR_UPLOAD_DIR` match the Compose mounts |
| Checksum failure on restore | Truncated transfer or modified file | Restore a different set; verify the off-host copy |
| Drill drops databases unexpectedly | `--keep` omitted | Re-run with `--keep` if the copy is still needed |
| In-place restore cannot drop a database | A client is still connected | Keep services stopped; the script uses `WITH (FORCE)` |
| Ledger check fails after restore | Backup predates a ledger fix or was taken mid-migration | Restore an older set and escalate |

---

## 10. Review

Review this document whenever the schema, volumes, Compose services, or
retention policy changes. The next scheduled review is 2027-02-01.
