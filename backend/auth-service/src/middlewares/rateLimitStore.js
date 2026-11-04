const { MemoryStore } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");

const env = require("../config/env");
const logger = require("../config/logger");
const metrics = require("../utils/metrics");
const redis = require("../config/redis");

const EVENT = "rate_limit_shared_store_unavailable";

const note = (message, error) => {
  if (typeof metrics.recordSecurityEvent === "function") metrics.recordSecurityEvent(EVENT);
  logger.warn(
    { err: error ? error.message : undefined },
    `${message} (${error ? error.message : "unknown"})`
  );
};

// A Redis round trip sits in front of every request once the store is shared,
// so a slow primary must not stall the API. The timer is unref'd to keep a
// pending command from holding the process open at shutdown.
const withTimeout = (operation, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Redis rate limit command did not answer in ${timeoutMs}ms`)),
      timeoutMs
    );
    timer.unref();
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
  });

// Redis counters are shared by every replica, the in-memory store counts one
// process. A request is counted in exactly one of them, preferring Redis, so a
// Redis outage degrades to per-process budgets instead of to unlimited traffic.
//
// The Redis store is built on first use rather than at require time: limiters
// are constructed while the app module loads, before the connection handshake
// has had a chance to finish, and a store bound that early would stay local
// forever.
const createFallbackStore = ({
  clientFactory = () => null,
  local,
  timeoutMs = env.REDIS_COMMAND_TIMEOUT_MS,
  keyPrefix,
}) => {
  const fallbackStore = local || new MemoryStore();
  let options = null;
  let shared = null;
  let sharedFailureAt = 0;

  const sharedStore = () => {
    if (shared) return shared;
    if (Date.now() - sharedFailureAt < 5_000) return null;
    const client = clientFactory();
    if (!client) {
      sharedFailureAt = Date.now();
      return null;
    }
    try {
      shared = new RedisStore({
        prefix: keyPrefix,
        sendCommand: (...args) => client.sendCommand(args),
      });
      if (options)
        Promise.resolve(shared.init(options)).catch((error) =>
          note("Shared rate limit store failed to initialize.", error)
        );
    } catch (error) {
      note("Shared rate limit store could not be created.", error);
      shared = null;
      sharedFailureAt = Date.now();
    }
    return shared;
  };

  // Redis answers with undefined for some commands, so availability is
  // reported separately from the value instead of being inferred from it.
  const call = async (method, key) => {
    const store = sharedStore();
    if (!store) return { available: false };
    try {
      return { available: true, value: await withTimeout(() => store[method](key), timeoutMs) };
    } catch (error) {
      sharedFailureAt = Date.now();
      note("Shared rate limit store is unavailable, counting in this process instead.", error);
      return { available: false };
    }
  };

  return {
    get localKeys() {
      return shared === null;
    },
    init(limiterOptions) {
      options = limiterOptions;
      return fallbackStore.init(limiterOptions);
    },
    async increment(key) {
      const result = await call("increment", key);
      return result.available ? result.value : fallbackStore.increment(key);
    },
    async decrement(key) {
      const result = await call("decrement", key);
      if (!result.available) await fallbackStore.decrement(key);
    },
    async resetKey(key) {
      await call("resetKey", key);
      await fallbackStore.resetKey(key);
    },
    async get(key) {
      const result = await call("get", key);
      return result.available ? result.value : fallbackStore.get(key);
    },
    async shutdown() {
      await fallbackStore.shutdown();
      if (shared && typeof shared.shutdown === "function") {
        await Promise.resolve(shared.shutdown()).catch(() => {});
      }
    },
  };
};

// Null when Redis is not configured, so the limiter keeps express-rate-limit's
// own default store and the deployment behaves exactly as it did before.
const createRateLimitStore = (name, overrides = {}) => {
  if (!redis.isConfigured()) return null;
  return createFallbackStore({
    clientFactory: redis.getReadyClient,
    keyPrefix: `${env.REDIS_KEY_PREFIX}:ratelimit:${name}:`,
    ...overrides,
  });
};

module.exports = { createRateLimitStore, createFallbackStore, withTimeout };
