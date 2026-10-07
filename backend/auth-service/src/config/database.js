const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaNeon } = require("@prisma/adapter-neon");
const env = require("./env");

const globalForPrisma = globalThis;

function createAdapter() {
  if (env.DB_ADAPTER === "neon") {
    return new PrismaNeon({ connectionString: env.DATABASE_URL });
  }

  return new PrismaPg({ connectionString: env.DATABASE_URL });
}

function createClient() {
  return new PrismaClient({
    adapter: createAdapter(),
    log: env.IS_PRODUCTION ? ["error"] : ["warn", "error"],
  });
}

const prisma = globalForPrisma.__prisma || createClient();

if (!env.IS_PRODUCTION) {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
