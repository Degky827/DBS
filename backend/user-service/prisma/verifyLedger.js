#!/usr/bin/env node
/**
 * Read-only integrity check for the double-entry ledger.
 *
 * Runs the same SQL checks the scheduled verification job and the admin
 * "run now" action use, so a failure here means the same thing everywhere.
 * Nothing is written unless --record is given, and even then only a run row and
 * its issues: journal entries are never touched by this script.
 *
 * Usage:
 *   DATABASE_URL=... npm run ledger:verify
 *   npm run ledger:verify -- --group payouts --json
 *   npm run ledger:verify -- --record --trigger CI
 *
 * Exits 1 when a check fails or cannot complete.
 */
const prisma = require("../src/config/database");
const { runChecks, ledgerTotals, CHECK_GROUPS } = require("../src/modules/ledger/ledgerChecks");

const FAILING_SEVERITIES = ["CRITICAL", "HIGH"];

const parseArgs = (argv) => {
  const options = { groups: null, json: false, record: false, trigger: "CI" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--record") options.record = true;
    else if (arg === "--group") {
      index += 1;
      const name = argv[index];
      if (!CHECK_GROUPS[name]) {
        throw new Error(
          `Unknown check group "${name}". Expected one of ${Object.keys(CHECK_GROUPS).join(", ")}.`
        );
      }
      options.groups = [...(options.groups || []), name];
    } else if (arg === "--trigger") {
      index += 1;
      if (!["SCHEDULED", "MANUAL", "CI"].includes(argv[index])) {
        throw new Error(`Unknown trigger "${argv[index]}".`);
      }
      options.trigger = argv[index];
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.record && options.groups) {
    // A recorded run is the bank's official history for the whole book; a
    // partial scan must never be stored as one.
    throw new Error("--record runs every check group and cannot be combined with --group.");
  }
  const groups = options.groups || Object.keys(CHECK_GROUPS);
  const { issues, checkErrors, checksRun } = await runChecks(prisma, { groups });
  const totals = await ledgerTotals(prisma);

  const failing = issues.filter((issue) => FAILING_SEVERITIES.includes(issue.severity));
  const advisory = issues.filter((issue) => !FAILING_SEVERITIES.includes(issue.severity));

  let recorded = null;
  if (options.record) {
    const { runVerification } = require("../src/modules/ledger/ledgerVerify.service");
    recorded = await runVerification({ trigger: options.trigger });
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          groups,
          checksRun,
          totals,
          failing,
          advisory,
          checkErrors,
          status: checkErrors.length > 0 || failing.length > 0 ? "FAILED" : "PASSED",
          recorded: recorded ? { reference: recorded.reference, status: recorded.status } : null,
        },
        null,
        2
      )
    );
  } else {
    console.log("Ledger integrity report");
    console.log(`  check groups : ${groups.join(", ")}`);
    console.log(`  checks run   : ${checksRun}`);
    console.log(
      `  ledger totals: debits ${totals.debits} / credits ${totals.credits} (difference ${totals.difference})`
    );
    console.log(`  wallets      : ${totals.wallets} (liability ${totals.walletLiability})`);
    for (const account of totals.platformAccounts) {
      console.log(`    ${account.code}: ${account.balance}`);
    }

    if (checkErrors.length > 0) {
      console.error(`\nCHECK ERRORS: ${checkErrors.length}`);
      for (const entry of checkErrors) {
        console.error(`  [${entry.classification}] ${entry.error}`);
      }
    }
    if (issues.length === 0 && checkErrors.length === 0) {
      console.log("\nOK: ledger integrity checks passed");
    } else {
      console.log(`\n${issues.length} finding(s):`);
      for (const found of [...failing, ...advisory]) {
        const delta = found.difference === null ? "" : ` difference ${found.difference}`;
        console.error(
          `  [${found.severity}] ${found.classification} ${found.aggregateType} ${found.aggregateId}` +
            `${found.accountCode ? ` account ${found.accountCode}` : ""}` +
            `${found.expected === null ? "" : ` expected ${found.expected} actual ${found.actual}`}${delta}`
        );
      }
    }
    if (recorded) {
      console.log(`\nRecorded run ${recorded.reference} with status ${recorded.status}`);
    }
  }

  return checkErrors.length > 0 || failing.length > 0 ? 1 : 0;
};

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error.message || String(error));
    await prisma.$disconnect();
    process.exit(1);
  });
