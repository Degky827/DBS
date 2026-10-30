const { Prisma } = require("@prisma/client");
const crypto = require("crypto");
const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const ledger = require("../ledger/ledger.service");
const policies = require("../policies/policies.service");
const {
  toAmountString,
  toMinorUnits,
  fromMinorUnits,
} = require("../wallets/money");

const formatPayment = (payment) => ({
  id: payment.id,
  reference: payment.reference,
  provider: payment.provider,
  providerRef: payment.providerRef,
  type: payment.type,
  status: payment.status,
  amount: payment.amount.toFixed(2),
  currency: payment.currency,
  checkoutUrl: payment.checkoutUrl,
  failureReason: payment.failureReason,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

const newMerchantReference = () =>
  `d_${crypto.randomBytes(12).toString("base64url")}`;

const safeProviderMessage = (verification) =>
  typeof verification.message === "string"
    ? verification.message.slice(0, 240)
    : "Payment was not completed";

class PaymentsService {
  constructor(providerBoundary, database = prisma) {
    this.provider = providerBoundary;
    this.prisma = database;
  }

  setProvider(providerBoundary) {
    this.provider = providerBoundary;
  }

  async initiateDeposit({
    userId,
    userProfile,
    amount,
    idempotencyKey,
  }) {
    const amountString = toAmountString(amount);
    const decimalAmount = new Prisma.Decimal(amountString);
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, currency: true, isActive: true },
    });

    if (!wallet) {
      throw ApiError.notFound("Wallet not found", "WALLET_NOT_FOUND");
    }
    if (!wallet.isActive) {
      throw ApiError.conflict("Wallet is inactive", "WALLET_INACTIVE");
    }

    const principalCents = toMinorUnits(amountString);
    const policy = await policies.getPolicy(
      this.prisma,
      "DEPOSIT",
      wallet.currency
    );
    policies.assertAmountWithinPolicy(policy, principalCents);
    const feeCents = policies.calculateFeeCents(policy, principalCents);
    if (feeCents >= principalCents) {
      throw ApiError.conflict(
        "The configured deposit fee would consume the entire deposit",
        "DEPOSIT_FEE_INVALID"
      );
    }

    const findExisting = () =>
      this.prisma.payment.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
    const existing = await findExisting();
    if (existing) {
      return this.resumeOrReplay(existing, {
        userId,
        wallet,
        amountString,
        decimalAmount,
        idempotencyKey,
        userProfile,
      });
    }

    let payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          reference: newMerchantReference(),
          provider: "CHAPA",
          type: "DEPOSIT",
          status: "PENDING",
          amount: decimalAmount,
          currency: wallet.currency,
          idempotencyKey,
          userId,
          walletId: wallet.id,
        },
      });
    } catch (error) {
      if (error.code !== "P2002") throw error;
      const concurrent = await findExisting();
      if (!concurrent) throw error;
      return this.resumeOrReplay(concurrent, {
        userId,
        wallet,
        amountString,
        decimalAmount,
        idempotencyKey,
        userProfile,
      });
    }

    audit("PAYMENT_DEPOSIT_INITIATED", {
      userId,
      paymentReference: payment.reference,
      amount: amountString,
      currency: payment.currency,
    });
    return this.initializeProviderCheckout(payment, userProfile);
  }

  async resumeOrReplay(payment, { wallet, amountString, userProfile }) {
    if (
      payment.walletId !== wallet.id ||
      payment.amount.toFixed(2) !== amountString
    ) {
      throw ApiError.conflict(
        "Idempotency key was already used with different parameters",
        "IDEMPOTENCY_KEY_REUSED"
      );
    }

    if (payment.checkoutUrl || payment.status !== "PENDING") {
      return { payment: formatPayment(payment), replayed: true };
    }

    return this.initializeProviderCheckout(payment, userProfile);
  }

  async initializeProviderCheckout(payment, userProfile) {
    const result = await this.provider.initiate({
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      email: userProfile.email,
      firstName: userProfile.firstName,
      lastName: userProfile.lastName,
      phoneNumber: userProfile.phoneNumber,
      txRef: payment.reference,
    });

    if (
      result.merchantReference &&
      result.merchantReference !== payment.reference
    ) {
      throw new ApiError(
        502,
        "Payment provider returned a different merchant reference",
        "PAYMENT_PROVIDER_ERROR"
      );
    }

    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        checkoutUrl: result.checkoutUrl,
        providerRef: result.providerRef || null,
      },
    });
    const updated = await this.prisma.payment.findUnique({
      where: { id: payment.id },
    });
    return { payment: formatPayment(updated), replayed: false };
  }

  async handleWebhook(req) {
    if (!this.provider.verifyWebhook(req)) {
      throw ApiError.badRequest("Invalid webhook signature", "INVALID_SIGNATURE");
    }
    if (!Buffer.isBuffer(req.rawBody)) {
      throw ApiError.badRequest("Webhook raw body is required", "INVALID_WEBHOOK_BODY");
    }

    const payload = req.body;
    const expectedEventStatus = {
      "payment.success": "success",
      "payment.failed": "failed",
      "payment.cancelled": "cancelled",
      "payment.incomplete": "incomplete",
      "payment.auth_needed": "auth_needed",
      "payment.blocked": "blocked",
    };
    if (
      !payload ||
      payload.webhook_type !== "payment" ||
      !Object.hasOwn(expectedEventStatus, payload.event) ||
      payload.status !== expectedEventStatus[payload.event] ||
      (payload.mode !== undefined && payload.mode !== "test")
    ) {
      throw ApiError.badRequest(
        "Unsupported Chapa Test Mode payment webhook",
        "INVALID_WEBHOOK_EVENT"
      );
    }

    const reference =
      typeof payload.merchant_reference === "string"
        ? payload.merchant_reference
        : payload.chapa_reference;
    if (typeof reference !== "string" || !reference) {
      throw ApiError.badRequest(
        "Missing payment reference in webhook payload",
        "MISSING_PAYMENT_REFERENCE"
      );
    }

    return this.processVerification(reference, {
      webhookDelivery: {
        bodyHash: crypto.createHash("sha256").update(req.rawBody).digest("hex"),
        event: payload.event,
        mode: payload.mode || "test",
      },
    });
  }

  async verifyAndCredit(reference, userId) {
    return this.processVerification(reference, { userId });
  }

  async processVerification(reference, { userId = null, webhookDelivery = null } = {}) {
    const payment = await this.prisma.payment.findFirst({
      where: webhookDelivery
        ? { OR: [{ reference }, { providerRef: reference }] }
        : { reference },
      select: { id: true, reference: true, userId: true, status: true },
    });
    if (!payment || (userId && payment.userId !== userId)) {
      throw ApiError.notFound("Payment not found", "PAYMENT_NOT_FOUND");
    }

    if (payment.status === "COMPLETED" && !webhookDelivery) {
      return {
        payment: formatPayment(
          await this.prisma.payment.findUnique({ where: { id: payment.id } })
        ),
        alreadyProcessed: true,
      };
    }

    if (payment.status === "COMPLETED" && webhookDelivery) {
      const completed = await this.prisma.$transaction(async (tx) => {
        await tx.paymentWebhookEvent.createMany({
          data: [
            {
              id: crypto.randomUUID(),
              bodyHash: webhookDelivery.bodyHash,
              paymentReference: payment.reference,
              event: webhookDelivery.event,
              mode: webhookDelivery.mode,
              processedAt: new Date(),
            },
          ],
          skipDuplicates: true,
        });
        return tx.payment.findUnique({ where: { id: payment.id } });
      });
      return { payment: formatPayment(completed), alreadyProcessed: true };
    }

    const verification = await this.provider.getStatus(payment.reference);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`
      );
      const current = await tx.payment.findUnique({ where: { id: payment.id } });
      if (!current) {
        throw ApiError.notFound("Payment not found", "PAYMENT_NOT_FOUND");
      }

      const finish = async (result, error = null) => {
        if (webhookDelivery) {
          await tx.paymentWebhookEvent.createMany({
            data: [
              {
                id: crypto.randomUUID(),
                bodyHash: webhookDelivery.bodyHash,
                paymentReference: current.reference,
                event: webhookDelivery.event,
                mode: webhookDelivery.mode,
                processedAt: new Date(),
              },
            ],
            skipDuplicates: true,
          });
        }
        return { ...result, error };
      };

      if (current.status === "COMPLETED") {
        return finish({
          payment: formatPayment(current),
          alreadyProcessed: true,
        });
      }

      if (
        verification.merchantReference !== current.reference ||
        (current.providerRef && verification.providerRef !== current.providerRef)
      ) {
        return finish(
          {
            payment: formatPayment(current),
            alreadyProcessed: false,
          },
          {
            code: "PAYMENT_REFERENCE_MISMATCH",
            message: "Chapa verification did not match this payment reference",
          }
        );
      }

      if (verification.status === "PENDING") {
        if (current.status === "FAILED") {
          return finish({
            payment: formatPayment(current),
            alreadyProcessed: true,
          });
        }
        const updated = await tx.payment.update({
          where: { id: current.id },
          data: { providerRef: verification.providerRef },
        });
        return finish({
          payment: formatPayment(updated),
          alreadyProcessed: false,
        });
      }

      if (verification.status === "FAILED") {
        const updated = await tx.payment.update({
          where: { id: current.id },
          data: {
            status: "FAILED",
            providerRef: verification.providerRef,
            failureReason: safeProviderMessage(verification),
          },
        });
        return finish({
          payment: formatPayment(updated),
          alreadyProcessed: false,
        });
      }

      if (verification.status !== "SUCCESS") {
        return finish(
          { payment: formatPayment(current), alreadyProcessed: false },
          {
            code: "PAYMENT_PROVIDER_ERROR",
            message: "Chapa returned an unsupported payment status",
          }
        );
      }

      if (!verification.providerRef) {
        return finish(
          { payment: formatPayment(current), alreadyProcessed: false },
          {
            code: "PAYMENT_PROVIDER_ERROR",
            message: "Chapa verification did not include a provider reference",
          }
        );
      }

      let verifiedAmount;
      try {
        verifiedAmount = toAmountString(verification.amount);
      } catch {
        verifiedAmount = null;
      }
      const amountMatches = verifiedAmount === current.amount.toFixed(2);
      const currencyMatches =
        typeof verification.currency === "string" &&
        verification.currency.toUpperCase() === current.currency;
      if (!amountMatches || !currencyMatches) {
        const reason = amountMatches
          ? `Currency mismatch: expected ${current.currency}, received ${verification.currency || "missing"}`
          : `Amount mismatch: expected ${current.amount.toFixed(2)}, received ${verifiedAmount || "invalid"}`;
        const updated = await tx.payment.update({
          where: { id: current.id },
          data: {
            status: "FAILED",
            providerRef: verification.providerRef,
            failureReason: reason,
          },
        });
        return finish(
          { payment: formatPayment(updated), alreadyProcessed: false },
          {
            code: amountMatches
              ? "PAYMENT_CURRENCY_MISMATCH"
              : "PAYMENT_AMOUNT_MISMATCH",
            message: amountMatches
              ? "Payment verification failed due to currency mismatch"
              : "Payment verification failed due to amount mismatch",
          }
        );
      }

      const grossCents = toMinorUnits(current.amount.toFixed(2));
      const depositPolicy = await policies.getPolicy(
        tx,
        "DEPOSIT",
        current.currency
      );
      policies.assertAmountWithinPolicy(depositPolicy, grossCents);
      const feeCents = policies.calculateFeeCents(depositPolicy, grossCents);
      if (feeCents >= grossCents) {
        throw ApiError.conflict(
          "The configured deposit fee would consume the entire deposit",
          "DEPOSIT_FEE_INVALID"
        );
      }
      const netCents = grossCents - feeCents;
      const businessDate = policies.businessDateFor(depositPolicy.timezone);
      const feeString = fromMinorUnits(feeCents);

      const transaction = await tx.transaction.create({
        data: {
          type: "DEPOSIT",
          status: "POSTED",
          currency: current.currency,
          initiatedByUserId: current.userId,
          sourceWalletId: null,
          destinationWalletId: current.walletId,
          amount: current.amount,
          feeAmount: new Prisma.Decimal(feeString),
          businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          policySnapshot: policies.policySnapshot(depositPolicy, feeCents, {
            businessDate,
          }),
          idempotencyKey: `payment:${current.id}`,
          paymentId: current.id,
        },
      });

      const postings = [
        {
          accountCode: ledger.ACCOUNT_CODES.PROVIDER_CLEARING,
          direction: "DEBIT",
          amount: current.amount.toFixed(2),
        },
        {
          accountCode: `WALLET:${current.walletId}`,
          direction: "CREDIT",
          amount: fromMinorUnits(netCents),
        },
      ];
      if (feeCents > 0n) {
        postings.push({
          accountCode: ledger.ACCOUNT_CODES.FEE_REVENUE,
          direction: "CREDIT",
          amount: feeString,
        });
      }

      await ledger.postEntry({
        tx,
        eventType: "DEPOSIT",
        eventRef: `payment:${current.id}`,
        currency: current.currency,
        description: `Deposit ${current.reference}`,
        metadata: {
          paymentReference: current.reference,
          provider: current.provider,
          providerRef: verification.providerRef,
          grossAmount: current.amount.toFixed(2),
          feeAmount: feeString,
        },
        createdByUserId: current.userId,
        transactionId: transaction.id,
        postings,
        walletGuards: [{ walletId: current.walletId, requireActive: true }],
      });

      const completed = await tx.payment.update({
        where: { id: current.id },
        data: {
          status: "COMPLETED",
          providerRef: verification.providerRef,
          failureReason: null,
        },
      });
      return finish({
        payment: formatPayment(completed),
        alreadyProcessed: false,
      });
    });

    outcome.verification = {
      status: verification.status,
      rawStatus: verification.rawStatus ?? null,
      providerRef: verification.providerRef ?? null,
      amount: verification.amount ?? null,
      currency: verification.currency ?? null,
      merchantReference: verification.merchantReference ?? null,
    };

    if (outcome.error) {
      if (outcome.error.code.includes("MISMATCH")) {
        audit("PAYMENT_VERIFICATION_REJECTED", {
          userId: payment.userId,
          paymentReference: payment.reference,
          reason: outcome.error.code,
        });
      }
      throw ApiError.conflict(outcome.error.message, outcome.error.code);
    }

    if (!outcome.alreadyProcessed) {
      if (outcome.payment.status === "COMPLETED") {
        audit("PAYMENT_COMPLETED", {
          userId: payment.userId,
          paymentReference: payment.reference,
          amount: outcome.payment.amount,
          currency: outcome.payment.currency,
        });
      } else if (outcome.payment.status === "FAILED") {
        audit("PAYMENT_FAILED", {
          userId: payment.userId,
          paymentReference: payment.reference,
          reason: outcome.payment.failureReason,
        });
      }
    }

    return outcome;
  }
}

module.exports = PaymentsService;
