const crypto = require("crypto");
const ApiError = require("../../utils/ApiError");

const amountToMinorUnits = (amount) => {
  if (typeof amount !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) {
    throw new TypeError("Payment amount must be a decimal string");
  }
  const [whole, fraction = ""] = amount.split(".");
  const minorUnits = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minorUnits < 100n || minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Payment amount is outside Chapa's supported range");
  }
  return Number(minorUnits);
};

const minorUnitsToAmount = (value) => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d+$/.test(String(value))
  ) {
    return null;
  }
  const minorUnits = BigInt(value);
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return `${minorUnits / 100n}.${String(minorUnits % 100n).padStart(2, "0")}`;
};

const providerError = (message) =>
  new ApiError(502, message, "PAYMENT_PROVIDER_ERROR");

class ChapaAdapter {
  constructor({
    secretKey,
    webhookSecret,
    baseUrl = "https://api.chapa.global",
    callbackUrl,
    returnUrl,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.secretKey = secretKey;
    this.webhookSecret = webhookSecret;
    this.baseUrl = (baseUrl || "https://api.chapa.global").replace(/\/+$/, "");
    this.callbackUrl = callbackUrl;
    this.returnUrl = returnUrl;
    this.fetchImpl = fetchImpl;
    this.isBaseUrlAllowed = (() => {
      try {
        const url = new URL(this.baseUrl);
        return (
          url.protocol === "https:" &&
          url.hostname === "api.chapa.global" &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    })();
  }

  get isConfigured() {
    return Boolean(
      /^CHAPA_TEST_[A-Za-z0-9_-]+$/.test(this.secretKey || "") &&
        this.webhookSecret &&
        this.webhookSecret.length >= 16 &&
        this.isBaseUrlAllowed &&
        this.isSafeConfiguredUrl(this.callbackUrl) &&
        this.isSafeConfiguredUrl(this.returnUrl) &&
        typeof this.fetchImpl === "function"
    );
  }

  isSafeConfiguredUrl(value) {
    try {
      const url = new URL(value);
      const localHttp =
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
        url.protocol === "http:";
      return (
        (url.protocol === "https:" || localHttp) &&
        !url.username &&
        !url.password &&
        !url.hash
      );
    } catch {
      return false;
    }
  }

  async request(url, options, failureMessage) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw providerError(failureMessage);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw providerError(failureMessage);
    }

    if (!response.ok || !data || typeof data !== "object") {
      throw providerError(failureMessage);
    }
    return data;
  }

  async initiate({
    amount,
    currency = "ETB",
    email,
    firstName,
    lastName,
    phoneNumber,
    txRef,
  }) {
    if (!this.isConfigured) {
      throw ApiError.notImplemented(
        "External payments are unavailable until Chapa Test Mode is configured",
        "PAYMENT_PROVIDER_NOT_CONFIGURED"
      );
    }

    const payload = {
      amount: amountToMinorUnits(amount),
      currency,
      merchant_reference: txRef,
      customer: {
        email,
        first_name: firstName,
        last_name: lastName,
        ...(phoneNumber && /^\+[1-9]\d{7,14}$/.test(phoneNumber)
          ? { phone_number: phoneNumber }
          : {}),
      },
      callback_url: this.callbackUrl,
      return_url: this.buildReturnUrl(txRef),
      meta: { purpose: "wallet_deposit" },
    };

    const data = await this.request(
      `${this.baseUrl}/v2/payments/hosted`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": txRef,
        },
        body: JSON.stringify(payload),
      },
      "Unable to initialize payment with Chapa"
    );

    const checkoutUrl = data.data?.checkout_url;
    if (data.status !== "success" || typeof checkoutUrl !== "string") {
      throw providerError("Chapa did not return a valid checkout session");
    }

    let parsedCheckoutUrl;
    try {
      parsedCheckoutUrl = new URL(checkoutUrl);
    } catch {
      throw providerError("Chapa returned an invalid checkout URL");
    }
    if (parsedCheckoutUrl.protocol !== "https:" || !parsedCheckoutUrl.hostname) {
      throw providerError("Chapa returned an invalid checkout URL");
    }

    const checkoutReference = parsedCheckoutUrl.pathname.split("/").filter(Boolean).at(-1);
    let providerRef = data.data.chapa_reference || data.data.reference || null;
    if (!providerRef && checkoutReference) {
      try {
        providerRef = decodeURIComponent(checkoutReference);
      } catch {
        throw providerError("Chapa returned an invalid checkout reference");
      }
    }
    return {
      checkoutUrl: parsedCheckoutUrl.toString(),
      txRef,
      merchantReference: data.data.merchant_reference || txRef,
      providerRef,
    };
  }

  buildReturnUrl(merchantReference) {
    const url = new URL(this.returnUrl);
    url.searchParams.set("merchant_reference", merchantReference);
    return url.toString();
  }

  async getStatus(merchantReference) {
    if (!this.isConfigured) {
      throw ApiError.notImplemented(
        "External payments are unavailable until Chapa Test Mode is configured",
        "PAYMENT_PROVIDER_NOT_CONFIGURED"
      );
    }

    const data = await this.request(
      `${this.baseUrl}/v2/payments/${encodeURIComponent(merchantReference)}/verify`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${this.secretKey}` },
      },
      "Unable to verify payment with Chapa"
    );
    const payment = data.data;
    if (data.status !== "success" || !payment || typeof payment !== "object") {
      throw providerError("Chapa could not verify this payment");
    }

    const rawStatus = String(payment.status || "").toUpperCase();
    const status =
      rawStatus === "SUCCESS"
        ? "SUCCESS"
        : rawStatus === "PENDING" || rawStatus === "AUTH_NEEDED"
          ? "PENDING"
          : ["FAILED", "CANCELLED", "INCOMPLETE", "BLOCKED"].includes(rawStatus)
            ? "FAILED"
            : "PENDING";

    return {
      status,
      rawStatus,
      merchantReference: payment.merchant_reference || null,
      providerRef: payment.chapa_reference || payment.processor_reference || null,
      amount: minorUnitsToAmount(payment.amount),
      currency: typeof payment.currency === "string" ? payment.currency : null,
    };
  }

  verifyWebhook(req) {
    if (!this.webhookSecret || !Buffer.isBuffer(req.rawBody)) return false;
    const signature = req.headers["x-chapa-signature"];
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) {
      return false;
    }

    const expected = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(req.rawBody)
      .digest();
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }
}

module.exports = ChapaAdapter;
module.exports.amountToMinorUnits = amountToMinorUnits;
module.exports.minorUnitsToAmount = minorUnitsToAmount;
