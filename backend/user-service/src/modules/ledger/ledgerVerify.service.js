const crypto = require("crypto");

const prisma = require("../../config/database");
const env = require("../../config/env");
const logger = require("../../config/logger");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const metrics = require("../../utils/metrics");
const outbox = require("../outbox/outbox.service");
const { runChecks, ledgerTotals, CHECK_GROUPS, SEVERITY } = require("./ledgerChecks");

// Ledger verification service.
//
// The checks themselves live in ledgerChecks.js and are read-only; this file
// owns the record: a run row (history), the issues it opened (deduplicated so
// one inconsistency is one operator task, not one per run) and the alert that
// tells administrators the books no longer agree.
//
// A run can never rewrite a journal entry. Corrections go through the reversal
// path in ledger.service.js; verification only reports.

const RUN_STATUS = Object.freeze({
  RUNNING: "RUNNING",
  PASSED: "PASSED",
  FAILED: "FAILED",
  ERROR: "ERROR",
});

const ISSUE_STATUS = Object.freeze({
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  RESOLVED: "RESOLVED",
  SUPPRESSED: "SUPPRESSED",
});

const TRIGGERS = Object.freeze(["SCHEDULED", "MANUAL", "CI"]);
const ALERT_EVENT_TYPE = "ledger.integrity_failed";
// An inconsistency that is already OPEN, ACKNOWLEDGED or SUPPRESSED is not a
// new finding; only a RESOLVED one re-opens when detected again.
const CARRIED_STATUSES = Object.freeze([
  ISSUE_STATUS.OPEN,
  ISSUE_STATUS.ACKNOWLEDGED,
  ISSUE_STATUS.SUPPRESSED,
]);
const FAILING_SEVERITIES = Object.freeze([SEVERITY.CRITICAL, SEVERITY.HIGH]);
const MAX_ISSUES_PER_RUN = 500;

const newReference = () => `LVR-${crypto.randomUUID().replace(/-/g, "")}`;

const targetKey = (issue) => `${issue.classification}|${issue.aggregateType}|${issue.aggregateId}`;

const businessDateOf = (value) => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest("Business date is invalid", "INVALID_BUSINESS_DATE");
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const decimalText = (value) => {
  if (value === null || value === undefined) return null;
  return typeof value.toFixed === "function" ? value.toFixed(2) : String(value);
};

const formatIssue = (issue) => ({
  id: issue.id,
  runId: issue.runId,
  runReference: issue.run?.reference ?? null,
  classification: issue.classification,
  severity: issue.severity,
  aggregateType: issue.aggregateType,
  aggregateId: issue.aggregateId,
  accountCode: issue.accountCode,
  expected: decimalText(issue.expected),
  actual: decimalText(issue.actual),
  difference: decimalText(issue.difference),
  details: issue.details ?? null,
  status: issue.status,
  acknowledgedBy: issue.acknowledgedBy,
  acknowledgedAt: issue.acknowledgedAt,
  resolvedBy: issue.resolvedBy,
  resolvedAt: issue.resolvedAt,
  resolutionNote: issue.resolutionNote,
  detectedAt: issue.detectedAt,
});

const formatRun = (run) => ({
  id: run.id,
  reference: run.reference,
  trigger: run.trigger,
  status: run.status,
  businessDate: run.businessDate,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  durationMs: run.durationMs,
  checksRun: run.checksRun,
  entriesChecked: run.entriesChecked,
  accountsChecked: run.accountsChecked,
  issuesFound: run.issuesFound,
  totals: run.totals ?? null,
  summary: run.summary ?? null,
  errorMessage: run.errorMessage,
  actorUserId: run.actorUserId,
  issues: run.issues ? run.issues.map(formatIssue) : undefined,
});

const severityCounts = (issues) => {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const issue of issues) {
    if (counts[issue.severity] !== undefined) counts[issue.severity] += 1;
  }
  return counts;
};

const classificationCounts = (issues) => {
  const counts = {};
  for (const issue of issues) {
    counts[issue.classification] = (counts[issue.classification] || 0) + 1;
  }
  return counts;
};

// A crashed worker leaves a RUNNING row behind. Close it as ERROR instead of
// letting the dashboard show an impossible in-flight run forever. The window is
// generous: a whole-book scan is the slowest thing this service does, and
// mislabelling a still-running scan is worse than waiting for it.
const abandonedBefore = () =>
  new Date(
    Date.now() -
      Math.min(Math.max(env.LEDGER_VERIFICATION_INTERVAL_MS, 15 * 60 * 1000), 2 * 60 * 60 * 1000)
  );

