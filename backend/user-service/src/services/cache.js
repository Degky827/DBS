const env = require("../config/env");
const logger = require("../config/logger");
const redis = require("../config/redis");

// Redis is a performance layer here, never a source of truth. Every failure is
// reported as a cache miss, so the caller reads the upstream service exactly as
// it would with no cache configured; a cold or broken Redis cannot turn a
// successful request into an error.
const keyFor = (name) => `${env.REDIS_KEY_PREFIX}:cache:${name}`;

// Only used when the connection already carries commands, so a request never
// waits on a handshake.
const shared = () => (redis.isReady() ? redis.getReadyClient() : null);

const miss = (error, name) =>
  logger.debug({ err: error ? error.message : undefined, key: name }, "cache unavailable");

const getJson = async (name) => {
  const client = shared();
  if (!client) return null;
  try {
    const raw = await client.get(keyFor(name));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    miss(error, name);
    return null;
  }
};

// A ttl of zero or less means "do not cache", which callers use when the value
// they just read is about to change on its own.
const setJson = async (name, value, ttlSeconds) => {
  const ttl = Math.floor(Number(ttlSeconds));
  if (!Number.isFinite(ttl) || ttl < 1) return;
  const client = shared();
  if (!client) return;
  try {
    await client.set(keyFor(name), JSON.stringify(value), { EX: ttl });
  } catch (error) {
    miss(error, name);
  }
};

module.exports = { getJson, setJson };
