const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://auth:auth@localhost:5432/auth_metrics_test?schema=public";
process.env.JWT_SECRET = "auth-metrics-test-secret-0123456789abcdef";
process.env.LOG_LEVEL = "silent";
process.env.METRICS_TOKEN = "metrics-test-token-0123456789";

const express = require("express");
const metrics = require("../src/utils/metrics");

const startServer = async (app) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
};

const request = (server, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { host: "127.0.0.1", port, path, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"],
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });

test("http middleware records route and status, and skips /metrics", async (t) => {
  const app = express();
  app.use(metrics.httpMiddleware());
  app.get("/metrics", metrics.metricsHandler);
  app.get("/api/v1/demo/:id", (req, res) => res.status(201).json({ ok: true }));
  const server = await startServer(app);
  t.after(() => server.close());

  const headers = { authorization: "Bearer metrics-test-token-0123456789" };
  const routeResponse = await request(server, "/api/v1/demo/42", headers);
  assert.equal(routeResponse.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const body = (await request(server, "/metrics", headers)).body;
  assert.match(
    body,
    /banking_http_requests_total\{service="auth-service",method="GET",route="\/api\/v1\/demo\/:id",status="201"\} 1/
  );
  assert.match(body, /banking_http_request_duration_seconds_count\{[^}]*route="\/api\/v1\/demo\/:id"/);
  assert.doesNotMatch(body, /route="\/metrics"/);
});

test("metrics endpoint requires the bearer token when METRICS_TOKEN is set", async (t) => {
  const app = express();
  app.use(metrics.httpMiddleware());
  app.get("/metrics", metrics.metricsHandler);
  const server = await startServer(app);
  t.after(() => server.close());

  const unauthorized = await request(server, "/metrics");
  assert.equal(unauthorized.status, 401);

  const headerToken = await request(server, "/metrics", {
    "x-metrics-token": "metrics-test-token-0123456789",
  });
  assert.equal(headerToken.status, 200);
  assert.match(headerToken.contentType, /text\/plain/);
  assert.match(headerToken.contentType, /version=0\.0\.4/);

  const bearer = await request(server, "/metrics", {
    authorization: "Bearer metrics-test-token-0123456789",
  });
  assert.equal(bearer.status, 200);
  assert.match(bearer.body, /banking_service_info\{service="auth-service"\} 1/);
});

test("counters and histograms render valid exposition format", () => {
  metrics.recordSecurityEvent("METRICS_TEST_EVENT");
  metrics.recordSecurityEvent("METRICS_TEST_EVENT");
  metrics.markReady(false);

  const output = metrics.render();
  assert.match(
    output,
    /banking_security_events_total\{service="auth-service",event="METRICS_TEST_EVENT"\} 2/
  );
  assert.match(output, /banking_readiness\{service="auth-service"\} 0/);
  assert.match(output, /# TYPE banking_security_events_total counter/);
  assert.match(output, /# TYPE banking_service_info gauge/);
});
