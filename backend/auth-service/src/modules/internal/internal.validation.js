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

module.exports = { changePasswordSchema };
