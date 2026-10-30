# Backup and Recovery Procedures
## Meridian Digital Banking Platform

**Version:** 1.0  
**Last Updated:** 2026-10-28

---

## Table of Contents
1. [Overview](#overview)
2. [Backup Strategy](#backup-strategy)
3. [PostgreSQL Backup](#postgresql-backup)
4. [Document Storage Backup](#document-storage-backup)
5. [Recovery Procedures](#recovery-procedures)
6. [Testing Recovery](#testing-recovery)
7. [Disaster Recovery](#disaster-recovery)

---

## Overview

### Critical Data Assets
1. **PostgreSQL Databases**: User accounts, profiles, wallets, transactions, KYC submissions
2. **KYC Documents**: Encrypted identity documents in `/app/storage`

> Redis and RabbitMQ are not part of the current deployment. If they are added,
> extend this document with a restore procedure for their durability settings.

### Recovery Objectives
- **RTO (Recovery Time Objective)**: 4 hours for database restore
- **RPO (Recovery Point Objective)**: Maximum 1 hour of data loss acceptable
- **Backup Retention**: 30 days for daily backups, 1 year for monthly

### Backup Schedule
- **PostgreSQL**: Automated daily at 02:00 UTC (scheduler must be configured)
- **Document Storage**: Automated daily at 03:00 UTC (scheduler must be configured)
- **Restore rehearsal**: Required before relying on these procedures

---

## Backup Strategy

### 1. Backup Infrastructure

Create a dedicated backup directory structure:

```bash
/backup
├── postgres/
│   ├── daily/
│   ├── weekly/
│   └── monthly/
├── documents/
│   ├── daily/
│   └── weekly/
├── redis/
└── rabbitmq/
```

### 2. Backup Encryption

**All backups must be encrypted at rest using GPG.**

Generate a GPG key for backups:

```bash
# Generate backup encryption key
gpg --full-generate-key
# Select: (1) RSA and RSA
# Key size: 4096
# Name: Meridian Backup System
# Email: backup@meridian-bank.internal

# Export public key (for encryption)
gpg --armor --export backup@meridian-bank.internal > /secure/backup-public.key

# Export private key (for decryption - KEEP SECURE)
gpg --armor --export-secret-keys backup@meridian-bank.internal > /secure/backup-private.key

# Store private key in a secure location (vault, HSM, or encrypted offline storage)
```

### 3. Backup Access Control

- Backup files: `chmod 600` (owner read/write only)
- Backup directory: Owned by `backup` system user
- Private keys: Stored in secure vault (e.g., HashiCorp Vault, AWS Secrets Manager)
- Backup storage: Separate from application servers

---

## PostgreSQL Backup

### Automated Backup Script

Create `/opt/meridian/scripts/backup-postgres.sh`:

```bash
#!/bin/bash
set -euo pipefail

# Configuration
BACKUP_DIR="/backup/postgres"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE=$(date +%Y%m%d)
POSTGRES_USER="${POSTGRES_USER:-meridian}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
GPG_RECIPIENT="backup@meridian-bank.internal"

# Databases to backup
DATABASES=("auth_db" "user_db" "kyc_db")

# Create backup directories
mkdir -p "${BACKUP_DIR}/daily"
mkdir -p "${BACKUP_DIR}/weekly"
mkdir -p "${BACKUP_DIR}/monthly"

echo "[$(date)] Starting PostgreSQL backup..."

# Backup each database
for DB in "${DATABASES[@]}"; do
    BACKUP_FILE="${BACKUP_DIR}/daily/${DB}_${TIMESTAMP}.sql"
    ENCRYPTED_FILE="${BACKUP_FILE}.gpg"
    
    echo "  Backing up ${DB}..."
    
    # Dump database with custom format for parallel restore
    PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
        -h "${POSTGRES_HOST}" \
        -U "${POSTGRES_USER}" \
        -Fc \
        -Z 9 \
        --no-owner \
        --no-privileges \
        "${DB}" > "${BACKUP_FILE}"
    
    # Verify backup integrity
    PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore \
        --list "${BACKUP_FILE}" > /dev/null 2>&1
    
    if [ $? -ne 0 ]; then
        echo "ERROR: Backup verification failed for ${DB}"
        rm -f "${BACKUP_FILE}"
        exit 1
    fi
    
    # Encrypt backup
    gpg --encrypt --recipient "${GPG_RECIPIENT}" "${BACKUP_FILE}"
    
    if [ $? -eq 0 ]; then
        # Remove unencrypted file
        rm -f "${BACKUP_FILE}"
        
        # Calculate checksum
        sha256sum "${ENCRYPTED_FILE}" > "${ENCRYPTED_FILE}.sha256"
        
        echo "  ✓ ${DB} backup complete: ${ENCRYPTED_FILE}"
    else
        echo "ERROR: Encryption failed for ${DB}"
        rm -f "${BACKUP_FILE}"
        exit 1
    fi
done

# Weekly backup (Sunday)
if [ $(date +%u) -eq 7 ]; then
    echo "  Creating weekly backup..."
    for DB in "${DATABASES[@]}"; do
        LATEST=$(ls -t "${BACKUP_DIR}/daily/${DB}_"*.sql.gpg 2>/dev/null | head -1)
        if [ -n "${LATEST}" ]; then
            cp "${LATEST}" "${BACKUP_DIR}/weekly/${DB}_week_${DATE}.sql.gpg"
            cp "${LATEST}.sha256" "${BACKUP_DIR}/weekly/${DB}_week_${DATE}.sql.gpg.sha256"
        fi
    done
fi

# Monthly backup (1st of month)
if [ $(date +%d) -eq 01 ]; then
    echo "  Creating monthly backup..."
    for DB in "${DATABASES[@]}"; do
        LATEST=$(ls -t "${BACKUP_DIR}/daily/${DB}_"*.sql.gpg 2>/dev/null | head -1)
        if [ -n "${LATEST}" ]; then
            MONTH=$(date +%Y%m)
            cp "${LATEST}" "${BACKUP_DIR}/monthly/${DB}_month_${MONTH}.sql.gpg"
            cp "${LATEST}.sha256" "${BACKUP_DIR}/monthly/${DB}_month_${MONTH}.sql.gpg.sha256"
        fi
    done
fi

# Cleanup old daily backups
echo "  Cleaning up old backups..."
find "${BACKUP_DIR}/daily" -name "*.sql.gpg" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}/daily" -name "*.sha256" -mtime +${RETENTION_DAYS} -delete

# Keep 8 weeks of weekly backups
find "${BACKUP_DIR}/weekly" -name "*.sql.gpg" -mtime +56 -delete
find "${BACKUP_DIR}/weekly" -name "*.sha256" -mtime +56 -delete

# Keep 12 months of monthly backups
find "${BACKUP_DIR}/monthly" -name "*.sql.gpg" -mtime +365 -delete
find "${BACKUP_DIR}/monthly" -name "*.sha256" -mtime +365 -delete

echo "[$(date)] PostgreSQL backup complete!"

# Upload to remote storage (S3, Azure Blob, etc.)
# aws s3 sync "${BACKUP_DIR}" s3://meridian-backups/postgres/ --sse AES256

exit 0
```

### Setup Automated Backups

```bash
# Create backup user and directory
sudo useradd -r -s /bin/bash -d /opt/meridian/backup backup
sudo mkdir -p /backup/postgres
sudo chown -R backup:backup /backup
sudo chmod 700 /backup

# Install script
sudo cp backup-postgres.sh /opt/meridian/scripts/
sudo chmod 750 /opt/meridian/scripts/backup-postgres.sh
sudo chown backup:backup /opt/meridian/scripts/backup-postgres.sh

# Add to crontab for backup user
sudo crontab -u backup -e

# Add this line:
0 2 * * * /opt/meridian/scripts/backup-postgres.sh >> /var/log/meridian-backup.log 2>&1
```

### Manual Backup

```bash
# Quick manual backup
docker exec meridian-postgres-1 pg_dump \
    -U meridian \
    -Fc \
    -Z 9 \
    auth_db > auth_db_manual_$(date +%Y%m%d).dump

# Encrypt
gpg --encrypt --recipient backup@meridian-bank.internal auth_db_manual_$(date +%Y%m%d).dump
rm auth_db_manual_$(date +%Y%m%d).dump
```

---

## Document Storage Backup

### KYC Documents Backup Script

Create `/opt/meridian/scripts/backup-documents.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/backup/documents"
STORAGE_VOLUME="meridian_kyc_storage"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
GPG_RECIPIENT="backup@meridian-bank.internal"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}/daily"

echo "[$(date)] Starting document backup..."

# Create tar archive from Docker volume
TAR_FILE="${BACKUP_DIR}/daily/kyc_storage_${TIMESTAMP}.tar"
ENCRYPTED_FILE="${TAR_FILE}.gpg"

docker run --rm \
    -v "${STORAGE_VOLUME}:/source:ro" \
    -v "${BACKUP_DIR}/daily:/backup" \
    alpine \
    tar czf "/backup/kyc_storage_${TIMESTAMP}.tar.gz" -C /source .

# Encrypt
gpg --encrypt --recipient "${GPG_RECIPIENT}" "${TAR_FILE}.gz"
rm "${TAR_FILE}.gz"

# Checksum
sha256sum "${ENCRYPTED_FILE}" > "${ENCRYPTED_FILE}.sha256"

echo "[$(date)] Document backup complete: ${ENCRYPTED_FILE}"

# Cleanup old backups
find "${BACKUP_DIR}/daily" -name "*.tar.gpg" -mtime +${RETENTION_DAYS} -delete

# Upload to remote storage
# aws s3 cp "${ENCRYPTED_FILE}" s3://meridian-backups/documents/

exit 0
```

---

## Recovery Procedures

### 1. PostgreSQL Database Restore

#### Pre-Restore Checklist
- [ ] Stop all application services
- [ ] Verify backup file integrity (checksum)
- [ ] Confirm backup date and contents
- [ ] Create recovery point snapshot if current database has data
- [ ] Notify team of maintenance window

#### Restore Procedure

```bash
# 1. Stop application services
docker compose stop auth-service user-service kyc-service

# 2. Create safety snapshot of current database (if needed)
docker exec meridian-postgres-1 pg_dump -U meridian -Fc auth_db > auth_db_pre_restore.dump

# 3. Decrypt backup
BACKUP_FILE="auth_db_20261028_020000.sql.gpg"
gpg --decrypt "${BACKUP_FILE}" > auth_db_restore.sql

# 4. Verify checksum
sha256sum -c "${BACKUP_FILE}.sha256"

# 5. Drop and recreate database (WARNING: DESTRUCTIVE)
docker exec -it meridian-postgres-1 psql -U meridian -d postgres <<EOF
DROP DATABASE IF EXISTS auth_db;
CREATE DATABASE auth_db OWNER meridian;
EOF

# 6. Restore database
docker exec -i meridian-postgres-1 pg_restore \
    -U meridian \
    -d auth_db \
    --no-owner \
    --no-privileges \
    < auth_db_restore.sql

# 7. Verify restore
docker exec meridian-postgres-1 psql -U meridian -d auth_db -c "\dt"

# 8. Run Prisma migrations to ensure schema is current
cd backend/auth-service
npx prisma migrate deploy

# 9. Restart services
docker compose up -d

# 10. Verify application functionality
curl http://localhost:5001/api/v1/health
curl http://localhost:5001/api/v1/ready

# 11. Remove unencrypted restore file
rm -P auth_db_restore.sql
```

#### Restore All Databases

```bash
#!/bin/bash
# restore-all-databases.sh

DATABASES=("auth_db" "user_db" "kyc_db")
BACKUP_DATE="20261028_020000"

for DB in "${DATABASES[@]}"; do
    echo "Restoring ${DB}..."
    
    BACKUP_FILE="${DB}_${BACKUP_DATE}.sql.gpg"
    
    # Decrypt
    gpg --decrypt "${BACKUP_FILE}" > "${DB}_restore.sql"
    
    # Restore
    docker exec -i meridian-postgres-1 psql -U meridian -d postgres <<EOF
DROP DATABASE IF EXISTS ${DB};
CREATE DATABASE ${DB} OWNER meridian;
EOF

    docker exec -i meridian-postgres-1 pg_restore \
        -U meridian \
        -d "${DB}" \
        --no-owner \
        --no-privileges \
        < "${DB}_restore.sql"
    
    rm -P "${DB}_restore.sql"
    
    echo "✓ ${DB} restored"
done
```

### 2. Document Storage Restore

```bash
# 1. Stop KYC service
docker compose stop kyc-service

# 2. Decrypt backup
BACKUP_FILE="kyc_storage_20261028_030000.tar.gpg"
gpg --decrypt "${BACKUP_FILE}" > kyc_storage_restore.tar.gz

# 3. Verify checksum
sha256sum -c "${BACKUP_FILE}.sha256"

# 4. Restore to volume
docker run --rm \
    -v meridian_kyc_storage:/target \
    -v $(pwd):/backup \
    alpine \
    sh -c "rm -rf /target/* && tar xzf /backup/kyc_storage_restore.tar.gz -C /target"

# 5. Verify files
docker run --rm -v meridian_kyc_storage:/storage alpine ls -lah /storage

# 6. Restart KYC service
docker compose up -d kyc-service

# 7. Remove unencrypted file
rm -P kyc_storage_restore.tar.gz
```

### 3. Redis or RabbitMQ State Restore

Not applicable to the current deployment. Both were removed from Compose
because no application code uses them. Add a provider-specific restore step
before introducing either dependency.

---

## Testing Recovery

### Monthly Recovery Test Procedure

**Perform on the first Sunday of each month**

1. **Setup Test Environment**
```bash
# Create isolated test compose file
cp docker-compose.yml docker-compose.test-recovery.yml

# Modify to use different ports and volume names
sed -i 's/meridian/meridian-recovery-test/g' docker-compose.test-recovery.yml
```

2. **Restore from Latest Backup**
```bash
# Use recovery scripts against test environment
# Follow full restore procedure
```

3. **Verification Checklist**
- [ ] All three databases restored successfully
- [ ] Schema migrations applied
- [ ] All services start without errors
- [ ] Health checks return 200 OK
- [ ] Can login with test account
- [ ] Can view wallet balance
- [ ] Can retrieve transaction history
- [ ] Can access KYC documents
- [ ] Ledger balances match wallet balances

4. **Measure Recovery Time**
```bash
# Record:
# - Time to decrypt backups
# - Time to restore each database
# - Time to start services
# - Time to verify functionality
# Total RTO achieved: _____
```

5. **Document Results**
- Create recovery test report
- Update procedures if issues found
- File report in `/docs/recovery-tests/YYYY-MM.md`

6. **Cleanup**
```bash
docker compose -f docker-compose.test-recovery.yml down -v
```

---

## Disaster Recovery

### Full System Rebuild

**Scenario: Complete infrastructure loss**

#### Prerequisites
- Backup files stored in remote location (S3, Azure, Google Cloud)
- GPG private key available from secure vault
- Environment variables documented
- Infrastructure as code or deployment scripts

#### Recovery Steps

1. **Provision New Infrastructure**
```bash
# Deploy new servers/containers
# Install Docker and Docker Compose
# Configure networking and security groups
```

2. **Restore Configuration**
```bash
# Retrieve secrets from vault
# Recreate .env file
# Verify all required environment variables
```

3. **Download Latest Backups**
```bash
# From S3 example:
aws s3 sync s3://meridian-backups/postgres/ /backup/postgres/
aws s3 sync s3://meridian-backups/documents/ /backup/documents/

# Verify checksums
cd /backup/postgres/daily
for file in *.sql.gpg; do
    sha256sum -c "${file}.sha256" || echo "CHECKSUM FAILED: ${file}"
done
```

4. **Restore Services**
```bash
# Clone repository
git clone https://github.com/your-org/meridian-banking.git
cd meridian-banking

# Checkout specific version/tag
git checkout v1.0.0

# Start infrastructure services only
docker compose up -d postgres redis rabbitmq

# Wait for health checks
sleep 30

# Restore databases (use procedure above)

# Restore document storage (use procedure above)

# Start application services
docker compose up -d
```

5. **Verify System**
```bash
# Verify health endpoints
curl https://newdomain.com/api/auth/health
curl https://newdomain.com/api/user/health
curl https://newdomain.com/api/kyc/health

# Verify the ledger (read-only)
cd backend/user-service && npm run ledger:verify
```

6. **Update DNS/Load Balancer**
```bash
# Point DNS to new infrastructure
# Update load balancer targets
# Verify SSL certificates
```

7. **Enable Monitoring and Alerts**
```bash
# Reconnect to monitoring systems
# Verify log aggregation
# Test alert channels
```

8. **Announce Recovery**
```bash
# Notify stakeholders
# Update status page
# Document incident and timeline
```

### Partial Service Recovery

If only one service is affected:

```bash
# 1. Identify affected service
SERVICE="user-service"

# 2. Stop service
docker compose stop ${SERVICE}

# 3. Restore only that service's database
#    Follow the PostgreSQL restore procedure above, targeting user_db.
#    This is destructive and requires explicit approval.

# 4. Restart service
docker compose up -d ${SERVICE}

# 5. Verify
docker logs meridian-${SERVICE}-1
curl http://localhost:5002/api/v1/health
```

---

## Ledger Reconciliation After Recovery

After any database restore, verify financial integrity:

```bash
# Run the ledger verifier (read-only) against the restored database
cd backend/user-service
DATABASE_URL="<restored user_db URL>" npm run ledger:verify

# Verify wallet balances match ledger
# Check for orphaned transactions
# Validate double-entry integrity
```

**Reconciliation must pass before allowing financial operations.**

---

## Security Considerations

1. **Backup Encryption**
   - All backups encrypted with GPG
   - Private keys stored in secure vault
   - Regular key rotation (annually)

2. **Access Control**
   - Backup files readable only by backup user
   - Remote storage uses IAM roles or service principals
   - MFA required for backup system access

3. **Compliance**
   - Backups contain PII and must be secured
   - Retention policies follow regulatory requirements
   - Backup deletion uses secure wipe

4. **Audit Trail**
   - All backup operations logged
   - Restoration events trigger alerts
   - Monthly recovery tests documented

---

## Monitoring and Alerts

Configure alerts for:
- Backup failures
- Backup size anomalies (too small/large)
- Missing backup files
- Checksum verification failures
- Backup storage capacity warnings

---

## Support Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| Database Administrator | dba@meridian.internal | +1-555-0100 |
| DevOps Lead | devops@meridian.internal | +1-555-0101 |
| Security Team | security@meridian.internal | +1-555-0199 |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-28 | Phase 4 Implementation | Initial release |

---

**Next Review Date:** 2026-11-28
