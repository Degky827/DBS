const crypto = require("crypto");
const { monitorEventLoopDelay } = require("perf_hooks");
const env = require("../config/env");

const SERVICE_NAME = "user-service";
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

const registry = new Map();

const seriesKey = (labels) => JSON.stringify(labels || {});

const register = (metric) => {
  registry.set(metric.name, metric);
  return metric;
};

const createCounter = (name, help, labelNames = ["service"]) => {
  const metric = register({ name, help, type: "counter", labelNames, series: new Map() });
  return {
    inc(labels = {}, value = 1) {
      const key = seriesKey(labels);
      const entry = metric.series.get(key);
      if (entry) entry.value += value;
      else metric.series.set(key, { labels, value });
    },
  };
};

const createGauge = (name, help, labelNames = ["service"]) => {
  const metric = register({ name, help, type: "gauge", labelNames, series: new Map() });
  return {
    set(value, labels = {}) {
      metric.series.set(seriesKey(labels), { labels, value });
    },
  };
};

const createHistogram = (name, help, labelNames, buckets = DEFAULT_BUCKETS) => {
  const metric = register({
    name,
    help,
    type: "histogram",
    labelNames,
    buckets,
    series: new Map(),
  });
  return {
    observe(value, labels = {}) {
      const key = seriesKey(labels);
      let entry = metric.series.get(key);
      if (!entry) {
        entry = { labels, counts: buckets.map(() => 0), sum: 0, count: 0 };
        metric.series.set(key, entry);
      }
      entry.sum += value;
      entry.count += 1;
      for (let index = 0; index < buckets.length; index += 1) {
        if (value <= buckets[index]) entry.counts[index] += 1;
      }
    },
  };
};

const httpRequests = createCounter("banking_http_requests_total", "Completed HTTP requests", [
  "service",
  "method",
  "route",
  "status",
]);
const httpDuration = createHistogram(
  "banking_http_request_duration_seconds",
  "HTTP request duration in seconds",
  ["service", "method", "route", "status"]
);
const readiness = createGauge(
  "banking_readiness",
  "1 when the readiness probe succeeds, 0 when it fails"
);
const securityEvents = createCounter(
  "banking_security_events_total",
  "Audit and security events by event name",
  ["service", "event"]
);
const reconciliationOutcomes = createCounter(
  "banking_payment_reconciliation_total",
  "Payment reconciliation outcomes",
  ["service", "outcome"]
);
const outboxEvents = createCounter(
  "banking_outbox_events_total",
  "Transactional outbox delivery outcomes",
  ["service", "outcome"]
);
const outboxPending = createGauge(
  "banking_outbox_pending",
  "Outbox events still awaiting delivery"
);

const markReady = (ready) => readiness.set(ready ? 1 : 0, { service: SERVICE_NAME });

const recordSecurityEvent = (event) => securityEvents.inc({ service: SERVICE_NAME, event });

const recordReconciliationOutcome = (outcome) =>
  reconciliationOutcomes.inc({ service: SERVICE_NAME, outcome });

const recordOutboxEvent = (outcome) => outboxEvents.inc({ service: SERVICE_NAME, outcome });

const setOutboxPending = (count) => outboxPending.set(count, { service: SERVICE_NAME });

const httpMiddleware = () => (req, res, next) => {
  if (req.path === "/metrics") return next();

  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    // req.route is present only for matched routes, which keeps label
    // cardinality bounded; unmatched URLs are grouped instead of recorded.
    const route = req.route ? `${req.baseUrl || ""}${req.route.path}` : "unmatched";
    const labels = {
      service: SERVICE_NAME,
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    httpRequests.inc(labels);
    httpDuration.observe(seconds, labels);
  });
  next();
};

const escaped = (value) =>
  String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const labelText = (labelNames, labels = {}) => {
  if (!labelNames.length) return "";
  const parts = labelNames.map((name) => `${name}="${escaped(labels[name] ?? "")}"`);
  return `{${parts.join(",")}}`;
};

