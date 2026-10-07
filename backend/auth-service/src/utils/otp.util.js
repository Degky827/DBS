const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_PURPOSES = {
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  PASSWORD_RESET: "PASSWORD_RESET",
};

const generateOtp = () => crypto.randomInt(0, 1000000).toString().padStart(6, "0");

const hashOtp = (otp) => bcrypt.hash(otp, 10);

const compareOtp = (otp, hash) => bcrypt.compare(otp, hash);

const otpExpiry = () => new Date(Date.now() + OTP_TTL_MS);

module.exports = { generateOtp, hashOtp, compareOtp, otpExpiry, OTP_TTL_MS, OTP_PURPOSES };
