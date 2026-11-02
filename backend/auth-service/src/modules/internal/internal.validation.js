const { z } = require("zod");

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

const requiredString = (label) =>
  z.string({
    error: (issue) =>
      issue.input === undefined
        ? `${label} is required`
        : `${label} must be a string`,
  });

const emailField = requiredString("email")
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email("email must be a valid email address")
      .max(254, "email must not exceed 254 characters")
  );

const changePasswordSchema = z
  .object({
    email: emailField,
    currentPassword: requiredString("currentPassword")
      .min(1, "currentPassword is required")
      .max(72, "currentPassword must not exceed 72 characters"),
    newPassword: requiredString("newPassword")
      .min(8, "newPassword must be at least 8 characters")
      .max(72, "newPassword must not exceed 72 characters")
      .regex(
        PASSWORD_PATTERN,
        "newPassword must contain at least one uppercase letter, one lowercase letter and one number"
      ),
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "newPassword must be different from the current password",
    path: ["newPassword"],
  });

const introspectTokenSchema = z
  .object({
    token: requiredString("token")
      .min(16, "token must be at least 16 characters")
      .max(4096, "token must not exceed 4096 characters"),
  })
  .strict();

const accountStatusSchema = z
  .object({
    email: emailField,
    status: z.enum(["ACTIVE", "FROZEN", "SUSPENDED", "CLOSED"]),
    reason: z
      .string()
      .trim()
      .max(500, "reason must not exceed 500 characters")
      .optional(),
    actorId: z.string().trim().max(64).optional(),
  })
  .strict();

const accountStatusesSchema = z
  .object({
    emails: z
      .array(emailField)
      .min(1, "emails must contain at least one address")
      .max(200, "emails must not exceed 200 entries"),
  })
  .strict();

const resetMfaSchema = z
  .object({
    email: emailField,
    actorId: z.string().trim().max(64).optional(),
  })
  .strict();

const closeAccountSchema = z
  .object({
    email: emailField,
    password: requiredString("password")
      .min(1, "password is required")
      .max(72, "password must not exceed 72 characters"),
    reason: z
      .string()
      .trim()
      .max(500, "reason must not exceed 500 characters")
      .optional(),
  })
  .strict();

module.exports = {
  changePasswordSchema,
  introspectTokenSchema,
  accountStatusSchema,
  accountStatusesSchema,
  resetMfaSchema,
  closeAccountSchema,
};
