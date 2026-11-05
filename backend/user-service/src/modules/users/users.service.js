const { randomUUID } = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const env = require("../../config/env");
const logger = require("../../config/logger");
const prisma = require("../../config/database");
const userRepository = require("../../repositories/user.repository");
const devSessionRepository = require("../../repositories/devSession.repository");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const { changeAuthPassword, closeAccount } = require("../../services/authClient");
const accountLifecycle = require("../../services/accountLifecycle.service");
const { hashPassword, comparePassword, DUMMY_HASH } = require("../../utils/password.util");

const toPublicProfile = (user) => ({
  id: user.id,
  firstName: user.firstName,
  middleName: user.middleName,
  lastName: user.lastName,
  username: user.username,
  email: user.email,
  phoneNumber: user.phoneNumber,
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  addressLine1: user.addressLine1,
  addressLine2: user.addressLine2,
  city: user.city,
  state: user.state,
  postalCode: user.postalCode,
  country: user.country,
  bio: user.bio,
  avatarUrl: user.avatarUrl,
  role: user.role,
  accountStatus: user.accountStatus || "ACTIVE",
  passwordChangedAt: user.passwordChangedAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const UPDATABLE_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "phoneNumber",
  "gender",
  "dateOfBirth",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "bio",
  "avatarUrl",
];

const IMAGE_TYPES = [
  {
    mimeType: "image/jpeg",
    extension: "jpg",
    matches: (buffer) =>
      buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    mimeType: "image/png",
    extension: "png",
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: "image/webp",
    extension: "webp",
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP",
  },
];

const getAvatarType = (file) =>
  IMAGE_TYPES.find((type) => type.mimeType === file.mimetype && type.matches(file.buffer));

const USE_DATABASE_AVATARS = env.AVATAR_STORAGE_BACKEND === "postgres";

const removePreviousAvatar = async (avatarUrl) => {
  const prefix = "/uploads/avatars/";
  if (!avatarUrl?.startsWith(prefix)) return;

  const filename = avatarUrl.slice(prefix.length);
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return;

  try {
    if (USE_DATABASE_AVATARS) {
      await prisma.avatarBlob.deleteMany({ where: { filename } });
    } else {
      await fs.unlink(path.join(env.AVATAR_UPLOAD_DIR, filename));
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger.warn({ error: error.message }, "Unable to remove previous avatar");
    }
  }
};

const sanitizeUsernameBase = (email) => {
  const local = String(email || "")
    .split("@")[0]
    .toLowerCase();
  const cleaned = local
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 24);
  return `${cleaned || "user"}_${Date.now().toString(36)}`.slice(0, 24);
};

