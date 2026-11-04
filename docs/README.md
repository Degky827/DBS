# Documentation

Documentation index for the Meridian Digital Banking and Identity Verification
Platform. Everything in this folder is project documentation; runtime OpenAPI
assets stay next to the service that serves them.

## Getting started

| Document | Contents |
|----------|----------|
| [Project brief](./project-brief.md) | Scope, users, requirements, and system goals |
| [Environment setup](./deployment/environment-setup.md) | Every environment variable, required values, and per-service configuration |
| [Testing guide](./operations/testing-guide.md) | Test suites, databases, commands, and expected counts |

## Deployment and operations

| Document | Contents |
|----------|----------|
| [Deployment guide](./deployment/deployment-guide.md) | Initial deployment, blue-green rollout, TLS, rollback, and migrations |
| [Backup and recovery](./deployment/backup-and-recovery.md) | Backups, encrypted off-host retention, restore drills, and disaster recovery |
| [Security and operations](./operations/security-and-operations.md) | Controls, monitoring, alerting, incident response, and secret rotation |
| [Provider integration testing](./operations/provider-integration-testing.md) | Brevo, Chapa, and Didit configuration and verification status |

## Architecture and services

| Document | Contents |
|----------|----------|
| [Ledger design](./architecture/ledger-design.md) | Double-entry accounts, posting rules, reversals, reconciliation, and invariants |
| [User/auth integration](./architecture/user-auth-integration.md) | Identity model between user-service and auth-service |
| [User service](./services/user-service.md) | Profiles, wallets, transfers, payments, and service setup |
| [KYC service](./services/kyc-service.md) | KYC submissions, verification workflow, and service setup |

## Reports

| Document | Contents |
|----------|----------|
| [Production readiness report](./reports/production-readiness-report.md) | Evidence-based release status, fixed defects, and remaining blockers |
| [Security audit (2026-11-04)](./reports/security-audit-2026-11-04.md) | Platform audit: architecture, credential exposure, fixes, and residual risks |

The project overview and quick start live in the repository
[`README.md`](../README.md).
