const crypto = require("crypto");
const env = require("../config/env");
const ApiError = require("./ApiError");

const MAX_AGE_SECONDS = 300;
const SIGNATURE_HEADERS = [
  ["x-signature-v2", "v2"],
  ["x-signature", "raw"],
  ["x-signature-simple", "simple"],
];

function parseJson(rawBody) {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw ApiError.badRequest("Webhook body is not valid JSON", "INVALID_WEBHOOK_BODY");
  }
}

function shortenFloats(value) {
  if (Array.isArray(value)) return value.map(shortenFloats);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shortenFloats(item)])
    );
  }
  if (typeof value === "number" && Number.isFinite(value) && value % 1 === 0) {
    return Math.trunc(value);
  }
  return value;
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = sortKeys(value[key]);
        return sorted;
      }, {});
  }
  return value;
}

function canonicalizeJson(value) {
  return JSON.stringify(sortKeys(shortenFloats(value)));
}

function readSignature(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : null;
}

function simpleSignaturePayload(event) {
  if (
    typeof event.timestamp !== "number" ||
    typeof event.session_id !== "string" ||
    typeof event.status !== "string" ||
    typeof event.webhook_type !== "string"
  ) {
    return null;
  }
  return `${event.timestamp}:${event.session_id}:${event.status}:${event.webhook_type}`;
}

function signaturePayload(method, rawBody, event) {
  if (method === "v2") return canonicalizeJson(event);
  if (method === "raw") return rawBody;
  return simpleSignaturePayload(event);
}

function matchesSignature(signature, payload, secret) {
  const actual = readSignature(signature);
  if (!actual || payload === null) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest();
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function verifyDiditWebhook(rawBody, headers, now = Date.now()) {
  if (!env.DIDIT_WEBHOOK_SECRET) {
    throw ApiError.serviceUnavailable(
      "Didit webhook verification is not configured",
      "DIDIT_WEBHOOK_NOT_CONFIGURED"
    );
  }
  if (!Buffer.isBuffer(rawBody)) {
    throw ApiError.badRequest("Webhook body must be raw JSON", "INVALID_WEBHOOK_BODY");
  }

  const hasV2OrSimpleSignature =
    headers["x-signature-v2"] ||
    headers["x-signature-v2-previous"] ||
    headers["x-signature-simple"] ||
    headers["x-signature-simple-previous"];
  const event = hasV2OrSimpleSignature ? parseJson(rawBody) : null;
  const secrets = [
    { secret: env.DIDIT_WEBHOOK_SECRET, previous: false },
    ...(env.DIDIT_WEBHOOK_SECRET_PREVIOUS
      ? [{ secret: env.DIDIT_WEBHOOK_SECRET_PREVIOUS, previous: true }]
      : []),
  ];

  let authenticationMethod = null;
  for (const [headerName, method] of SIGNATURE_HEADERS) {
    for (const candidate of [
      { name: headerName, previous: false },
      { name: `${headerName}-previous`, previous: true },
    ]) {
      const signature = headers[candidate.name];
      if (!signature) continue;
      for (const configuredSecret of secrets) {
        if (candidate.previous !== configuredSecret.previous) continue;
        const parsedEvent = method === "raw" ? null : event || parseJson(rawBody);
        if (
          matchesSignature(
            signature,
            signaturePayload(method, rawBody, parsedEvent),
            configuredSecret.secret
          )
        ) {
          authenticationMethod = method;
          break;
        }
      }
      if (authenticationMethod) break;
    }
    if (authenticationMethod) break;
  }

  if (!authenticationMethod) {
    throw ApiError.unauthorized("Webhook signature is invalid", "INVALID_WEBHOOK_SIGNATURE");
  }

  const verifiedEvent = event || parseJson(rawBody);
  if (
    !Number.isSafeInteger(verifiedEvent?.timestamp) ||
    Math.abs(Math.floor(now / 1000) - verifiedEvent.timestamp) > MAX_AGE_SECONDS
  ) {
    throw ApiError.unauthorized(
      "Webhook timestamp is invalid or expired",
      "INVALID_WEBHOOK_TIMESTAMP"
    );
  }

  return { event: verifiedEvent, authenticationMethod };
}

module.exports = { verifyDiditWebhook, canonicalizeJson };
