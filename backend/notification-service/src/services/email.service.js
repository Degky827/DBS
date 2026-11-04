const env = require("../config/env");
const logger = require("../config/logger");
const metrics = require("../utils/metrics");

class EmailError extends Error {
  constructor(message, { retryable = true, status = null } = {}) {
    super(message);
    this.name = "EmailError";
    this.retryable = retryable;
    this.status = status;
  }
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildContent = (notification) => {
  const title = notification.title;
  const body = notification.body;
  const reference = notification.eventId;
  return {
    subject: `${title} - Meridian Bank`,
    text: `${body}\n\nReference: ${reference}\n\nThis is an automated message from Meridian Bank. Please do not reply.`,
    html: [
      '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">',
      '<h2 style="color:#0d458c;margin-bottom:12px">Meridian Bank</h2>',
      `<h3 style="margin:0 0 8px">${escapeHtml(title)}</h3>`,
      `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">${escapeHtml(body)}</p>`,
      `<p style="font-size:12px;color:#6b7280;margin:0 0 4px">Reference: ${escapeHtml(reference)}</p>`,
      '<p style="font-size:12px;color:#6b7280;margin:24px 0 0">This is an automated message from Meridian Bank. Please do not reply.</p>',
      "</div>",
    ].join(""),
  };
};

const isRetryableStatus = (status) => status === 429 || status >= 500;

const sendEmail = async ({ to, subject, text, html }) => {
  if (!env.EMAIL_ENABLED) return { skipped: true };

  let response;
  try {
    response = await fetch(`${env.BREVO_API_BASE_URL}/smtp/email`, {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: env.EMAIL_FROM, email: env.EMAIL_FROM_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: AbortSignal.timeout(env.EMAIL_TIMEOUT_MS),
    });
  } catch (error) {
    // Network failures and timeouts are safe to retry later.
    metrics.recordEmail("failed");
    throw new EmailError(`Brevo request failed: ${error.message}`);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    metrics.recordEmail("failed");
    const message = body?.message || `Brevo responded with status ${response.status}`;
    throw new EmailError(String(message).slice(0, 300), {
      retryable: isRetryableStatus(response.status),
      status: response.status,
    });
  }

  metrics.recordEmail("sent");
  logger.info({ to, messageId: body?.messageId || null }, "Notification email sent");
  return { messageId: body?.messageId || null };
};

const sendNotificationEmail = (notification) =>
  sendEmail({ to: notification.recipientEmail, ...buildContent(notification) });

module.exports = { EmailError, buildContent, sendEmail, sendNotificationEmail };
