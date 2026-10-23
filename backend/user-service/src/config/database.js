const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const env = require("./env");

const globalForPrisma = globalThis;

function createAdapter() {
  return new PrismaPg({ connectionString: env.DATABASE_URL });
}

function createClient() {
  return new PrismaClient({
    adapter: createAdapter(),
    log: env.IS_PRODUCTION ? ["error"] : ["warn", "error"],
  });
}

const prisma = globalForPrisma.__prismaUser || createClient();

if (!env.IS_PRODUCTION) {
  globalForPrisma.__prismaUser = prisma;
}

module.exports = prisma;
