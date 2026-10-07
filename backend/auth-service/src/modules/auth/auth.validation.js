const { z } = require("zod");

const NAME_PATTERN = /^[A-Za-zÀ-ÿ' -]+$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const GENDERS = ["male", "female", "other", "prefer_not_to_say"];

const requiredString = (label) =>
  z.string({
    error: (issue) =>
      issue.input === undefined
        ? `${label} is required`
        : `${label} must be a string`,
  });

const nameField = (label) =>
  requiredString(label)
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(60, `${label} must not exceed 60 characters`)
    .regex(
      NAME_PATTERN,
      `${label} may only contain letters, spaces, hyphens and apostrophes`
    );

const emailField = requiredString("email")
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email("email must be a valid email address")
      .max(254, "email must not exceed 254 characters")
  );

const registerSchema = z
  .object({
    firstName: nameField("firstName"),
    middleName: nameField("middleName").optional(),
    lastName: nameField("lastName"),
    username: requiredString("username")
      .trim()
      .regex(
        USERNAME_PATTERN,
        "username must be 3-30 characters and contain only letters, numbers and underscores"
      ),
    dateOfBirth: z.coerce
      .date({ error: "dateOfBirth must be a valid date" })
      .refine((d) => d.getTime() < Date.now(), "dateOfBirth must be in the past"),
    gender: z.enum(GENDERS, {
      error: `gender must be one of: ${GENDERS.join(", ")}`,
    }),
    phoneNumber: requiredString("phoneNumber")
      .trim()
      .regex(PHONE_PATTERN, "phoneNumber must be 7-15 digits, optionally prefixed with +"),
    email: emailField,
    password: requiredString("password")
      .min(8, "password must be at least 8 characters")
      .max(72, "password must not exceed 72 characters")
      .regex(
        PASSWORD_PATTERN,
        "password must contain at least one uppercase letter, one lowercase letter and one number"
      ),
    confirmPassword: requiredString("confirmPassword"),
    securityQuestion: requiredString("securityQuestion")
      .trim()
      .min(5, "securityQuestion is required")
      .max(200, "securityQuestion must not exceed 200 characters"),
    securityAnswer: requiredString("securityAnswer")
      .trim()
      .min(2, "securityAnswer is required")
      .max(100, "securityAnswer must not exceed 100 characters"),
    acceptedTerms: z.literal(true, {
      error: "acceptedTerms must be true",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "password and confirmPassword must match",
    path: ["confirmPassword"],
  });

const verifyEmailSchema = z.object({
  email: emailField,
  otp: requiredString("otp")
    .trim()
    .regex(/^\d{6}$/, "otp must be a 6-digit code"),
});

const resendOtpSchema = z.object({
  email: emailField,
});

const passwordField = (label) =>
  requiredString(label)
    .min(8, `${label} must be at least 8 characters`)
    .max(72, `${label} must not exceed 72 characters`)
    .regex(
      PASSWORD_PATTERN,
      `${label} must contain at least one uppercase letter, one lowercase letter and one number`
    );

const refreshSchema = z.object({
  refreshToken: requiredString("refreshToken").trim().min(1, "refreshToken is required"),
});

const logoutSchema = z.object({
  refreshToken: requiredString("refreshToken").trim().min(1, "refreshToken is required"),
});

const forgotPasswordSchema = z.object({
  email: emailField,
});

const resetPasswordSchema = z
  .object({
    email: emailField,
    otp: requiredString("otp")
      .trim()
      .regex(/^\d{6}$/, "otp must be a 6-digit code"),
    newPassword: passwordField("newPassword"),
    confirmNewPassword: requiredString("confirmNewPassword"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "newPassword and confirmNewPassword must match",
    path: ["confirmNewPassword"],
  });

const loginSchema = z.object({
  email: emailField,
  password: requiredString("password")
    .min(1, "password is required")
    .max(72, "password must not exceed 72 characters"),
});

module.exports = {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendOtpSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
