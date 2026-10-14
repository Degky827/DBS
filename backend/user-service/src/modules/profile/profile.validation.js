const { z } = require("zod");

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
const GENDERS = ["male", "female", "other", "prefer_not_to_say"];
const NAME_PATTERN = /^[A-Za-zÀ-ÿ' -]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

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

const optionalNameField = (label) => nameField(label).optional();

const optionalShortText = (label, max) =>
  requiredString(label)
    .trim()
    .max(max, `${label} must not exceed ${max} characters`)
    .optional();

const updateProfileSchema = z
  .object({
    firstName: optionalNameField("firstName"),
    middleName: optionalNameField("middleName"),
    lastName: optionalNameField("lastName"),
    phoneNumber: requiredString("phoneNumber")
      .trim()
      .regex(
        PHONE_PATTERN,
        "phoneNumber must be 7-15 digits, optionally prefixed with +"
      )
      .optional(),
    gender: z
      .enum(GENDERS, {
        error: `gender must be one of: ${GENDERS.join(", ")}`,
      })
      .optional(),
    dateOfBirth: z.coerce
      .date({ error: "dateOfBirth must be a valid date" })
      .refine(
        (d) => d.getTime() < Date.now(),
        "dateOfBirth must be in the past"
      )
      .optional(),
    addressLine1: optionalShortText("addressLine1", 200),
    addressLine2: optionalShortText("addressLine2", 200),
    city: optionalShortText("city", 100),
    state: optionalShortText("state", 100),
    postalCode: optionalShortText("postalCode", 20),
    country: optionalShortText("country", 100),
    bio: optionalShortText("bio", 500),
    avatarUrl: requiredString("avatarUrl")
      .trim()
      .url("avatarUrl must be a valid URL")
      .max(500, "avatarUrl must not exceed 500 characters")
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one profile field must be provided"
  );

const passwordField = (label) =>
  requiredString(label)
    .min(8, `${label} must be at least 8 characters`)
    .max(72, `${label} must not exceed 72 characters`)
    .regex(
      PASSWORD_PATTERN,
      `${label} must contain at least one uppercase letter, one lowercase letter and one number`
    );

const changePasswordSchema = z
  .object({
    currentPassword: requiredString("currentPassword")
      .min(1, "currentPassword is required")
      .max(72, "currentPassword must not exceed 72 characters"),
    newPassword: passwordField("newPassword"),
    confirmNewPassword: requiredString("confirmNewPassword"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "newPassword and confirmNewPassword must match",
    path: ["confirmNewPassword"],
  });

module.exports = {
  updateProfileSchema,
  changePasswordSchema,
};
