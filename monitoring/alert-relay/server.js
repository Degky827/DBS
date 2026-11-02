// Receives Alertmanager webhook notifications on the private monitoring
// network. Every notification is written to the container log; when
// ALERT_SLACK_WEBHOOK_URL or ALERT_WEBHOOK_URL is configured it is also
// forwarded to that destination. A forwarding failure returns 502 so
// Alertmanager retries the notification.
const http = require("http");

const PORT = Number(process.env.ALERT_RELAY_PORT || 8080);
const SLACK_WEBHOOK_URL = process.env.ALERT_SLACK_WEBHOOK_URL || "";
const GENERIC_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const REQUEST_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 1024 * 1024;

const log = (level, message, fields = {}) => {
  console.log(
    JSON.stringify({ level, time: new Date().toISOString(), message, ...fields })
  );
};

const formatAlert = (alert) => {
  const labels = alert?.labels || {};
  const annotations = alert?.annotations || {};
  const name = labels.alertname || "alert";
  const severity = labels.severity || "unknown";
  const service = labels.service || labels.job || "unknown";
  const status = (alert?.status || "firing").toUpperCase();
  const summary = annotations.summary ? ` — ${annotations.summary}` : "";
  const description = annotations.description ? `\n  ${annotations.description}` : "";
  return `[${status}] ${severity} ${name} (${service})${summary}${description}`;
};

const formatPayload = (payload) => {
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  const header = `Alertmanager ${payload?.status || "notification"}: ${alerts.length} alert(s)`;
  return [header, ...alerts.map(formatAlert)].join("\n");
};

const postJson = async (url, body, destination) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      log("error", "Alert delivery rejected", {
        destination,
        status: response.status,
        detail: detail.slice(0, 200),
      });
      return false;
    }

    log("info", "Alert delivered", { destination, status: response.status });
    return true;
  } catch (error) {
    log("error", "Alert delivery failed", {
      destination,
      error: error.name === "AbortError" ? "timeout" : error.message,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return send(res, 200, "ok\n");
  }

  if (req.method !== "POST" || req.url !== "/alerts") {
    return send(res, 404, "not found\n");
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, "invalid json\n");
  }

  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  log("info", "Alert notification received", {
    status: payload?.status || null,
    alerts: alerts.length,
    alertnames: alerts.map((alert) => alert?.labels?.alertname).filter(Boolean),
    destinations: {
      slack: Boolean(SLACK_WEBHOOK_URL),
      webhook: Boolean(GENERIC_WEBHOOK_URL),
    },
  });
  console.log(formatPayload(payload));

  const deliveries = [];
  if (SLACK_WEBHOOK_URL) {
    deliveries.push(
      postJson(
        SLACK_WEBHOOK_URL,
        { text: `\`\`\`\n${formatPayload(payload)}\n\`\`\`` },
        "slack"
      )
    );
  }
  if (GENERIC_WEBHOOK_URL) {
    deliveries.push(postJson(GENERIC_WEBHOOK_URL, payload, "webhook"));
  }

  const results = await Promise.all(deliveries);
  if (results.includes(false)) {
    return send(res, 502, "forwarding failed\n");
  }

  return send(res, 202, "accepted\n");
});

server.listen(PORT, "0.0.0.0", () => {
  log("info", "Alert relay listening", {
    port: PORT,
    slack: Boolean(SLACK_WEBHOOK_URL),
    webhook: Boolean(GENERIC_WEBHOOK_URL),
  });
});

const shutdown = (signal) => {
  log("info", "Alert relay shutting down", { signal });
  server.close(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
