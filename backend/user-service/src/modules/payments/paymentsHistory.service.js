const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const paymentFields = {
  id: true,
  reference: true,
  provider: true,
  type: true,
  status: true,
  amount: true,
  currency: true,
  checkoutUrl: true,
  failureReason: true,
  createdAt: true,
  updatedAt: true,
};

const formatPayment = (payment) => ({
  id: payment.id,
  reference: payment.reference,
  provider: payment.provider,
  type: payment.type,
  status: payment.status,
  amount: payment.amount.toFixed(2),
  currency: payment.currency,
  checkoutUrl: payment.checkoutUrl,
  failureReason: payment.failureReason,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

const listPayments = async (userId, { limit, cursor }) => {
  const where = { userId };

  if (cursor) {
    const cursorPayment = await prisma.payment.findFirst({
      where: { id: cursor, userId },
      select: { id: true },
    });
    if (!cursorPayment) {
      throw ApiError.badRequest(
        "Payment cursor is invalid for this account",
        "INVALID_PAYMENT_CURSOR"
      );
    }
  }

  const [page, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
      select: paymentFields,
    }),
    prisma.payment.count({ where }),
  ]);

  const hasMore = page.length > limit;
  const payments = page.slice(0, limit);
  return {
    payments: payments.map(formatPayment),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? payments[payments.length - 1].id : null,
      total,
    },
  };
};

module.exports = { listPayments };
