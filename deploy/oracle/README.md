# Oracle Cloud Always Free deployment

Runs the same Docker Compose topology used locally on a single Ubuntu VM:
PostgreSQL, Redis, the four Node services, migrations, and the Nginx frontend
(ports 80/443, TLS terminated in the container).

This is the "recommended way" for this repository: no PaaS free tier gives you
four private services plus PostgreSQL, Redis, and a persistent KYC/document
volume. Always Free Ampere A1 capacity is the only $0 option with enough RAM.

## What you need before starting

- An Oracle Cloud account with a tenancy (Always Free).
- An SSH keypair. One has been generated on this workstation:
  - private: `~/.ssh/banking-oracle` (never copy into the repository)
  - public: `~/.ssh/banking-oracle.pub`
- A Brevo API key (`xkeysib-...` or `xsmtpsib-...`). `auth-service` refuses to
  start in production without it because registration and password reset could
  not deliver email. The sender address (`EMAIL_FROM_EMAIL`) must be verified in
  Brevo, or Brevo rejects the message; pass it explicitly on the first run when
  it differs from `no-reply@<domain>`. Chapa and Didit keys are optional; those
  features stay disabled while their keys are empty.
- A DNS name. Either a domain you control (A record to the VM's public IP) or,
  for a disposable demo, `<ip-with-dashes>.sslip.io` (for example
  `129-146-10-20.sslip.io`). Let's Encrypt refuses to issue certificates for
  bare IP addresses.

## 1. Create the VM

In the OCI console: **Compute → Instances → Create instance**.

| Setting | Value |
|---|---|
| Image | Canonical Ubuntu 24.04 (or 22.04) |
| Shape | Ampere `VM.Standard.A1.Flex`, 4 OCPU / 24 GB (2/12 works, 1/6 is tight) |
| Boot volume | 100 GB (default 50 GB is enough; images are ~2 GB) |
| Networking | Assign a public IPv4 address |
| SSH keys | Paste the contents of `~/.ssh/banking-oracle.pub` |
| Cloud-init | **Show advanced options → Management → Paste cloud-init script** and paste `cloud-init.yaml` |

Ampere A1 capacity is frequently exhausted in popular regions ("Out of host
capacity"). Retry later, try another availability domain, or use a different
region. Do not pick the AMD `VM.Standard.E2.1.Micro` shape: 1 GB RAM cannot run
PostgreSQL, Redis, and five Node containers.

`cloud-init.yaml` installs Docker Engine + Compose, certbot, log rotation, and
adds firewall rules for 80/443. It does not contain any secret.

## 2. Open the OCI Security List

The instance firewall is not enough; the VCN has its own ingress rules.

**Networking → Virtual Cloud Networks → your VCN → Subnet → Security List →
Add Ingress Rules**:

| Source | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Port 22 is already open. Do not open 5432, 6379, or 5001–5004: those services are
private to the Compose network.

## 3. Point DNS at the VM

Create an `A` record for the public IPv4. If you have no domain, use
`<ip-with-dashes>.sslip.io`, which resolves back to the IP without any DNS setup.
A real domain is preferable: sslip.io names are shared with other users and are
not a stable identity for cookies, email links, or a certificate you intend to
keep.

Verify before requesting a certificate:

```bash
dig +short bank.example.com
```

## 4. Deploy

### Option A — one command from this workstation

`deploy-remote.sh` copies the bundle and the Brevo key over SSH (the key goes to
a root-only file, never a command line), clones the repository if needed, and
runs the bootstrap:

```bash
./deploy/oracle/deploy-remote.sh \
  --host <PUBLIC_IP> \
  --domain bank.example.com \
  --email ops@example.com \
  --brevo-key-file ~/.secrets/brevo.key \
  --email-from no-reply@example.com
```

Use `--ssh-key` if the private key is not at `~/.ssh/banking-oracle`.

### Option B — manually on the VM

```bash
ssh -i ~/.ssh/banking-oracle ubuntu@<PUBLIC_IP>

sudo git clone --branch dev https://github.com/Degky827/DBS.git /opt/banking-system
sudo install -m 600 /dev/null /root/brevo.key
sudo nano /root/brevo.key        # paste the single-line Brevo key, save

sudo BREVO_API_KEY_FILE=/root/brevo.key EMAIL_FROM_EMAIL=no-reply@example.com \
  bash /opt/banking-system/deploy/oracle/bootstrap.sh \
    --domain bank.example.com \
    --email ops@example.com
```

What the bootstrap does, in order:

1. Fetches `dev` (or `--branch`) into `/opt/banking-system` without discarding
   local changes.
2. Creates `.env` with newly generated PostgreSQL, Redis, JWT, internal-service,
   KYC-storage-encryption, and MFA keys, mode 600. On later runs an existing
   `.env` is reused and never regenerated — regenerating
   `STORAGE_ENCRYPTION_KEY` would make stored KYC documents unreadable.
3. Obtains a Let's Encrypt certificate over the HTTP-01 webroot, installs it in
   `certs/`, and registers `renew-cert.sh` as certbot's deploy hook so renewals
   copy the new files and reload Nginx.
4. Builds images one at a time (bounded RAM), starts the stack, and waits for
   HTTPS.
5. Runs `verify.sh`: container health, migration counts against the repository,
   five public endpoints, Redis connectivity, HTTP→HTTPS redirect, and the
   read-only ledger verification.

No secret is printed. The generated `.env` is the only copy of the new keys:
back it up to your password manager as soon as the deployment succeeds.

## 5. Verify manually

```bash
cd /opt/banking-system
sudo bash ./deploy/oracle/verify.sh
sudo docker compose ps
```

The same script was exercised against the local production Compose stack before
this guide was written (migrations 7/8/4/1, all endpoints, Redis, redirect, and
the 33 ledger checks). On a self-signed local certificate only, add
`CURL_INSECURE=1`; never use it against the Let's Encrypt deployment.

Then open `https://bank.example.com` and register the first account. The
database starts empty: `prisma/seed.js` refuses to run with
`NODE_ENV=production` because its demo accounts use published passwords. To make
the first account an administrator:

```bash
sudo docker compose exec -T postgres psql -U meridian -d auth_db \
  -c "UPDATE \"User\" SET role='ADMIN' WHERE email='you@example.com';"
```

(The table name is case-sensitive because the Prisma model has no `@@map`.)

## Updating

```bash
cd /opt/banking-system
sudo git pull --ff-only
sudo bash ./deploy/oracle/bootstrap.sh --domain bank.example.com --email ops@example.com
```

Existing certificates and `.env` are reused; only changed images are rebuilt.
Migrations run automatically in the `*-migrate` containers before each service
starts.

## Certificate renewal

Certbot's systemd timer renews certificates. Check it with:

```bash
systemctl list-timers certbot.timer
sudo certbot renew --dry-run
```

The deploy hook writes `certs/tls.crt` and `certs/tls.key` and reloads Nginx.

## Backups

The Compose volumes (`postgres_data`, `user_uploads`, `kyc_storage`) live on the
VM. Always Free block volume snapshots and `./scripts/backup.sh` are not off-host
backups by themselves. Before putting real data in, configure:

- OCI block-volume backup policy for the boot volume, and
- periodic `pg_dump` copies shipped to object storage or another host.

See `docs/deployment/backup-and-recovery.md`. `STORAGE_ENCRYPTION_KEY` must be
backed up separately; without it the KYC documents are unrecoverable.

## Troubleshooting

| Symptom | Check |
|---|---|
| SSH works, ports 80/443 time out | OCI Security List ingress rules, then `sudo iptables -L INPUT -n` on the VM |
| `cloud-init` did not install Docker | `cloud-init status --long`, `/var/log/cloud-init-output.log` |
| Let's Encrypt returns `unauthorized` | DNS must already resolve to this VM and port 80 must be reachable from the internet |
| Nginx returns 502 for one API | `sudo docker compose exec frontend getent hosts auth-service`; check `docker compose ps` and `docker compose logs <service>` |
| `auth-service` exits at startup | `docker compose logs auth-service`: usually a missing/weak secret or an unverified Brevo sender |
| Disk fills up | Docker logs are capped at 3×50 MB by cloud-init; check `docker system df` and old images |

If `deploy/oracle/` is not yet committed to the branch you clone, copy it from
your workstation after the clone:

```bash
scp -i ~/.ssh/banking-oracle -r deploy/oracle ubuntu@<PUBLIC_IP>:/tmp/oracle-deploy
ssh -i ~/.ssh/banking-oracle ubuntu@<PUBLIC_IP> \
  'sudo mkdir -p /opt/banking-system/deploy && sudo cp -r /tmp/oracle-deploy /opt/banking-system/deploy/oracle'
```

## Known limitations of this deployment

- Single VM, single database instance: no high availability, no failover. A
  reboot is downtime.
- Always Free A1 instances can be reclaimed by Oracle when idle; a production
  service should not rely on that tier.
- The app still has no AML/sanctions/fraud engine and Chapa runs in test mode
  only. Do not treat this deployment as real-money ready.
- Outbound email depends on Brevo; KYC verification needs Didit keys; deposits
  need Chapa test keys. Those features are disabled until the keys are added.
- OCI may charge for resources outside Always Free limits (extra OCPU/RAM,
  reserved public IPv4 on some account types, outbound transfer). Check the
  current Always Free terms before creating resources.
- `docker compose down -v` deletes the database volume. Never run it on the VM.
