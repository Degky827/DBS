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

const layout = ({ heading, body }) => `
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
                  This message was sent by Meridian Bank. If you did not request this code,
                  you can safely ignore this email. Never share your one-time codes with anyone.
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
    logger.warn({ to, purpose }, "Brevo key not set — OTP will only be written to the logs");
    return { delivered: false };
  }

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: env.EMAIL_SMTP_HOST,
      port: env.EMAIL_SMTP_PORT,
      secure: false,
      auth: {
        user: env.EMAIL_FROM_EMAIL,
        pass: env.BREVO_API_KEY,
      },
    });

    await transporter.sendMail({
      from: `"${env.EMAIL_FROM}" <${env.EMAIL_FROM_EMAIL}>`,
      to,
      subject,
      html,
    });

    logger.info({ to, purpose }, "OTP email sent via SMTP");
    return { delivered: true };
  } catch (error) {
    logger.error({ to, purpose, error: error.message }, "Failed to send OTP email");
    throw new Error("Failed to send verification email");
  }
};

module.exports = { sendOtpEmail };
