const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
const kycDatabaseUrl = process.env.KYC_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}

const assertIsolatedTestDatabase = (url, name) => {
  const databaseName = new URL(url).pathname.split("/").pop().split("?")[0];
  if (!/_test$/i.test(databaseName)) {
    throw new Error(`${name} must point to a database whose name ends in _test`);
  }
};

assertIsolatedTestDatabase(testDatabaseUrl, "WALLET_TEST_DATABASE_URL");
if (kycDatabaseUrl) {
  assertIsolatedTestDatabase(kycDatabaseUrl, "KYC_TEST_DATABASE_URL");
}

const skipReason = kycDatabaseUrl
  ? false
  : "KYC_TEST_DATABASE_URL is required for the cross-service integration test";

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.ENABLE_API_DOCS = "false";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";
process.env.LOG_LEVEL = "silent";

const { spawn } = require("node:child_process");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const INTERNAL_SERVICE_KEY = "integration-internal-key-0123456789abcdef";
const JWT_SECRET = "integration-jwt-secret-0123456789abcdef";
const STORAGE_ENCRYPTION_KEY = "ab".repeat(32);

const users = {};
const tokens = {};
const wallets = {};

let app;
let prisma;
let ledger;
let kycDatabase;
let kycProcess;
let kycServiceUrl;
let kycProcessOutput = "";
let reviewableSubmissionId;

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const waitForKycService = async (url, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (kycProcess.exitCode !== null) {
      throw new Error(
        `kyc-service exited with code ${kycProcess.exitCode}: ${kycProcessOutput.slice(-2000)}`
      );
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `kyc-service did not become healthy: ${kycProcessOutput.slice(-2000)}`
  );
};

const startKycService = (port) => {
  const cwd = path.resolve(__dirname, "../../kyc-service");
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATABASE_URL: kycDatabaseUrl,
      DB_ADAPTER: "pg",
      JWT_ALGORITHM: "HS256",
      JWT_SECRET,
      INTERNAL_SERVICE_KEY,
      STORAGE_ENCRYPTION_KEY,
      ENABLE_API_DOCS: "false",
      LOG_LEVEL: "silent",
      CORS_ORIGIN: "http://localhost:8080",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    kycProcessOutput = `${kycProcessOutput}${chunk}`.slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    kycProcessOutput = `${kycProcessOutput}${chunk}`.slice(-4000);
  });
  return child;
};

const stopKycService = async (child) => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
};

const createUser = async (label, role = "USER") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Integration Test",
      username: `${label.toLowerCase()}_${suffix.slice(0, 12)}`,
      email: `${label.toLowerCase()}_${suffix}@integration.test`,
      phoneNumber: "+251911000000",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "integration-test-only",
      role,
    },
  });
  const token = randomBytes(48).toString("hex");
  await prisma.devSession.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  users[label] = user;
  tokens[label] = token;
  return user;
};

