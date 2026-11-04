process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.NOTIFICATION_TEST_DATABASE_URL ||
  "postgresql://auth:auth@localhost:5432/notification_test?schema=public";
process.env.JWT_SECRET = "test-only-jwt-secret-0123456789abcdef0123456789";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_FROM_EMAIL = "no-reply@example.test";
process.env.EMAIL_FROM = "Meridian Bank";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.LOG_LEVEL = "silent";

const test = require("node:test");
const assert = require("node:assert/strict");

const { sendEmail, buildContent, EmailError } = require("../src/services/email.service");

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("email content escapes HTML and includes the reference", () => {
  const content = buildContent({
    title: "Transfer <sent>",
    body: "Amount & reference",
    eventId: "evt-1",
  });
  assert.match(content.subject, /Transfer <sent> - Meridian Bank/);
  assert.match(content.html, /Transfer &lt;sent&gt;/);
  assert.match(content.html, /Amount &amp; reference/);
  assert.match(content.text, /Reference: evt-1/);
});

test("sendEmail posts to the Brevo API and returns the message id", async () => {
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ messageId: "msg-1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await sendEmail({
    to: "user@example.test",
    subject: "Subject",
    text: "Body",
    html: "<p>Body</p>",
  });

  assert.equal(result.messageId, "msg-1");
  assert.match(captured.url, /\/smtp\/email$/);
  assert.equal(captured.options.headers["api-key"], "test-brevo-key");
  const payload = JSON.parse(captured.options.body);
  assert.deepEqual(payload.to, [{ email: "user@example.test" }]);
  assert.equal(payload.sender.email, "no-reply@example.test");
});

test("sendEmail marks client errors as non-retryable and server errors retryable", async () => {
  global.fetch = async () =>
    new Response(JSON.stringify({ message: "invalid recipient" }), { status: 400 });
  await assert.rejects(
    () => sendEmail({ to: "bad@example.test", subject: "s", text: "t", html: "<p>t</p>" }),
    (error) => error instanceof EmailError && error.retryable === false
  );

  global.fetch = async () =>
    new Response(JSON.stringify({ message: "provider unavailable" }), { status: 503 });
  await assert.rejects(
    () => sendEmail({ to: "user@example.test", subject: "s", text: "t", html: "<p>t</p>" }),
    (error) => error instanceof EmailError && error.retryable === true
  );
});
