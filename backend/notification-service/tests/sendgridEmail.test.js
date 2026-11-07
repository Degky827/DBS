process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.NOTIFICATION_TEST_DATABASE_URL ||
  "postgresql://auth:auth@localhost:5432/notification_test?schema=public";
process.env.JWT_SECRET = "test-only-jwt-secret-0123456789abcdef0123456789";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_FROM_EMAIL = "no-reply@example.test";
process.env.EMAIL_FROM = "Meridian Bank";
process.env.SENDGRID_API_KEY = "SG.test-key";
process.env.EMAIL_TRANSPORT = "sendgrid";
process.env.LOG_LEVEL = "silent";

const test = require("node:test");
const assert = require("node:assert/strict");

const { sendEmail, EmailError } = require("../src/services/email.service");

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("sendEmail posts to the SendGrid API and returns the message id", async () => {
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(null, {
      status: 202,
      headers: { "x-message-id": "sg-msg-1" },
    });
  };

  const result = await sendEmail({
    to: "user@example.test",
    subject: "Subject",
    text: "Body",
    html: "<p>Body</p>",
  });

  assert.equal(result.messageId, "sg-msg-1");
  assert.match(captured.url, /\/v3\/mail\/send$/);
  assert.equal(captured.options.headers.authorization, "Bearer SG.test-key");
  const payload = JSON.parse(captured.options.body);
  assert.deepEqual(payload.personalizations, [{ to: [{ email: "user@example.test" }] }]);
  assert.equal(payload.from.email, "no-reply@example.test");
  assert.deepEqual(payload.content, [
    { type: "text/plain", value: "Body" },
    { type: "text/html", value: "<p>Body</p>" },
  ]);
});

test("sendEmail maps SendGrid errors to retryable and non-retryable failures", async () => {
  global.fetch = async () =>
    new Response(JSON.stringify({ errors: [{ message: "invalid sender" }] }), { status: 400 });
  await assert.rejects(
    () => sendEmail({ to: "bad@example.test", subject: "s", text: "t", html: "<p>t</p>" }),
    (error) =>
      error instanceof EmailError &&
      error.retryable === false &&
      /invalid sender/.test(error.message)
  );

  global.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(
    () => sendEmail({ to: "user@example.test", subject: "s", text: "t", html: "<p>t</p>" }),
    (error) => error instanceof EmailError && error.retryable === true
  );
});