const seedKycSubmission = async (userId, status, reviewedAt = null) => {
  const id = randomUUID();
  await kycDatabase.query(
    `INSERT INTO "KycSubmission" ("id", "userId", "status", "createdAt", "updatedAt", "reviewedAt")
     VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
    [id, userId, status, reviewedAt]
  );
  return id;
};

const seedReviewableSubmission = async (userId) => {
  const submissionId = await seedKycSubmission(userId, "PENDING_REVIEW");
  await kycDatabase.query(
    `UPDATE "KycSubmission"
     SET "providerStatus" = 'Approved',
         "documentVerificationStatus" = 'Approved',
         "dataComparisonStatus" = 'MATCH',
         "faceMatchStatus" = 'Approved',
         "livenessStatus" = 'Approved'
     WHERE "id" = $1`,
    [submissionId]
  );
  await kycDatabase.query(
    `INSERT INTO "KycDocument"
       ("id", "submissionId", "documentType", "storageKey", "mimeType", "fileName", "fileSizeBytes", "createdAt", "updatedAt")
     VALUES ($1, $2, 'PASSPORT', $3, 'image/jpeg', 'passport.jpg', 1024, NOW(), NOW())`,
    [randomUUID(), submissionId, `${randomUUID()}.enc`]
  );
  return submissionId;
};

const mintAccessToken = (sub, role = "USER") =>
  jwt.sign(
    {
      sub,
      role,
      email: `${role.toLowerCase()}_${sub.slice(0, 8)}@integration.test`,
      typ: "access",
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: "auth-service",
      audience: "banking-system",
      expiresIn: "5m",
    }
  );

const kycRequest = (path, { token, method = "GET", body } = {}) =>
  fetch(`${kycServiceUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const auth = (label) => `Bearer ${tokens[label]}`;

const createWallet = (label) =>
  request(app).post("/api/v1/wallets").set("Authorization", auth(label)).send({});

const transfer = (label, destinationWalletId, amount, idempotencyKey) =>
  request(app)
    .post("/api/v1/transactions/transfers")
    .set("Authorization", auth(label))
    .set("Idempotency-Key", idempotencyKey)
    .send({ destinationWalletId, amount });

const reverse = (label, reference, key, amount) =>
  request(app)
    .post(`/api/v1/transactions/${reference}/reversals`)
    .set("Authorization", auth(label))
    .set("Idempotency-Key", key)
    .send({ amount, reason: "Integration dispute" });

const fundWallet = async (walletId, amount) =>
  prisma.$transaction((tx) =>
    ledger.postEntry({
      tx,
      eventType: "TEST_FUNDING",
      eventRef: `test-funding:${randomUUID()}`,
      currency: "ETB",
      description: "Integration test funding from opening equity",
      postings: [
        { accountCode: ledger.ACCOUNT_CODES.OPENING_BALANCE, direction: "DEBIT", amount },
        { accountCode: `WALLET:${walletId}`, direction: "CREDIT", amount },
      ],
    })
  );

const walletBalance = async (label) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId: users[label].id } });
  return wallet.balance.toFixed(2);
};

const internalStatus = (userId, key = INTERNAL_SERVICE_KEY) => {
  const headers = {};
  if (key !== null) headers["X-Internal-Service-Key"] = key;
  return fetch(`${kycServiceUrl}/internal/users/${userId}/status`, { headers });
};

before(async () => {
  if (skipReason) return;

  const { Client } = require("pg");
  kycDatabase = new Client({ connectionString: kycDatabaseUrl.replace(/\?.*$/, "") });
  await kycDatabase.connect();

  const port = await freePort();
  kycProcess = startKycService(port);
  kycServiceUrl = `http://127.0.0.1:${port}/api/v1/kyc`;
  await waitForKycService(`${kycServiceUrl}/health`);

  // The user-service reads KYC_SERVICE_URL at load time, so require it only
  // after the live KYC service endpoint is known.
  process.env.KYC_SERVICE_URL = kycServiceUrl;
  process.env.INTERNAL_SERVICE_KEY = INTERNAL_SERVICE_KEY;
  app = require("../src/app");
  prisma = require("../src/config/database");
  ledger = require("../src/modules/ledger/ledger.service");
  await prisma.$connect();

  await createUser("approved");
  await createUser("recipient");
  await createUser("pending");
  await createUser("unsubmitted");
  await createUser("reviewable");
  await createUser("outsider");
  await createUser("admin", "ADMIN");

  // Seed submissions directly: provider webhooks and document OCR are covered
  // by the kyc-service suites. These fixtures exercise the cross-service
  // contract, officer decision, and financial gate against the live service.
  await seedKycSubmission(users.approved.id, "APPROVED", new Date());
  await seedKycSubmission(users.recipient.id, "APPROVED", new Date());
  await seedKycSubmission(users.pending.id, "PENDING_REVIEW");
  reviewableSubmissionId = await seedReviewableSubmission(users.reviewable.id);
});