const reapAbandonedRuns = async () => {
  const result = await prisma.ledgerVerificationRun.updateMany({
    where: { status: RUN_STATUS.RUNNING, startedAt: { lt: abandonedBefore() } },
    data: {
      status: RUN_STATUS.ERROR,
      finishedAt: new Date(),
      errorMessage: "Verification run abandoned before completion",
    },
  });
  return result.count;
};

const alertRecipients = async () => {
  const admins = await prisma.userProfile.findMany({
    where: { role: "ADMIN", accountStatus: { not: "CLOSED" } },
    select: { id: true, email: true, firstName: true, lastName: true },
    take: 50,
  });
  return admins.map((admin) => ({
    userId: admin.id,
    email: admin.email,
    name: `${admin.firstName} ${admin.lastName}`.trim(),
  }));
};

const detectIssues = async () => {
  const [{ issues, checkErrors, checksRun }, entriesChecked, accountsChecked, totals] =
    await Promise.all([
      runChecks(prisma),
      prisma.journalEntry.count(),
      prisma.ledgerAccount.count(),
      ledgerTotals(prisma),
    ]);
  return { issues, checkErrors, checksRun, entriesChecked, accountsChecked, totals };
};

// Issues already carried from an earlier run are not inserted again, but they
// still count for this run's verdict: the ledger is inconsistent whether or not
// somebody has seen it yet.
const partitionIssues = async (detected) => {
  if (detected.length === 0) return { fresh: [], carried: [] };

  const existing = await prisma.ledgerVerificationIssue.findMany({
    where: {
      status: { in: CARRIED_STATUSES },
      classification: { in: [...new Set(detected.map((issue) => issue.classification))] },
    },
    select: { classification: true, aggregateType: true, aggregateId: true },
  });
  const known = new Set(existing.map(targetKey));

  const fresh = [];
  const carried = [];
  for (const issue of detected) {
    (known.has(targetKey(issue)) ? carried : fresh).push(issue);
  }
  return { fresh, carried };
};

const runVerification = async ({
  trigger = "SCHEDULED",
  actorUserId = null,
  businessDate = null,
} = {}) => {
  if (!TRIGGERS.includes(trigger)) {
    throw ApiError.badRequest("Unsupported verification trigger", "INVALID_VERIFICATION_TRIGGER");
  }

  await reapAbandonedRuns();
  const startedAt = new Date();
  const run = await prisma.ledgerVerificationRun.create({
    data: {
      reference: newReference(),
      trigger,
      status: RUN_STATUS.RUNNING,
      businessDate: businessDateOf(businessDate ?? startedAt),
      actorUserId,
    },
  });

  let detected;
  try {
    detected = await detectIssues();
  } catch (error) {
    const message = String(error.message || error).slice(0, 500);
    const failed = await prisma.ledgerVerificationRun.update({
      where: { id: run.id },
      data: {
        status: RUN_STATUS.ERROR,
        finishedAt: new Date(),
        durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        errorMessage: message,
      },
    });
    metrics.recordLedgerVerification(RUN_STATUS.ERROR.toLowerCase());
    logger.error({ err: error, reference: run.reference }, "Ledger verification could not run");
    return formatRun(failed);
  }

  const { fresh, carried } = await partitionIssues(detected.issues);
  const openNow = [...fresh, ...carried];
  const bySeverity = severityCounts(openNow);
  const hasCheckErrors = detected.checkErrors.length > 0;
  const isFailing =
    hasCheckErrors || openNow.some((issue) => FAILING_SEVERITIES.includes(issue.severity));

  const status = isFailing ? RUN_STATUS.FAILED : RUN_STATUS.PASSED;

  // The run row, its issues and the alert leave together: an operator must never
  // see a PASSED-looking history for a book that failed, nor an alert whose run
  // was rolled back.
  const finalized = await prisma.$transaction(async (tx) => {
    let inserted = 0;
    if (fresh.length > 0) {
      const created = await tx.ledgerVerificationIssue.createMany({
        data: fresh.slice(0, MAX_ISSUES_PER_RUN).map((issue) => ({
          runId: run.id,
          ...issue,
        })),
        // A concurrent run may have opened the same finding a moment earlier;
        // the partial unique index is the arbiter, not this process.
        skipDuplicates: true,
      });
      inserted = created.count;
    }

    const shouldAlert =
      isFailing &&
      (hasCheckErrors || fresh.some((issue) => FAILING_SEVERITIES.includes(issue.severity)));
    if (shouldAlert) {
      const recipients = await alertRecipients();
      await outbox.enqueue(tx, {
        type: ALERT_EVENT_TYPE,
        aggregateType: "LEDGER_VERIFICATION_RUN",
        aggregateId: run.id,
        payload: {
          runReference: run.reference,
          trigger,
          status,
          businessDate: run.businessDate.toISOString(),
          severityCounts: bySeverity,
          checkErrors: detected.checkErrors.length,
          newIssues: fresh
            .filter((issue) => FAILING_SEVERITIES.includes(issue.severity))
            .slice(0, 25)
            .map((issue) => ({
              classification: issue.classification,
              aggregateType: issue.aggregateType,
              aggregateId: issue.aggregateId,
              accountCode: issue.accountCode,
              difference: issue.difference,
            })),
          difference: detected.totals.difference,
          recipients,
        },
      });
    }

    // newIssueCount reports what was actually written. A finding this run
    // detected but did not write is carried, not new.
    const summary = {
      bySeverity,
      byClassification: classificationCounts(openNow),
      newIssueCount: inserted,
      detectedNewCount: fresh.length,
      carriedIssueCount: carried.length,
      checkErrors: detected.checkErrors,
      groups: Object.keys(CHECK_GROUPS),
    };
    if (fresh.length > MAX_ISSUES_PER_RUN) {
      summary.truncatedFrom = fresh.length;
      summary.notRecorded = fresh.slice(MAX_ISSUES_PER_RUN, MAX_ISSUES_PER_RUN + 50).map(targetKey);
    }

    const finishedAt = new Date();
    return tx.ledgerVerificationRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        checksRun: detected.checksRun,
        entriesChecked: detected.entriesChecked,
        accountsChecked: detected.accountsChecked,
        issuesFound: inserted,
        totals: detected.totals,
        summary,
        errorMessage: hasCheckErrors
          ? `One or more checks could not complete: ${detected.checkErrors
              .map((entry) => entry.classification)
              .join(", ")
              .slice(0, 480)}`
          : null,
      },
      include: { issues: true },
    });
  });

  metrics.recordLedgerVerification(status.toLowerCase());
  await refreshOpenIssueMetrics();
  audit("LEDGER_VERIFICATION_RUN", {
    reference: finalized.reference,
    trigger,
    status,
    issuesFound: finalized.issuesFound,
    actorUserId,
  });

  if (isFailing) {
    logger.warn(
      {
        reference: finalized.reference,
        bySeverity,
        checkErrors: detected.checkErrors.length,
      },
      "Ledger verification found inconsistencies"
    );
  }

  return formatRun(finalized);
};

