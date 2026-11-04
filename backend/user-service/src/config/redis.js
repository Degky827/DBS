const redis = require("redis");

const env = require("./env");
const logger = require("./logger");

// Redis is optional. Without REDIS_URL the process keeps its own in-memory
// counters and caches, which is what the service did before; configuring it
// makes rate limit windows shared by every replica so one limit means the same
// thing cluster-wide. Connection failures never fail a request: callers see a
// missing client and fall back to their local store.
let client = null;
let connecting = null;
let lastWarningAt = 0;

const warn = (message, error) => {
  // A flapping or unreachable Redis would otherwise log on every request.
  const now = Date.now();
  if (now - lastWarningAt < 30_000) return;
  lastWarningAt = now;
  logger.warn(
    { err: error ? error.message : undefined },
    `${message} Redis error: ${error ? error.message : "unknown"}`
  );
};

const isConfigured = () => env.REDIS_URL.length > 0;

const isReady = () => client !== null && client.isReady === true;

const create = () => {
  const created = redis.createClient({
    url: env.REDIS_URL,
    socket: {
      connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
      reconnectPeriod: env.REDIS_RECONNECT_PERIOD_MS,
    },
  });
  // node-redis emits 'error' on the socket listener; without a handler here an
  // unreachable Redis would crash the process instead of degrading.
  created.on("error", (error) => warn("user-service lost its Redis connection.", error));
  created.on("connecting", () => {
    connecting = null;
  });
  // The socket stays referenced: an unref'd client lets node exit while a
  // command is still in flight, abandoning the caller that awaits it. Every
  // entry point closes the client through shutdown() before exiting.
  return created;
};

// Returns the shared client once it can carry commands, or null while Redis is
// absent or still being reached. Never awaited by a request path: the caller
// falls back to its local store rather than queueing behind a connection.
const getReadyClient = () => {
  if (!isConfigured()) return null;
  if (!client) client = create();
  if (client.isReady) return client;
  if (!connecting) {
    if (client.isOpen) return null; // the reconnect loop is already running
    connecting = Promise.resolve()
      .then(() => client.connect())
      .then(() => client)
      .catch((error) => {
        warn("user-service could not connect to Redis.", error);
        return null;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return null;
};

const shutdown = async () => {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.destroy();
  }
  client = null;
};

// Used by the readiness probe: an unreachable Redis is a degraded service,
// not a dead one, so this reports state instead of throwing.
const status = () => {
  if (!isConfigured()) return { enabled: false, connected: false };
  return { enabled: true, connected: isReady() };
};

module.exports = { isConfigured, isReady, getReadyClient, shutdown, status };
