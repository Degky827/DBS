import test from "node:test";
import assert from "node:assert/strict";

import { normalizeApiError, apiErrorMessage } from "../src/utils/apiError.js";

const httpError = (status, data) => ({ response: { status, data } });

test("backend envelopes keep the message, code, and normalized fields", () => {
  const result = normalizeApiError(
    httpError(400, {
      success: false,
      message: "Check the highlighted fields",
      code: "VALIDATION_ERROR",
      errors: {
        email: "Email is already registered",
        password: ["Password is too short"],
        dateOfBirth: { message: "Enter a valid date" },
      },
    })
  );

  assert.equal(result.status, 400);
  assert.equal(result.code, "VALIDATION_ERROR");
  assert.equal(result.message, "Check the highlighted fields");
  assert.deepEqual(result.fields, {
    email: "Email is already registered",
    password: "Password is too short",
    dateOfBirth: "Enter a valid date",
  });
});

test("account lifecycle errors preserve the server message", () => {
  const result = normalizeApiError(
    httpError(403, {
      success: false,
      message: "This account is frozen. Contact support to restore access.",
      code: "ACCOUNT_FROZEN",
    })
  );

  assert.equal(result.code, "ACCOUNT_FROZEN");
  assert.match(result.message, /frozen/i);
});

test("cancelled step-up responses are reported as cancelled", () => {
  const result = normalizeApiError(
    httpError(403, {
      success: false,
      message: "Verification was cancelled. Your request was not completed.",
      code: "STEP_UP_CANCELLED",
    })
  );

  assert.equal(result.code, "STEP_UP_CANCELLED");
  assert.match(result.message, /cancelled/i);
  assert.doesNotMatch(result.message, /reach the server/i);
});

test("timeouts and lost connectivity produce actionable guidance", () => {
  const timeout = normalizeApiError({ code: "ECONNABORTED" });
  assert.match(timeout.message, /timed out/i);
  assert.equal(timeout.status, 0);

  const offline = normalizeApiError(new Error("Network Error"));
  assert.match(offline.message, /Unable to reach the server/i);
});

test("status-only failures fall back to safe generic messages", () => {
  assert.match(
    normalizeApiError(httpError(401, {})).message,
    /session has expired/i
  );
  assert.match(normalizeApiError(httpError(429, {})).message, /Too many requests/i);
  assert.match(
    normalizeApiError(httpError(503, {})).message,
    /server encountered a problem/i
  );
});

test("apiErrorMessage keeps a custom fallback only for connectivity failures", () => {
  assert.equal(
    apiErrorMessage(new Error("Network Error"), "Could not load your wallet"),
    "Could not load your wallet"
  );
  assert.equal(
    apiErrorMessage(httpError(403, { message: "Account frozen" }), "Ignored"),
    "Account frozen"
  );
});