after(async () => {
  if (skipReason) return;
  const userIds = Object.values(users).map((user) => user.id);
  try {
    if (kycDatabase) {
      await kycDatabase.query(
        'DELETE FROM "KycSubmission" WHERE "userId" = ANY($1::text[])',
        [userIds]
      );
    }
    if (prisma) {
      await prisma.devSession.deleteMany({ where: { userId: { in: userIds } } });
    }
  } finally {
    if (prisma) await prisma.$disconnect();
    if (kycDatabase) await kycDatabase.end();
    await stopKycService(kycProcess);
  }
});

test(
  "the internal status contract requires the shared key and reports the stored decision",
  { skip: skipReason },
  async () => {
    const missing = await internalStatus(users.approved.id, null);
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, "INVALID_INTERNAL_KEY");

    const wrong = await internalStatus(users.approved.id, "wrong-internal-key");
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).code, "INVALID_INTERNAL_KEY");

    const approved = await internalStatus(users.approved.id);
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.data.status, "APPROVED");
    assert.equal(approvedBody.data.isApproved, true);
    assert.equal(approvedBody.data.userId, users.approved.id);

    const pending = await internalStatus(users.pending.id);
    const pendingBody = await pending.json();
    assert.equal(pendingBody.data.status, "PENDING_REVIEW");
    assert.equal(pendingBody.data.isApproved, false);

    const unsubmitted = await internalStatus(users.unsubmitted.id);
    const unsubmittedBody = await unsubmitted.json();
    assert.equal(unsubmittedBody.data.status, "NOT_SUBMITTED");
    assert.equal(unsubmittedBody.data.isApproved, false);
  }
);

test(
  "user-service gates wallet creation on the live KYC decision",
  { skip: skipReason },
  async () => {
    const unauthenticated = await request(app).post("/api/v1/wallets").send({});
    assert.equal(unauthenticated.status, 401);

    const pending = await createWallet("pending");
    assert.equal(pending.status, 403);
    assert.equal(pending.body.code, "KYC_NOT_APPROVED");

    const unsubmitted = await createWallet("unsubmitted");
    assert.equal(unsubmitted.status, 403);
    assert.equal(unsubmitted.body.code, "KYC_NOT_APPROVED");

    for (const label of ["approved", "recipient"]) {
      const created = await createWallet(label);
      assert.equal(created.status, 201);
      assert.equal(created.body.data.wallet.balance, "0.00");
      wallets[label] = created.body.data.wallet;
    }
  }
);

test(
  "an approved customer can transfer, read history, and cannot read another customer's transaction",
  { skip: skipReason },
  async () => {
    await fundWallet(wallets.approved.id, "100.00");

    const key = `integration_transfer_${randomUUID()}`;
    const created = await transfer("approved", wallets.recipient.id, "12.50", key);
    assert.equal(created.status, 201);
    const reference = created.body.data.transaction.reference;

    const replay = await transfer("approved", wallets.recipient.id, "12.50", key);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.transaction.reference, reference);
    assert.equal(await walletBalance("approved"), "87.50");
    assert.equal(await walletBalance("recipient"), "12.50");

    const history = await request(app)
      .get("/api/v1/transactions")
      .set("Authorization", auth("approved"));
    assert.equal(history.status, 200);
    assert.equal(history.body.data.transactions.length, 1);
    assert.equal(history.body.data.transactions[0].reference, reference);

    const incoming = await request(app)
      .get("/api/v1/transactions?direction=incoming")
      .set("Authorization", auth("recipient"));
    assert.equal(incoming.status, 200);
    assert.equal(incoming.body.data.transactions.length, 1);

    const foreign = await request(app)
      .get(`/api/v1/transactions/${reference}`)
      .set("Authorization", auth("outsider"));
    assert.equal(foreign.status, 404);

    const pendingTransfer = await transfer(
      "pending",
      wallets.recipient.id,
      "1.00",
      `integration_pending_${randomUUID()}`
    );
    assert.equal(pendingTransfer.status, 403);
    assert.equal(pendingTransfer.body.code, "KYC_NOT_APPROVED");

    const customerReversal = await reverse(
      "approved",
      reference,
      `integration_rev_user_${randomUUID()}`,
      "2.50"
    );
    assert.equal(customerReversal.status, 403);
    assert.equal(customerReversal.body.code, "FORBIDDEN_ROLE");

    const adminReversal = await reverse(
      "admin",
      reference,
      `integration_rev_admin_${randomUUID()}`,
      "2.50"
    );
    assert.equal(adminReversal.status, 201);
    assert.equal(await walletBalance("approved"), "90.00");
    assert.equal(await walletBalance("recipient"), "10.00");
  }
);

