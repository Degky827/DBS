const env = require("../config/env");
const logger = require("../config/logger");

const BRAND = {
  navy: "#0a1628",
  gold: "#c9a227",
  goldLight: "#d9b857",
  ink: "#26324a",
  muted: "#55617a",
  line: "#e4e8f0",
};

const layout = ({
  heading,
  body,
  footerNote = `This message was sent by Meridian Bank. If you did not request this code,
                  you can safely ignore this email. Never share your one-time codes with anyone.`,
}) => `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f2f6fc;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6fc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BRAND.line};">
            <tr>
              <td style="background:${BRAND.navy};padding:22px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.02em;">Meridian</span>
                <span style="color:${BRAND.goldLight};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;margin-left:8px;">Bank</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;color:${BRAND.navy};">${heading}</h1>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${BRAND.line};">
                <p style="margin:0;font-size:12px;color:${BRAND.muted};line-height:1.6;">
                  ${footerNote}
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:${BRAND.muted};">
            © 2026 Meridian Bank · Member FDIC
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const otpBlock = (otp) => `
  <p style="margin:0 0 8px;font-size:14px;color:${BRAND.ink};">Your one-time verification code is:</p>
  <p style="margin:0 0 20px;font-size:34px;font-weight:800;letter-spacing:0.35em;color:${BRAND.navy};background:#f7f9fc;border:1px solid ${BRAND.line};border-radius:8px;padding:18px;text-align:center;">
    ${otp}
  </p>
  <p style="margin:0;font-size:13px;color:${BRAND.muted};">This code expires in 10 minutes and can be used once.</p>
`;

const resolveTransport = () => {
  if (env.EMAIL_TRANSPORT) return env.EMAIL_TRANSPORT;
  // xkeysib- keys are REST API keys; xsmtpsib- keys are SMTP keys.
  return env.BREVO_API_KEY.startsWith("xkeysib") ? "api" : "smtp";
};

const sendViaApi = async ({ to, subject, html }) => {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
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
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Brevo API responded ${response.status}: ${detail.slice(0, 300)}`);
  }

  logger.info({ to }, "Email sent via Brevo API");
};

const sendViaSmtp = async ({ to, subject, html }) => {
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: env.EMAIL_SMTP_HOST,
    port: env.EMAIL_SMTP_PORT,
    secure: env.EMAIL_SMTP_PORT === 465,
    auth: {
      user: env.EMAIL_SMTP_USER,
      pass: env.BREVO_API_KEY,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  await transporter.sendMail({
    from: `"${env.EMAIL_FROM}" <${env.EMAIL_FROM_EMAIL}>`,
    to,
    subject,
    html,
  });

  logger.info({ to }, "Email sent via SMTP");
};

const sendOtpEmail = async ({ to, otp, purpose }) => {
  const isVerification = purpose === "EMAIL_VERIFICATION";
  const subject = isVerification
    ? "Verify your email — Meridian Bank"
    : "Your password reset code — Meridian Bank";
  const heading = isVerification ? "Confirm your email address" : "Reset your password";
  const intro = isVerification
    ? `<p style="margin:0 0 20px;font-size:14px;color:${BRAND.ink};line-height:1.6;">Thanks for opening your account. Use the code below to verify your email address and activate your account.</p>`
    : `<p style="margin:0 0 20px;font-size:14px;color:${BRAND.ink};line-height:1.6;">We received a request to reset your Meridian Bank password. Use the code below to choose a new password.</p>`;

  const html = layout({ heading, body: intro + otpBlock(otp) });

  if (!env.BREVO_API_KEY) {
    logger.warn({ to, purpose }, "Brevo key not set — OTP email delivery unavailable");
    return { delivered: false };
  }

  const transport = resolveTransport();
  const sender = transport === "api" ? sendViaApi : sendViaSmtp;

  try {
    await sender({ to, subject, html });
    return { delivered: true, transport };
  } catch (error) {
    logger.error(
      { to, purpose, transport, error: error.message },
      "Failed to send OTP email"
    );
    throw new Error(`Failed to send verification email: ${error.message}`, {
      cause: error,
    });
  }
};

const sendSecurityAlertEmail = async ({
  to,
  changedAt = new Date(),
  via = "PASSWORD_CHANGE",
}) => {
  const changed = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(changedAt);

  const html = layout({
    heading: "Your password was changed",
    body: `
      <p style="margin:0 0 16px;font-size:14px;color:${BRAND.ink};line-height:1.6;">
        The password for your Meridian Bank account was changed on ${changed} UTC.
      </p>
      <p style="margin:0 0 16px;font-size:14px;color:${BRAND.ink};line-height:1.6;">
        Every other active session was signed out at the same time.
      </p>
      <p style="margin:0;font-size:13px;color:${BRAND.muted};line-height:1.6;">
        If you made this change, no action is needed. If you did not, reset your password
        immediately and contact Meridian Bank support.
      </p>
    `,
    footerNote: `This is an automated security alert from Meridian Bank. You receive it because
                  security alert emails are enabled for your account.`,
  });

  if (!env.BREVO_API_KEY) {
    logger.warn({ to, purpose: via }, "Brevo key not set — security alert delivery unavailable");
    return { delivered: false };
  }

  const transport = resolveTransport();
  const sender = transport === "api" ? sendViaApi : sendViaSmtp;

  try {
    await sender({
      to,
      subject: "Security alert — your Meridian Bank password was changed",
      html,
    });
    return { delivered: true, transport };
  } catch (error) {
    logger.error(
      { to, purpose: via, transport, error: error.message },
      "Failed to send security alert email"
    );
    throw new Error(`Failed to send security alert email: ${error.message}`, {
      cause: error,
    });
  }
};

module.exports = { sendOtpEmail, sendSecurityAlertEmail };