const generateUniqueUsername = async (email) => {
  const base = sanitizeUsernameBase(email);
  const random = () => Math.random().toString(36).slice(2, 6);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}_${random()}`.slice(0, 30);
    const taken = await userRepository.findByUsername(candidate);
    if (!taken) return candidate;
  }

  return `${base}_${Date.now().toString(36)}`.slice(0, 30);
};

// Creates a minimal UserProfile on first JWT access so the profile APIs
// work immediately after a Phase 1 login. The user completes the rest via
// Edit Profile.
const provisionProfile = async ({ email, role }) => {
  const username = await generateUniqueUsername(email);

  return userRepository.create({
    email,
    username,
    firstName: "",
    lastName: "",
    phoneNumber: "",
    dateOfBirth: new Date(0),
    gender: "prefer_not_to_say",
    role: role === "ADMIN" ? "ADMIN" : "USER",
    passwordHash: DUMMY_HASH,
  });
};

// Resolves the UserProfile for the authenticated caller.
// - dev mode: the session already targets a profile id.
// - jwt mode: match by the verified email claim, provisioning if absent.
const resolveProfile = async (authCtx) => {
  if (authCtx.authMode !== "jwt") {
    return userRepository.findById(authCtx.id);
  }

  const email = String(authCtx.email || "").toLowerCase();
  if (!email) {
    throw ApiError.unauthorized("Token missing email claim", "INVALID_TOKEN_SUBJECT");
  }

  const existing = await userRepository.findByEmail(email);
  if (existing) return existing;

  audit("PROFILE_PROVISIONED", { email });
  return provisionProfile({ email, role: authCtx.role });
};

const getResolvedUserId = async (authCtx) => {
  const profile = await resolveProfile(authCtx);
  if (!profile) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }
  return profile.id;
};

const getMyProfile = async (authCtx) => {
  const resolved = await resolveProfile(authCtx);

  if (!resolved) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  const user = await userRepository.findProfileById(resolved.id);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return { user: toPublicProfile(user) };
};

const updateMyProfile = async (authCtx, input, avatarFile) => {
  const profile = await resolveProfile(authCtx);

  if (!profile) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  const data = {};

  for (const field of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      if (field === "dateOfBirth") {
        data[field] = new Date(input[field]);
      } else if (field === "middleName" && input[field] === "") {
        data[field] = null;
      } else {
        data[field] = input[field];
      }
    }
  }

  let avatarFilename;
  if (avatarFile) {
    const imageType = getAvatarType(avatarFile);
    if (!imageType) {
      throw ApiError.badRequest(
        "Avatar file content does not match a supported PNG, JPEG, or WebP image",
        "INVALID_AVATAR_CONTENT"
      );
    }

    avatarFilename = `${randomUUID()}.${imageType.extension}`;
    data.avatarUrl = `/uploads/avatars/${avatarFilename}`;

    if (USE_DATABASE_AVATARS) {
      await prisma.avatarBlob.create({
        data: {
          filename: avatarFilename,
          contentType: imageType.mimeType,
          data: avatarFile.buffer,
        },
      });
    } else {
      await fs.mkdir(env.AVATAR_UPLOAD_DIR, { recursive: true });
      await fs.writeFile(path.join(env.AVATAR_UPLOAD_DIR, avatarFilename), avatarFile.buffer, {
        flag: "wx",
      });
    }
  }

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest("At least one profile field must be provided", "EMPTY_UPDATE");
  }

  try {
    await userRepository.updateProfile(profile.id, data);
  } catch (error) {
    if (avatarFilename) {
      try {
        if (USE_DATABASE_AVATARS) {
          await prisma.avatarBlob.deleteMany({ where: { filename: avatarFilename } });
        } else {
          await fs.unlink(path.join(env.AVATAR_UPLOAD_DIR, avatarFilename));
        }
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          logger.warn({ error: cleanupError.message }, "Unable to remove unassigned avatar");
        }
      }
    }
    throw error;
  }

  const updated = await userRepository.findProfileById(profile.id);

  if (!updated) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  if (avatarFile) {
    await removePreviousAvatar(profile.avatarUrl);
  }

  audit("PROFILE_UPDATED", { userId: profile.id, fields: Object.keys(data) });

  return { user: toPublicProfile(updated) };
};

const changeMyPassword = async (authCtx, input, session) => {
  // AUTH_MODE=jwt: auth-service owns the credential — proxy the change so the
  // real login password and all refresh tokens are updated/revoked there.
  if (authCtx.authMode === "jwt") {
    const result = await changeAuthPassword({
      email: authCtx.email,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });

    audit("PASSWORD_CHANGED", { userId: authCtx.id, via: "auth-service" });

    return {
      message: result.message || "Password has been changed. Other sessions were revoked.",
    };
  }

  // AUTH_MODE=dev: standalone local password management (tests / offline).
  const user = await userRepository.findById(authCtx.id);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  const isCurrentValid = await comparePassword(
    input.currentPassword,
    user.passwordHash || DUMMY_HASH
  );

  if (!isCurrentValid) {
    audit("PASSWORD_CHANGE_FAILED", { userId: user.id });
    throw ApiError.unauthorized("Current password is incorrect", "INVALID_CURRENT_PASSWORD");
  }

  if (input.currentPassword === input.newPassword) {
    throw ApiError.badRequest(
      "New password must be different from the current password",
      "PASSWORD_REUSE"
    );
  }

  const passwordHash = await hashPassword(input.newPassword);
  await userRepository.updatePassword(user.id, passwordHash);

  if (session) {
    await devSessionRepository.revokeAllForUserExcept(user.id, session.id);
  }

  audit("PASSWORD_CHANGED", { userId: user.id, via: "dev" });

  return {
    message: "Password has been changed. Other development sessions were revoked.",
  };
};

const closeMyAccount = async (authCtx, input) => {
  const profile = await resolveProfile(authCtx);

  if (!profile) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  if ((profile.accountStatus || "ACTIVE") === "CLOSED") {
    throw ApiError.conflict("Account is already closed", "ACCOUNT_CLOSED");
  }

  await accountLifecycle.assertSettled(profile.id);

  if (authCtx.authMode === "jwt") {
    await closeAccount({
      email: profile.email || authCtx.email,
      password: input.password,
      reason: input.reason || "Closed by account holder",
    });
  } else {
    const valid = await comparePassword(input.password, profile.passwordHash || DUMMY_HASH);
    if (!valid) {
      audit("ACCOUNT_CLOSE_FAILED", { userId: profile.id, reason: "PASSWORD" });
      throw ApiError.unauthorized("Password is incorrect", "INVALID_CURRENT_PASSWORD");
    }
  }

  await accountLifecycle.applyLocalStatus(profile.id, "CLOSED", {
    type: "account.status_changed",
    aggregateType: "user",
    aggregateId: profile.id,
    payload: {
      from: profile.accountStatus || "ACTIVE",
      to: "CLOSED",
      reason: input.reason || "Closed by account holder",
      actorId: profile.id,
      user: {
        userId: profile.id,
        email: profile.email || authCtx.email || null,
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
      },
    },
  });
  audit("ACCOUNT_CLOSED", { userId: profile.id, via: authCtx.authMode });

  return {
    message: "Account closed. Remaining data is retained according to the bank's records policy.",
  };
};

// Contact fields are the only profile data another service needs to send a
// customer message. Keeping this lookup narrow means the internal endpoint
// cannot be used to read a full profile.
async function getContact(userId) {
  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, accountStatus: true },
  });
  if (!profile) {
    throw ApiError.notFound("User profile not found", "USER_PROFILE_NOT_FOUND");
  }

  return {
    userId: profile.id,
    email: profile.email,
    name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
    accountStatus: profile.accountStatus || "ACTIVE",
  };
}

module.exports = {
  getResolvedUserId,
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  closeMyAccount,
  getContact,
};