test(
  "officer review over HTTP approves complete evidence and immediately unlocks the financial gate",
  { skip: skipReason },
  async () => {
    const applicantToken = mintAccessToken(users.reviewable.id, "USER");
    const officerId = randomUUID();
    const officerToken = mintAccessToken(officerId, "OFFICER");
    const selfOfficerToken = mintAccessToken(users.reviewable.id, "OFFICER");

    const applicantQueue = await kycRequest("/officer/reviews", { token: applicantToken });
    assert.equal(applicantQueue.status, 403);
    assert.equal((await applicantQueue.json()).code, "OFFICER_REQUIRED");

    const queue = await kycRequest("/officer/reviews", { token: officerToken });
    assert.equal(queue.status, 200);
    const queued = (await queue.json()).data;
    assert.equal(queued.some((item) => item.id === reviewableSubmissionId), true);

    const decide = (token) =>
      kycRequest(`/officer/submissions/${reviewableSubmissionId}/decision`, {
        token,
        method: "POST",
        body: { decision: "APPROVE", reason: "All provider checks and documents verified" },
      });

    const applicantDecision = await decide(applicantToken);
    assert.equal(applicantDecision.status, 403);
    assert.equal((await applicantDecision.json()).code, "OFFICER_REQUIRED");

    const selfDecision = await decide(selfOfficerToken);
    assert.equal(selfDecision.status, 403);
    assert.equal((await selfDecision.json()).code, "SELF_REVIEW_FORBIDDEN");

    const beforeApproval = await internalStatus(users.reviewable.id);
    assert.equal((await beforeApproval.json()).data.isApproved, false);

    const approved = await decide(officerToken);
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).data.status, "APPROVED");

    const approvedStatus = await internalStatus(users.reviewable.id);
    const approvedBody = await approvedStatus.json();
    assert.equal(approvedBody.data.status, "APPROVED");
    assert.equal(approvedBody.data.isApproved, true);

    const wallet = await createWallet("reviewable");
    assert.equal(wallet.status, 201);
    assert.equal(wallet.body.data.wallet.currency, "ETB");

    const repeated = await decide(officerToken);
    assert.equal(repeated.status, 409);
    assert.equal((await repeated.json()).code, "SUBMISSION_NOT_REVIEWABLE");
  }
);

test(
  "deposit initiation is refused for unapproved customers and unavailable without Chapa credentials",
  { skip: skipReason || (process.env.CHAPA_SECRET_KEY ? "Chapa credentials are configured" : false) },
  async () => {
    const unapproved = await request(app)
      .post("/api/v1/payments/deposits")
      .set("Authorization", auth("pending"))
      .set("Idempotency-Key", `integration_deposit_pending_${randomUUID()}`)
      .send({ amount: "10.00" });
    assert.equal(unapproved.status, 403);
    assert.equal(unapproved.body.code, "KYC_NOT_APPROVED");

    const approved = await request(app)
      .post("/api/v1/payments/deposits")
      .set("Authorization", auth("approved"))
      .set("Idempotency-Key", `integration_deposit_approved_${randomUUID()}`)
      .send({ amount: "10.00" });
    assert.equal(approved.status, 501);
    assert.equal(approved.body.code, "PAYMENT_PROVIDER_NOT_CONFIGURED");
  }
);
