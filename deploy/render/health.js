const http = require("http");

// Aggregate readiness for the four in-container services. Render probes
// /healthz through Nginx; this endpoint fails while any service is not ready.
const TARGETS = [
  { name: "auth-service", port: 5001, path: "/api/v1/health" },
  { name: "user-service", port: 5002, path: "/api/v1/health" },
  { name: "kyc-service", port: 5003, path: "/api/v1/kyc/health" },
  { name: "notification-service", port: 5004, path: "/api/v1/health" },
];

const checkTarget = async ({ name, port, path }) => {
  const startedAt = Date.now();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(3000),
    });
    return { name, ok: response.ok, status: response.status, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { name, ok: false, error: error.name, latencyMs: Date.now() - startedAt };
  }
};

const server = http.createServer(async (req, res) => {
  if (!["/healthz", "/"].includes(req.url)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "not_found" }));
    return;
  }

  const services = await Promise.all(TARGETS.map(checkTarget));
  const ok = services.every((service) => service.ok);

  res.writeHead(ok ? 200 : 503, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ status: ok ? "ok" : "degraded", services }));
});

server.listen(5050, "127.0.0.1", () => {
  console.log("[health] readiness aggregator listening on 127.0.0.1:5050");
});