const openIssueCounts = async () => {
  // The actionable backlog: OPEN plus ACKNOWLEDGED. A SUPPRESSED finding is
  // deliberately not counted - the operator has accepted it - while the run
  // verdict still reports the book as inconsistent.
  const rows = await prisma.ledgerVerificationIssue.groupBy({
    by: ["severity"],
    where: { status: { in: [ISSUE_STATUS.OPEN, ISSUE_STATUS.ACKNOWLEDGED] } },
    _count: { _all: true },
  });
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of rows) {
    if (counts[row.severity] !== undefined) counts[row.severity] = row._count._all;
  }
  return counts;
};

const refreshOpenIssueMetrics = async () => {
  try {
    const counts = await openIssueCounts();
    metrics.setLedgerOpenIssues(counts);
    return counts;
  } catch (error) {
    logger.error({ err: error }, "Ledger issue metrics could not be recorded");
    return null;
  }
};

const lastRunTimestamp = async () => {
  const last = await prisma.ledgerVerificationRun.findFirst({
    where: { status: { not: RUN_STATUS.RUNNING } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  if (last?.finishedAt) {
    metrics.setLedgerVerificationLastRun(Math.floor(last.finishedAt.getTime() / 1000));
  }
  return last?.finishedAt ?? null;
};

const listRuns = async ({ status, trigger, limit = 25, cursor } = {}) => {
  const where = {};
  if (status) where.status = status;
  if (trigger) where.trigger = trigger;
  const runs = await prisma.ledgerVerificationRun.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
  });
  const page = runs.slice(0, limit);
  return {
    runs: page.map(formatRun),
    nextCursor: runs.length > limit ? page[page.length - 1].id : null,
  };
};

const getRun = async (reference) => {
  const run = await prisma.ledgerVerificationRun.findFirst({
    where: { reference },
    include: { issues: { orderBy: [{ severity: "desc" }, { detectedAt: "desc" }] } },
  });
  if (!run) throw ApiError.notFound("Verification run not found", "VERIFICATION_RUN_NOT_FOUND");
  return formatRun(run);
};

const listIssues = async ({
  status = ISSUE_STATUS.OPEN,
  severity,
  classification,
  limit = 25,
  cursor,
} = {}) => {
  const where = {};
  if (status !== "all") where.status = status;
  if (severity) where.severity = severity;
  if (classification) where.classification = classification;

  const issues = await prisma.ledgerVerificationIssue.findMany({
    where,
    orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    include: { run: { select: { reference: true, trigger: true, businessDate: true } } },
  });
  const page = issues.slice(0, limit);
  return {
    issues: page.map(formatIssue),
    nextCursor: issues.length > limit ? page[page.length - 1].id : null,
  };
};

const TRANSITIONS = {
  acknowledge: {
    from: [ISSUE_STATUS.OPEN],
    label: "acknowledged",
    note: false,
    apply: (actorUserId) => ({
      status: ISSUE_STATUS.ACKNOWLEDGED,
      acknowledgedBy: actorUserId,
      acknowledgedAt: new Date(),
    }),
  },
  // A resolution note is mandatory: the database rejects a RESOLVED row without
  // one, so a silent close is impossible.
  resolve: {
    from: [ISSUE_STATUS.OPEN, ISSUE_STATUS.ACKNOWLEDGED, ISSUE_STATUS.SUPPRESSED],
    label: "resolved",
    note: true,
    apply: (actorUserId, note) => ({
      status: ISSUE_STATUS.RESOLVED,
      resolvedBy: actorUserId,
      resolvedAt: new Date(),
      resolutionNote: note,
    }),
  },
  suppress: {
    from: [ISSUE_STATUS.OPEN, ISSUE_STATUS.ACKNOWLEDGED],
    label: "suppressed",
    note: true,
    apply: (actorUserId, note) => ({
      status: ISSUE_STATUS.SUPPRESSED,
      acknowledgedBy: actorUserId,
      acknowledgedAt: new Date(),
      resolutionNote: note,
    }),
  },
  reopen: {
    from: [ISSUE_STATUS.SUPPRESSED, ISSUE_STATUS.RESOLVED],
    label: "reopened",
    note: true,
    apply: () => ({ status: ISSUE_STATUS.OPEN }),
  },
};

const transitionIssue = async (id, action, { actorUserId, note } = {}) => {
  const transition = TRANSITIONS[action];
  if (!transition) {
    throw ApiError.badRequest("Unsupported issue action", "INVALID_ISSUE_ACTION");
  }
  if (transition.note && !String(note ?? "").trim()) {
    throw ApiError.badRequest(
      "A note is required for this action",
      "VERIFICATION_ISSUE_NOTE_REQUIRED"
    );
  }

  const issue = await prisma.ledgerVerificationIssue.findUnique({ where: { id } });
  if (!issue) {
    throw ApiError.notFound("Verification issue not found", "VERIFICATION_ISSUE_NOT_FOUND");
  }
  if (!transition.from.includes(issue.status)) {
    throw ApiError.conflict(
      `Issue is ${issue.status} and cannot be ${transition.label}`,
      "VERIFICATION_ISSUE_STATE_CONFLICT"
    );
  }

  const text = note ? String(note).trim().slice(0, 2000) : null;
  const updated = await prisma.ledgerVerificationIssue.update({
    where: { id },
    data: transition.apply(actorUserId, text),
  });

  await refreshOpenIssueMetrics();
  audit("LEDGER_VERIFICATION_ISSUE_UPDATED", {
    issueId: id,
    classification: issue.classification,
    action,
    from: issue.status,
    to: updated.status,
    actorUserId,
  });
  return formatIssue(updated);
};

// The dashboard's integrity card: current verdict, what is still open and the
// headline reconciliation numbers. Nothing here is estimated or mocked - every
// figure is a live aggregate over the ledger.
const integrityOverview = async () => {
  const [latest, openCounts, totals, runningRuns] = await Promise.all([
    prisma.ledgerVerificationRun.findFirst({
      where: { status: { not: RUN_STATUS.RUNNING } },
      orderBy: { finishedAt: "desc" },
    }),
    openIssueCounts(),
    ledgerTotals(prisma),
    prisma.ledgerVerificationRun.count({ where: { status: RUN_STATUS.RUNNING } }),
  ]);
  await lastRunTimestamp();

  return {
    jobEnabled: env.LEDGER_VERIFICATION_ENABLED,
    intervalMs: env.LEDGER_VERIFICATION_INTERVAL_MS,
    checksAvailable: Object.values(CHECK_GROUPS).flat().length,
    latestRun: latest ? formatRun(latest) : null,
    openIssues: openCounts,
    runningRuns,
    totals,
  };
};

module.exports = {
  ALERT_EVENT_TYPE,
  ISSUE_STATUS,
  RUN_STATUS,
  TRIGGERS,
  runVerification,
  listRuns,
  getRun,
  listIssues,
  transitionIssue,
  integrityOverview,
  openIssueCounts,
  lastRunTimestamp,
  reapAbandonedRuns,
};
