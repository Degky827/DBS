# Deployment Guide
## Meridian Digital Banking Platform

**Version:** 1.0  
**Last Updated:** 2026-10-28

---

## Table of Contents
1. [Pre-Deployment](#pre-deployment)
2. [Environment Configuration](#environment-configuration)
3. [Initial Deployment](#initial-deployment)
4. [Zero-Downtime Updates](#zero-downtime-updates)
5. [Rollback Procedures](#rollback-procedures)
6. [Migration Management](#migration-management)
7. [Release Checklist](#release-checklist)
8. [Post-Deployment Verification](#post-deployment-verification)
9. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment

### Infrastructure Requirements

| Resource | Minimum | Recommended | Production |
|----------|---------|-------------|------------|
| CPU | 4 cores | 8 cores | 16+ cores |
| RAM | 8 GB | 16 GB | 32+ GB |
| Storage | 50 GB | 100 GB | 500+ GB (with backups) |
| Network | 100 Mbps | 1 Gbps | 10 Gbps |

### Software Dependencies

- Docker Engine 24.0+
- Docker Compose 2.20+
- OpenSSL 3.0+
- GPG 2.2+ (for backup encryption)
- Load balancer with TLS termination (Nginx, HAProxy, AWS ALB, etc.)

### Network Requirements

```
┌─────────────────┐
│  Load Balancer  │  HTTPS (443)
│  (TLS Endpoint) │
└────────┬────────┘
         │
    ┌────▼────────────────┐
    │  Docker Host        │
    │  Port 8080 (HTTP)   │
    └────────────────────┬┘
             │
    ┌────────▼──────────────────┐
    │  Docker Network (bridge)   │
    ├────────────────────────────┤
    │  - Frontend (Nginx:80)     │
    │  - Auth Service (5001)     │
    │  - User Service (5002)     │
    │  - KYC Service (5003)      │
    │  - PostgreSQL (5432)       │
    └────────────────────────────┘
```

**Security:**
- Only port 8080 exposed to load balancer
- All internal services on private Docker network
- PostgreSQL NOT exposed externally
- TLS 1.2+ at load balancer
- HSTS enabled

> **Note:** Earlier drafts of this guide included Redis and RabbitMQ.
> Neither is used by the application code yet, so both were removed from the
> Compose files and from the required environment variables.

---

## Environment Configuration

### 1. Generate Secrets

```bash
# JWT Secret (HS256 - 64 hex characters minimum)
openssl rand -hex 64

# Internal Service Key (32 hex characters)
openssl rand -hex 32

# Storage Encryption Key (64 hex characters)
openssl rand -hex 64

# PostgreSQL Password
openssl rand -base64 32
```

### 2. Create Production Environment File

```bash
cp .env.production.example .env
chmod 600 .env
```

### 3. Configure Required Variables

Edit `.env` and set:

```bash
# === REQUIRED - DEPLOYMENT WILL FAIL WITHOUT THESE ===

# Public HTTPS origin (MUST be https:// in production)
APP_ORIGIN=https://bank.yourdomain.com
FRONTEND_PORT=8080

# Database
POSTGRES_USER=meridian
POSTGRES_PASSWORD=<generated-strong-password>

# JWT (HS256)
JWT_ALGORITHM=HS256
JWT_SECRET=<generated-jwt-secret>

# Service-to-service auth
INTERNAL_SERVICE_KEY=<generated-internal-key>

# KYC document encryption
STORAGE_ENCRYPTION_KEY=<generated-storage-key>

# Email (required: registration and password reset cannot complete without it)
# REST keys start with xkeysib-; SMTP keys start with xsmtpsib-.
BREVO_API_KEY=<your-brevo-key>
EMAIL_TRANSPORT=api          # "api" or "smtp"; inferred from the key prefix if omitted
EMAIL_FROM=Meridian Bank
EMAIL_FROM_EMAIL=no-reply@yourdomain.com
# SMTP only (EMAIL_TRANSPORT=smtp):
# EMAIL_SMTP_HOST=smtp-relay.brevo.com
# EMAIL_SMTP_PORT=587
# EMAIL_SMTP_USER=<brevo-smtp-login>

# KYC Provider (required for KYC; the service starts without it but cannot verify)
DIDIT_API_KEY=<your-didit-api-key>
DIDIT_WORKFLOW_ID=<your-workflow-id>
DIDIT_WEBHOOK_SECRET=<didit-webhook-secret>

# Payment Provider (Chapa Test Mode ONLY)
# Leave all CHAPA_* blank to disable external deposits.
CHAPA_SECRET_KEY=
CHAPA_WEBHOOK_SECRET=
CHAPA_CALLBACK_URL=https://bank.yourdomain.com/api/user/payments/chapa/callback
CHAPA_RETURN_URL=https://bank.yourdomain.com/wallet

# === OPERATIONAL TUNING ===
LOG_LEVEL=info
BCRYPT_ROUNDS=12
```

### 4. Validate Configuration

```bash
# Check for missing required variables
for key in APP_ORIGIN POSTGRES_PASSWORD JWT_SECRET INTERNAL_SERVICE_KEY STORAGE_ENCRYPTION_KEY BREVO_API_KEY; do
    grep -q "^${key}=." .env || echo "ERROR: ${key} is missing or empty"
done

# Verify no development secrets
grep -i "dev-only" .env && echo "ERROR: Development secrets found!" || echo "OK"

# Verify HTTPS origin
grep "^APP_ORIGIN=https://" .env || echo "ERROR: APP_ORIGIN must use HTTPS"
```

The services also validate their configuration at startup and exit non-zero on
missing or weak production secrets, so a misconfigured deployment fails fast.

### 5. Store Secrets Securely

**DO NOT commit `.env` to git!**

Instead, use a secret manager:

```bash
# AWS Secrets Manager
aws secretsmanager create-secret \
    --name meridian/production/env \
    --secret-string file://.env

# Azure Key Vault
az keyvault secret set \
    --vault-name meridian-vault \
    --name production-env \
    --file .env

# HashiCorp Vault
vault kv put secret/meridian/production @.env
```

---

## Initial Deployment

### Step 1: Prepare Infrastructure

```bash
# 1. Clone repository
git clone https://github.com/your-org/meridian-banking.git
cd meridian-banking

# 2. Checkout release tag
git checkout v1.0.0

# 3. Verify commit signature (if using signed releases)
git verify-tag v1.0.0

# 4. Create required directories
sudo mkdir -p /var/lib/meridian/{postgres,redis,rabbitmq,uploads,storage}
sudo chown -R 1000:1000 /var/lib/meridian
```

### Step 2: Database Initialization

```bash
# Start PostgreSQL only
docker compose up -d postgres redis rabbitmq

# Wait for health checks
sleep 30

# Verify infrastructure services
docker compose ps

# Check logs
docker compose logs postgres redis rabbitmq
```

### Step 3: Run Migrations

```bash
# Migrations run automatically via *-migrate containers
# Monitor migration logs
docker compose logs auth-migrate user-migrate kyc-migrate

# Verify migrations completed
docker compose ps | grep migrate
# All should show "exited (0)"
```

### Step 4: Start Application Services

```bash
# Start backend services
docker compose up -d auth-service user-service kyc-service

# Wait for health checks
sleep 45

# Verify health
curl -f http://localhost:8080/api/auth/health || echo "Auth service not ready"
curl -f http://localhost:8080/api/user/health || echo "User service not ready"
curl -f http://localhost:8080/api/kyc/health || echo "KYC service not ready"
```

### Step 5: Start Frontend

```bash
# Start frontend (Nginx)
docker compose up -d frontend

# Verify
curl -f http://localhost:8080/ || echo "Frontend not ready"
```

### Step 6: Create Initial Admin Account (Optional)

```bash
# Connect to auth-service database
docker exec -it meridian-postgres-1 psql -U meridian -d auth_db

# Create admin user manually or via seed script (development only)
# In production, first user registers normally then elevated via database
```

### Step 7: Configure Load Balancer

**Example: Nginx upstream**

```nginx
upstream meridian_backend {
    server app-server-1:8080;
    server app-server-2:8080;  # If using multiple hosts
}

server {
    listen 443 ssl http2;
    server_name bank.yourdomain.com;
    
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    location / {
        proxy_pass http://meridian_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name bank.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Zero-Downtime Updates

### Blue-Green Deployment Strategy

```
┌──────────────────┐
│  Load Balancer   │
└────┬────────┬────┘
     │        │
     │        └──────────┐
     │                   │
┌────▼─────┐      ┌─────▼────┐
│  Blue    │      │  Green   │
│ (Current)│      │  (New)   │
│  v1.0.0  │      │  v1.1.0  │
└──────────┘      └──────────┘
```

### Deployment Steps

#### 1. Prepare New Version

```bash
# On a separate host or using Docker Compose override
cp docker-compose.yml docker-compose.green.yml

# Modify to use different container names
sed -i 's/name: meridian/name: meridian-green/g' docker-compose.green.yml

# Pull new code
git fetch --tags
git checkout v1.1.0
```

#### 2. Database Migrations (Forward-Compatible)

**Important:** Migrations must be backward-compatible with old code!

```bash
# Test migrations in staging first!

# Run migrations (blue environment will still work)
docker compose -f docker-compose.green.yml run --rm auth-migrate
docker compose -f docker-compose.green.yml run --rm user-migrate
docker compose -f docker-compose.green.yml run --rm kyc-migrate
```

#### 3. Start Green Environment

```bash
# Start new services on different ports
FRONTEND_PORT=8081 docker compose -f docker-compose.green.yml up -d

# Wait for health checks
sleep 60

# Smoke test green environment
curl -f http://localhost:8081/api/auth/health
curl -f http://localhost:8081/api/user/health
curl -f http://localhost:8081/api/kyc/health
```

#### 4. Verify Green Environment

```bash
# Health endpoints on the green stack
for path in /api/auth/health /api/user/health /api/kyc/health; do
    curl -fsS "http://localhost:8081${path}" >/dev/null || { echo "FAILED ${path}"; exit 1; }
done

# Manual verification checklist:
# - Login works
# - Balance retrieval works
# - Transaction history loads
# - KYC document access works
```

#### 5. Switch Load Balancer

```bash
# Gradually shift traffic (if load balancer supports weighted routing)
# 90% blue, 10% green
# Monitor for 15 minutes

# If OK, shift to 50/50
# Monitor for 15 minutes

# If OK, shift to 100% green
# Update Nginx upstream
```

#### 6. Decommission Blue

```bash
# Wait 24 hours with green running successfully
# Then stop blue environment
docker compose down

# Keep blue containers/images for quick rollback
```

---

## Rollback Procedures

### Immediate Rollback (Within 24 hours of deployment)

#### If Blue environment still running:

```bash
# 1. Switch load balancer back to blue
# Update Nginx upstream to point to port 8080

# 2. Verify blue is serving traffic
curl -f https://bank.yourdomain.com/api/auth/health

# 3. Stop green environment
docker compose -f docker-compose.green.yml down

# Total downtime: < 30 seconds
```

#### If Blue environment is stopped:

```bash
# 1. Restart blue environment
docker compose up -d

# 2. Wait for health checks
sleep 60

# 3. Verify services
for path in /api/auth/health /api/user/health /api/kyc/health; do
    curl -fsS "http://localhost:8080${path}" >/dev/null || { echo "FAILED ${path}"; exit 1; }
done

# 4. Switch load balancer back to blue
# Update Nginx upstream

# Total downtime: 2-3 minutes
```

### Database Rollback (If migrations cause issues)

**WARNING:** This is destructive!

```bash
# 1. Stop all services
docker compose down

# 2. Restore database from backup (manual procedure: see backup-and-recovery.md)
#    This is destructive and requires explicit approval.
#    Example: pg_restore into the target database with services stopped.

# 3. Checkout previous version
git checkout v1.0.0

# 4. Start blue environment
docker compose up -d

# Total downtime: 15-60 minutes (depending on database size)
```

### Prisma Migration Rollback

Prisma doesn't support automatic rollback. Manual process:

```bash
# 1. Identify migration to rollback
cd backend/auth-service/prisma/migrations
ls -lt

# 2. Manually write down migration (reverse the changes)
# Create a new migration that undoes the changes

# 3. Apply reverse migration
npx prisma migrate deploy

# 4. Test thoroughly
```

**Best practice:** Test migrations in staging, keep them backward-compatible.

---

## Migration Management

### Safe Migration Practices

#### 1. Backward-Compatible Migrations

**✓ SAFE:**
```sql
-- Add optional column
ALTER TABLE users ADD COLUMN new_field VARCHAR(255);

-- Add index
CREATE INDEX idx_users_email ON users(email);

-- Add new table
CREATE TABLE new_feature (...);
```

**✗ UNSAFE (Breaking):**
```sql
-- Remove column (old code expects it)
ALTER TABLE users DROP COLUMN old_field;

-- Rename column (old code uses old name)
ALTER TABLE users RENAME COLUMN old_name TO new_name;

-- Add NOT NULL without default
ALTER TABLE users ADD COLUMN required_field VARCHAR(255) NOT NULL;
```

#### 2. Multi-Step Migration Pattern

For breaking changes, use multiple deployments:

**Step 1: Add new field (backward-compatible)**
```sql
-- Deploy v1.1.0
ALTER TABLE users ADD COLUMN new_name VARCHAR(255);
-- Old code ignores new_name, new code writes to both old_name and new_name
```

**Step 2: Migrate data**
```sql
-- Background job or manual migration
UPDATE users SET new_name = old_name WHERE new_name IS NULL;
```

**Step 3: Remove old field (new deployment v1.2.0)**
```sql
-- Deploy v1.2.0
ALTER TABLE users DROP COLUMN old_name;
-- New code only uses new_name
```

#### 3. Testing Migrations

```bash
# Always test in staging first
cd backend/auth-service

# Dry run
npx prisma migrate deploy --preview-feature

# Check migration status
npx prisma migrate status

# Rollback one migration (manual SQL required)
# No automatic rollback in Prisma!
```

---

## Release Checklist

### Pre-Release (1 week before)

- [ ] All tests passing in CI
- [ ] Security audit completed
- [ ] Dependency vulnerabilities reviewed
- [ ] Staging deployment successful
- [ ] Load testing completed
- [ ] Backup verified and tested
- [ ] Rollback procedure documented
- [ ] On-call team notified
- [ ] Maintenance window scheduled (if needed)
- [ ] Release notes prepared

### Migration Review

- [ ] Migrations backward-compatible
- [ ] Migration tested in staging with production-like data
- [ ] Migration execution time measured
- [ ] Large table migrations planned (if locking)
- [ ] Rollback plan for migrations documented

### Deployment Day (T-0)

#### Pre-Deployment (T-2 hours)
- [ ] Backup all databases
- [ ] Verify backup integrity
- [ ] Monitoring dashboards open
- [ ] Team on standby
- [ ] Deploy keys ready
- [ ] Communication channels open

#### Deployment (T-0)
- [ ] Create tagged release
- [ ] Deploy to green environment
- [ ] Run migration (if required)
- [ ] Verify green health checks
- [ ] Run smoke tests
- [ ] Switch 10% traffic to green
- [ ] Monitor for 15 minutes
- [ ] Switch 50% traffic to green
- [ ] Monitor for 15 minutes
- [ ] Switch 100% traffic to green
- [ ] Monitor for 1 hour

#### Post-Deployment (T+1 hour)
- [ ] All health checks green
- [ ] Error rates normal
- [ ] Response times normal
- [ ] No increase in 4xx/5xx errors
- [ ] Key user flows verified:
  - [ ] User registration
  - [ ] Login
  - [ ] Balance check
  - [ ] Transfer
  - [ ] Transaction history
- [ ] Monitoring alerts quiet
- [ ] Logs review clean

#### Stabilization (T+24 hours)
- [ ] No rollback needed
- [ ] Decommission blue environment
- [ ] Update documentation
- [ ] Post-mortem (if issues)
- [ ] Notify stakeholders of success

---

## Post-Deployment Verification

### Automated Health Checks

Reference snippet (save it in your operations tooling; it is not shipped as a
repository script):

```bash
#!/bin/bash

BASE_URL="${1:-https://bank.yourdomain.com}"

echo "Checking Meridian Banking System Health..."

# Health endpoints
ENDPOINTS=(
    "/api/auth/health"
    "/api/auth/ready"
    "/api/user/health"
    "/api/user/ready"
    "/api/kyc/health"
    "/api/kyc/ready"
)

for ENDPOINT in "${ENDPOINTS[@]}"; do
    echo -n "Checking ${ENDPOINT}... "
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${ENDPOINT}")
    
    if [ "${STATUS}" -eq 200 ]; then
        echo "✓ OK"
    else
        echo "✗ FAILED (HTTP ${STATUS})"
        exit 1
    fi
done

echo "All health checks passed!"
```

### Smoke Tests

Reference snippet (not shipped as a repository script):

```bash
#!/bin/bash

BASE_URL="${1:-https://bank.yourdomain.com}"

# Test user registration
echo "Testing user registration..."
REGISTER_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{
        "email": "smoke-test-'$(date +%s)'@example.com",
        "password": "Test123!@#",
        "firstName": "Smoke",
        "lastName": "Test"
    }')

echo "${REGISTER_RESPONSE}" | grep -q '"success":true' || {
    echo "Registration failed!"
    exit 1
}

echo "✓ Registration OK"

# Add more smoke tests for:
# - Login
# - Profile retrieval
# - Wallet access
# - etc.
```

### Performance Verification

```bash
# Check response times
curl -w "@curl-format.txt" -o /dev/null -s "${BASE_URL}/api/auth/health"

# curl-format.txt:
# time_namelookup:  %{time_namelookup}\n
# time_connect:  %{time_connect}\n
# time_appconnect:  %{time_appconnect}\n
# time_pretransfer:  %{time_pretransfer}\n
# time_redirect:  %{time_redirect}\n
# time_starttransfer:  %{time_starttransfer}\n
# ----------\n
# time_total:  %{time_total}\n
```

---

## Troubleshooting

### Common Issues

#### 1. Services won't start

```bash
# Check logs
docker compose logs --tail=100

# Check health
docker compose ps

# Common causes:
# - Missing environment variables
# - Database connection failed
# - Port already in use
# - Insufficient resources
```

#### 2. Database migration fails

```bash
# Check migration logs
docker compose logs auth-migrate user-migrate kyc-migrate

# Verify database connection
docker exec meridian-postgres-1 psql -U meridian -l

# Manual migration
docker exec -it meridian-postgres-1 psql -U meridian -d auth_db
```

#### 3. JWT verification fails after deployment

```bash
# Verify JWT_SECRET matches across services
docker compose exec auth-service env | grep JWT_SECRET
docker compose exec user-service env | grep JWT_SECRET

# Check JWT_ALGORITHM matches
# If switching from HS256 to RS256, all services must update
```

#### 4. CORS errors

```bash
# Verify APP_ORIGIN matches exactly
echo $APP_ORIGIN

# Check CORS_ORIGIN in each service
docker compose exec auth-service env | grep CORS_ORIGIN

# Must match the origin browsers send
# https://bank.yourdomain.com (no trailing slash)
```

#### 5. Performance degradation

```bash
# Check resource usage
docker stats

# Check database connections
docker exec meridian-postgres-1 psql -U meridian -d auth_db \
    -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
docker exec meridian-postgres-1 psql -U meridian -d auth_db \
    -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

---

## Emergency Contacts

| Role | Contact | Phone | Escalation |
|------|---------|-------|------------|
| DevOps Lead | devops@meridian.internal | +1-555-0100 | CTO |
| Database Admin | dba@meridian.internal | +1-555-0101 | DevOps Lead |
| Security Team | security@meridian.internal | +1-555-0199 | CISO |
| On-Call Engineer | oncall@meridian.internal | +1-555-0911 | DevOps Lead |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-28 | Phase 4 Implementation | Initial deployment guide |

---

**Next Review Date:** 2026-11-28
