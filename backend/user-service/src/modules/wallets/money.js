const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;
const MAX_AMOUNT_CENTS = 9999999999999999999n;

const parseCents = (value) => {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};

const isValidAmount = (value) => {
  const cents = parseCents(value);
  return cents !== null && cents > 0n && cents <= MAX_AMOUNT_CENTS;
};

const toMinorUnits = (value) => {
  const cents = parseCents(value);
  if (cents === null || cents <= 0n || cents > MAX_AMOUNT_CENTS) {
    throw new TypeError("Amount must be a positive decimal with at most two places");
  }
  return cents;
};

const fromMinorUnits = (cents) => {
  if (typeof cents !== "bigint" || cents < 0n || cents > MAX_AMOUNT_CENTS) {
    throw new TypeError("Minor units are outside the supported range");
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
};

const toAmountString = (value) => fromMinorUnits(toMinorUnits(value));

// Exact conversion for database numeric values returned as strings. Platform
// clearing, fee, reserve, and equity accounts may carry negative balances.
const decimalStringToMinorUnits = (value) => {
  if (typeof value === "bigint") {
    if (value < -MAX_AMOUNT_CENTS || value > MAX_AMOUNT_CENTS) {
      throw new TypeError("Amount is outside the supported range");
    }
    return value;
  }
  const text = String(value ?? "").trim();
  const match = /^(-?)(0|[1-9]\d{0,16})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TypeError("Amount is not a supported decimal");
  const magnitude =
    BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  const cents = match[1] === "-" ? -magnitude : magnitude;
  if (cents < -MAX_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
    throw new TypeError("Amount is outside the supported range");
  }
  return cents;
};

module.exports = {
  MAX_AMOUNT_CENTS,
  isValidAmount,
  toMinorUnits,
  fromMinorUnits,
  toAmountString,
  decimalStringToMinorUnits,
};