const appendValueLines = (lines, name, help, type, value, labels = {}) => {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
  lines.push(`${name}${labelText(Object.keys(labels), labels)} ${value}`);
};

const renderMetric = (metric, lines) => {
  if (metric.series.size === 0) return;

  lines.push(`# HELP ${metric.name} ${metric.help}`);
  lines.push(`# TYPE ${metric.name} ${metric.type}`);

  for (const entry of metric.series.values()) {
    if (metric.type === "histogram") {
      metric.buckets.forEach((bucket, index) => {
        lines.push(
          `${metric.name}_bucket${labelText([...metric.labelNames, "le"], {
            ...entry.labels,
            le: bucket,
          })} ${entry.counts[index]}`
        );
      });
      lines.push(
        `${metric.name}_bucket${labelText([...metric.labelNames, "le"], {
          ...entry.labels,
          le: "+Inf",
        })} ${entry.count}`
      );
      lines.push(`${metric.name}_sum${labelText(metric.labelNames, entry.labels)} ${entry.sum}`);
      lines.push(
        `${metric.name}_count${labelText(metric.labelNames, entry.labels)} ${entry.count}`
      );
      continue;
    }

    lines.push(`${metric.name}${labelText(metric.labelNames, entry.labels)} ${entry.value}`);
  }
};

const renderProcessMetrics = (lines) => {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();

  appendValueLines(
    lines,
    "banking_service_info",
    "Build information for the running service",
    "gauge",
    1,
    { service: SERVICE_NAME }
  );
  appendValueLines(
    lines,
    "process_cpu_user_seconds_total",
    "CPU time spent in user mode",
    "counter",
    cpu.user / 1e6
  );
  appendValueLines(
    lines,
    "process_cpu_system_seconds_total",
    "CPU time spent in system mode",
    "counter",
    cpu.system / 1e6
  );
  appendValueLines(
    lines,
    "process_resident_memory_bytes",
    "Resident memory size",
    "gauge",
    memory.rss
  );
  appendValueLines(
    lines,
    "process_start_time_seconds",
    "Start time of the process since the Unix epoch",
    "gauge",
    Math.floor(Date.now() / 1000 - process.uptime())
  );
  appendValueLines(lines, "nodejs_heap_size_used_bytes", "V8 heap used", "gauge", memory.heapUsed);
  appendValueLines(
    lines,
    "nodejs_heap_size_total_bytes",
    "V8 heap allocated",
    "gauge",
    memory.heapTotal
  );
  appendValueLines(
    lines,
    "nodejs_external_memory_bytes",
    "Memory used by C++ objects bound to JavaScript objects",
    "gauge",
    memory.external
  );
  appendValueLines(
    lines,
    "nodejs_eventloop_lag_seconds",
    "Mean event loop delay since start",
    "gauge",
    eventLoopDelay.mean / 1e9
  );
  appendValueLines(
    lines,
    "nodejs_eventloop_lag_p99_seconds",
    "99th percentile event loop delay since start",
    "gauge",
    eventLoopDelay.percentile(99) / 1e9
  );
};

const render = () => {
  const lines = [];
  for (const metric of registry.values()) renderMetric(metric, lines);
  renderProcessMetrics(lines);
  return `${lines.join("\n")}\n`;
};

const tokenMatches = (provided) => {
  if (!env.METRICS_TOKEN) return true;
  if (!provided) return false;
  const expected = Buffer.from(env.METRICS_TOKEN);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const metricsHandler = (req, res) => {
  const header = req.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const provided = req.get("x-metrics-token") || bearer;

  if (!tokenMatches(provided)) {
    return res.status(401).type("text/plain").send("Unauthorized\n");
  }

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.set("Cache-Control", "no-store");
  return res.send(render());
};

module.exports = {
  SERVICE_NAME,
  httpMiddleware,
  metricsHandler,
  markReady,
  recordSecurityEvent,
  recordReconciliationOutcome,
  recordOutboxEvent,
  setOutboxPending,
  render,
};
