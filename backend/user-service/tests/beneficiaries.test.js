const testDatabaseUrl = process.env.WALLET_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("WALLET_TEST_DATABASE_URL must point to an isolated test database");
}
const testDatabaseName = new URL(testDatabaseUrl).pathname.split("/").pop().split("?")[0];
if (!/_test$/i.test(testDatabaseName)) {
  throw new Error("Beneficiary tests only run against a database whose name ends in _test");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "dev";
process.env.DEV_API_KEY = "";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
process.env.RATE_LIMIT_MAX = "10000";

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/config/database");

const runId = randomUUID().slice(0, 8);

const users = {};
const tokens = {};
const wallets = {};

const createUserAndSession = async (label, role = "USER") => {
  const suffix = randomUUID().replace(/-/g, "");
  const user = await prisma.userProfile.create({
    data: {
      firstName: label,
      lastName: "Beneficiary Test",
      username: `${label}_${suffix.slice(0, 12)}`,
      email: `${label}_${suffix}@beneficiary.test`,
      phoneNumber: "+15550199",
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      gender: "other",
      passwordHash: "beneficiary-test-only",
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
  const wallet = await prisma.wallet.create({ data: { userId: user.id } });
  users[label] = user;
  tokens[label] = token;
  wallets[label] = wallet;
};

const auth = (label) => `Bearer ${tokens[label]}`;

const accountNumber = (seed) => `BB-0000-${runId}-${seed}`;

const save = (label, body = {}) =>
  request(app)
    .post("/api/v1/beneficiaries")
    .set("Authorization", auth(label))
    .send({
      name: "Abeba Girma",
      accountNumber: accountNumber("1"),
      bankName: "Dashen Bank",
      ...body,
    });

const list = (label) => request(app).get("/api/v1/beneficiaries").set("Authorization", auth(label));

before(async () => {
  await prisma.$connect();
  await createUserAndSession("owner");
  await createUserAndSession("peer");
});

after(async () => {
  await prisma.beneficiary
    .deleteMany({ where: { userId: { in: [users.owner.id, users.peer.id] } } })
    .catch(() => {});
  await prisma.$disconnect();
});

test("listing beneficiaries requires authentication", async () => {
  const anonymous = await request(app).get("/api/v1/beneficiaries");
  assert.equal(anonymous.status, 401);

  const empty = await list("owner");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.data.beneficiaries, []);
});

test("saving a beneficiary masks the stored account number", async () => {
  const created = await save("owner", { nickname: "Landlord" });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.beneficiary.name, "Abeba Girma");
  assert.equal(created.body.data.beneficiary.nickname, "Landlord");
  assert.equal(created.body.data.beneficiary.bankName, "Dashen Bank");
  assert.match(created.body.data.beneficiary.accountNumber, /\*{2,}[\w-]{4}$/);
  assert.doesNotMatch(JSON.stringify(created.body), /BB-0000-/);

  const stored = await prisma.beneficiary.findUnique({
    where: { id: created.body.data.beneficiary.id },
  });
  assert.equal(stored.accountNumber, accountNumber("1"));
});

test("account numbers are unique per customer but reusable across customers", async () => {
  const duplicate = await save("owner", { accountNumber: accountNumber("1") });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "BENEFICIARY_EXISTS");

  const shared = await save("peer", { accountNumber: accountNumber("1") });
  assert.equal(shared.status, 201);
});

test("beneficiaries are validated before they are stored", async () => {
  const cases = [
    [{ name: "A" }, "name"],
    [{ accountNumber: "123" }, "accountNumber"],
    [{ accountNumber: "1234 5678" }, "accountNumber"],
    [{ name: "Valid Name", accountNumber: accountNumber("2"), bankName: "B" }, "bankName"],
  ];

  for (const [body, field] of cases) {
    const response = await request(app)
      .post("/api/v1/beneficiaries")
      .set("Authorization", auth("owner"))
      .send({ name: "Valid Name", accountNumber: accountNumber("2"), ...body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok(response.body.errors[field], `${field} should be reported`);
  }

  const unknownField = await request(app)
    .post("/api/v1/beneficiaries")
    .set("Authorization", auth("owner"))
    .send({ name: "Valid Name", accountNumber: accountNumber("2"), isAdmin: true });
  assert.equal(unknownField.status, 400);
  assert.equal(unknownField.body.code, "VALIDATION_ERROR");
});

test("linked destination wallets must exist, be active and belong to someone else", async () => {
  const missing = await save("owner", {
    accountNumber: accountNumber("3"),
    destinationWalletId: randomUUID(),
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "WALLET_NOT_FOUND");

  const self = await save("owner", {
    accountNumber: accountNumber("3"),
    destinationWalletId: wallets.owner.id,
  });
  assert.equal(self.status, 400);
  assert.equal(self.body.code, "SELF_BENEFICIARY");

  await prisma.wallet.update({ where: { id: wallets.peer.id }, data: { isActive: false } });
  const inactive = await save("owner", {
    accountNumber: accountNumber("3"),
    destinationWalletId: wallets.peer.id,
  });
  assert.equal(inactive.status, 409);
  assert.equal(inactive.body.code, "WALLET_INACTIVE");
  await prisma.wallet.update({ where: { id: wallets.peer.id }, data: { isActive: true } });

  const linked = await save("owner", {
    accountNumber: accountNumber("3"),
    destinationWalletId: wallets.peer.id,
  });
  assert.equal(linked.status, 201);
  assert.equal(linked.body.data.beneficiary.destinationWalletId, wallets.peer.id);
});

test("favorites sort ahead of newer contacts", async () => {
  await save("owner", { accountNumber: accountNumber("4"), name: "Second Contact" });
  const favorited = await save("owner", {
    accountNumber: accountNumber("5"),
    name: "Preferred Contact",
    isFavorite: true,
  });
  const newer = await save("owner", {
    accountNumber: accountNumber("8"),
    name: "Newest Contact",
  });

  const ids = (await list("owner")).body.data.beneficiaries.map((b) => b.id);
  assert.equal(ids[0], favorited.body.data.beneficiary.id);
  assert.equal(
    ids.indexOf(newer.body.data.beneficiary.id) < ids.indexOf(favorited.body.data.beneficiary.id),
    false
  );
});

test("beneficiaries can be renamed and pinned", async () => {
  const created = await save("owner", { accountNumber: accountNumber("6") });
  const id = created.body.data.beneficiary.id;

  const updated = await request(app)
    .patch(`/api/v1/beneficiaries/${id}`)
    .set("Authorization", auth("owner"))
    .send({ nickname: "Utilities", isFavorite: true });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.beneficiary.nickname, "Utilities");
  assert.equal(updated.body.data.beneficiary.isFavorite, true);
  assert.equal(
    updated.body.data.beneficiary.accountNumber,
    created.body.data.beneficiary.accountNumber
  );

  const nothing = await request(app)
    .patch(`/api/v1/beneficiaries/${id}`)
    .set("Authorization", auth("owner"))
    .send({});
  assert.equal(nothing.status, 400);

  const selfUpdate = await request(app)
    .patch(`/api/v1/beneficiaries/${id}`)
    .set("Authorization", auth("peer"))
    .send({ nickname: "Not mine" });
  assert.equal(selfUpdate.status, 404);
  assert.equal(selfUpdate.body.code, "BENEFICIARY_NOT_FOUND");
});

test("removing a beneficiary deletes only the caller's row", async () => {
  const created = await save("owner", { accountNumber: accountNumber("7") });
  const id = created.body.data.beneficiary.id;

  const wrongOwner = await request(app)
    .delete(`/api/v1/beneficiaries/${id}`)
    .set("Authorization", auth("peer"));
  assert.equal(wrongOwner.status, 404);
  assert.equal((await prisma.beneficiary.findUnique({ where: { id } })).id, id);

  const removed = await request(app)
    .delete(`/api/v1/beneficiaries/${id}`)
    .set("Authorization", auth("owner"));
  assert.equal(removed.status, 200);
  assert.equal(await prisma.beneficiary.findUnique({ where: { id } }), null);

  const again = await request(app)
    .delete(`/api/v1/beneficiaries/${id}`)
    .set("Authorization", auth("owner"));
  assert.equal(again.status, 404);
});
