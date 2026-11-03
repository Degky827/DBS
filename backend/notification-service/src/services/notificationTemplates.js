const amountText = (currency, amount) => `${currency || ""} ${amount || "0.00"}`.trim();

const identity = (payload, key) => {
  const nested = payload[key];
  if (nested && typeof nested === "object") {
    return {
      userId: nested.userId || null,
      email: typeof nested.email === "string" ? nested.email : null,
      name: typeof nested.name === "string" ? nested.name : null,
    };
  }
  return {
    userId: payload.userId || null,
    email: typeof payload.email === "string" ? payload.email : null,
    name: null,
  };
};

const notification = ({ recipient, title, body, sendEmail = true, data }) => ({
  userId: recipient.userId,
  recipientEmail: recipient.email,
  title,
  body,
  sendEmail,
  data,
});

// One outbox event can fan out to several recipients. Each template returns
// the notifications to persist for that event (an empty list means the event
// is recorded but nothing is delivered).
const TEMPLATES = {
  "transfer.completed": (payload) => {
    const sender = identity(payload, "sender");
    const recipient = identity(payload, "recipient");
    const amount = amountText(payload.currency, payload.amount);
    const reference = payload.transactionReference;
    const items = [];

    if (sender.email) {
      items.push(
        notification({
          recipient: sender,
          title: "Transfer sent",
          body: `${amount} was sent to ${recipient.name || recipient.email || "the recipient"}. Fee: ${amountText(payload.currency, payload.feeAmount)}. Reference: ${reference}.`,
        })
      );
    }
    if (recipient.email) {
      items.push(
        notification({
          recipient,
          title: "Transfer received",
          body: `${amount} was received from ${sender.name || sender.email || "another customer"}. Reference: ${reference}.`,
        })
      );
    }
    return items;
  },

  "deposit.completed": (payload) => {
    const user = identity(payload, "user");
    if (!user.email) return [];
    const net = amountText(payload.currency, payload.netAmount);
    return [
      notification({
        recipient: user,
        title: "Deposit completed",
        body: `${net} was credited to your account (gross ${amountText(payload.currency, payload.amount)}, fee ${amountText(payload.currency, payload.feeAmount)}). Reference: ${payload.paymentReference}.`,
      }),
    ];
  },

  "withdrawal.reserved": (payload) => {
    const user = identity(payload, "user");
    if (!user.email) return [];
    return [
      notification({
        recipient: user,
        title: "Withdrawal requested",
        body: `${amountText(payload.currency, payload.amount)} is reserved for your withdrawal ${payload.withdrawalReference}. Payout is pending.`,
      }),
    ];
  },

  "withdrawal.cancelled": (payload) => {
    const user = identity(payload, "user");
    if (!user.email) return [];
    return [
      notification({
        recipient: user,
        title: "Withdrawal cancelled",
        body: `Withdrawal ${payload.withdrawalReference} for ${amountText(payload.currency, payload.amount)} was cancelled and the amount is available again.`,
      }),
    ];
  },

  "account.status_changed": (payload) => {
    const user = identity(payload, "user");
    if (!user.email) return [];
    const reason = payload.reason ? ` Reason: ${payload.reason}` : "";
    const messages = {
      ACTIVE: "Your account is active again.",
      FROZEN: "Your account has been frozen. Please contact support.",
      SUSPENDED: "Your account has been suspended. Please contact support.",
      CLOSED: "Your account has been closed.",
    };
    return [
      notification({
        recipient: user,
        title: "Account status updated",
        body: `${messages[payload.to] || `Your account status changed to ${payload.to}.`}${reason}`,
      }),
    ];
  },

  "dispute.opened": (payload) => {
    const user = identity(payload, "user");
    if (!user.email) return [];
    return [
      notification({
        recipient: user,
        title: "Dispute opened",
        body: `We received dispute ${payload.disputeReference} for transaction ${payload.transactionReference} (${amountText(payload.currency, payload.amount)}). Reason: ${payload.reason}.`,
      }),
    ];
  },

  "dispute.updated": (payload) => {
    const user = identity(payload, "user");
    if (!user.email) return [];
    const resolution = payload.resolution ? ` Resolution: ${payload.resolution}` : "";
    return [
      notification({
        recipient: user,
        title: "Dispute updated",
        body: `Dispute ${payload.disputeReference} for transaction ${payload.transactionReference} is now ${payload.status}.${resolution}`,
      }),
    ];
  },

  "scheduled_transfer.failed": (payload) => {
    const user = identity(payload, "user");
    if (!user.email) return [];
    return [
      notification({
        recipient: user,
        title: "Scheduled transfer failed",
        body: `Your scheduled transfer of ${amountText(payload.currency, payload.amount)} could not be completed and has been paused. Reason: ${payload.reason}.`,
      }),
    ];
  },

  // Operations alert, not a customer message. The emitting service resolves the
  // staff recipients itself and puts them on the event, because this service has
  // no view of who administers the bank.
  "ledger.integrity_failed": (payload) => {
    const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
    const counts = payload.severityCounts || {};
    const detail = { ...payload };
    delete detail.recipients;

    return recipients
      .filter((recipient) => recipient && typeof recipient.email === "string")
      .map((recipient) =>
        notification({
          recipient: {
            userId: recipient.userId || null,
            email: recipient.email,
            name: recipient.name,
          },
          title: "Ledger integrity check failed",
          body:
            `Ledger verification run ${payload.runReference} (${payload.trigger || "SCHEDULED"}) found ` +
            `${counts.CRITICAL || 0} critical and ${counts.HIGH || 0} high inconsistency(ies)` +
            (payload.checkErrors
              ? `, and ${payload.checkErrors} check(s) could not complete`
              : "") +
            `. Debit/credit difference: ${payload.difference || "0.00"}. Review the open issues before the next close.`,
          data: detail,
        })
      );
  },
};

const buildNotifications = (eventType, payload) => {
  const template = TEMPLATES[eventType];
  if (!template) return [];

  const items = template(payload || {});
  // Lower-case for a stable identity across login providers and casing.
  return items
    .filter((item) => typeof item.recipientEmail === "string" && item.recipientEmail.trim())
    .map((item) => ({
      ...item,
      recipientEmail: item.recipientEmail.trim().toLowerCase(),
      data: item.data === undefined ? JSON.parse(JSON.stringify(payload || {})) : item.data,
    }));
};

module.exports = { buildNotifications, supportedEvents: Object.keys(TEMPLATES) };
