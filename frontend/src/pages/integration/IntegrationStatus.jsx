import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  GitBranch,
  Layers,
  ListChecks,
  XCircle,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";

const READY = [
  "Field-level validation with Zod",
  "Password hashing (bcryptjs, 12 rounds)",
  "Rate limiting on auth endpoints",
  "Centralized error handling",
  "Structured logging with PII redaction",
  "Production auth bypass prevention",
  "Health check endpoint",
  "Graceful shutdown",
  "Database schema and migrations",
  "Automated test suite (24 tests)",
  "Live HTTP integration tests (64 tests)",
  "Swagger/OpenAPI documentation",
];

const NOT_READY = [
  { task: "Production JWT verification", blocker: "Identity model decision" },
  { task: "Identity model decision", blocker: "Architectural decision" },
  { task: "Password ownership decision", blocker: "Architectural decision" },
  { task: "Refresh-token revocation coordination", blocker: "Password ownership decision" },
  { task: "Service-to-service authentication", blocker: "Internal API design" },
  { task: "Safe migration planning", blocker: "Identity model decision" },
  { task: "Docker Compose integration", blocker: null },
  { task: "ESLint configuration", blocker: null },
  { task: "CI/CD pipeline", blocker: null },
  { task: "Production secret management", blocker: null },
  { task: "Monitoring, backups, recovery", blocker: null },
];

const DECISIONS = [
  { n: 1, decision: "Identity model", options: "Shared UUID vs mapping table", blocker: true },
  { n: 2, decision: "Password ownership", options: "auth-service vs user-service", blocker: true },
  { n: 3, decision: "Refresh token revocation trigger", options: "Internal API call vs event", blocker: false },
  { n: 4, decision: "Profile-only fields", options: "Keep email/username in user-service?", blocker: false },
  { n: 5, decision: "Service-to-service auth", options: "mTLS vs signed tokens vs internal network", blocker: false },
  { n: 6, decision: "Dev users migration", options: "Delete vs migrate to auth-service", blocker: false },
];

const SEQUENCE = [
  { step: 1, label: "Approve identity and password ownership decisions", depends: "—" },
  { step: 2, label: "Define cross-service identity contract", depends: "Step 1" },
  { step: 3, label: "Implement and test production JWT verification in user-service", depends: "Step 2" },
  { step: 4, label: "Define profile-to-account identity mapping", depends: "Step 1" },
  { step: 5, label: "Integrate user-service with agreed authentication mechanism", depends: "Steps 3, 4" },
  { step: 6, label: "Coordinate password changes and session invalidation", depends: "Step 5" },
  { step: 7, label: "Add service-specific configuration and orchestration", depends: "Step 5" },
  { step: 8, label: "Integrate frontend after backend contracts are stable", depends: "Step 7" },
  { step: 9, label: "Run cross-service integration and security tests", depends: "Step 8" },
  { step: 10, label: "Review deployment readiness", depends: "Step 9" },
];

const DIAGRAM = `
┌─────────────────┐     ┌─────────────────┐
│  auth-service   │     │  user-service   │
│  (Phase 1)      │     │  (Phase 2)      │
│                 │     │                 │
│  Owns:          │     │  Owns:          │
│  - JWT tokens   │     │  - Profile data │
│  - Refresh tokens│    │  - Dev sessions │
│  - auth_db      │     │  - user_db      │
└────────┬────────┘     └────────┬────────┘
          │                       │
          ▼                       ▼
     ┌─────────┐            ┌─────────┐
     │ auth_db │            │ user_db │
     └─────────┘            └─────────┘
`;

export default function IntegrationStatus() {
  const navigate = useNavigate();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="link mb-3 text-[13px]!"
          >
            <ArrowLeft size={13} className="mr-1 inline" /> Back to overview
          </button>
          <p className="eyebrow">Backend</p>
          <h1 className="mt-1 text-2xl font-extrabold">Integration status</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-500">
            Contract defined between auth-service and user-service — integration{" "}
            <span className="font-semibold text-navy-900">not implemented</span>.
          </p>
        </div>

        <section className="card">
          <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
            <Layers size={16} className="text-gold-600" />
            <h2 className="text-[15px] font-extrabold">Current architecture</h2>
          </div>
          <pre className="num overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed text-navy-800">
            {DIAGRAM}
          </pre>
          <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-400">
            No connection exists between the services. user_db is dedicated to user-service and is
            not shared with auth-service.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card">
            <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
              <ListChecks size={16} className="text-gold-600" />
              <h2 className="text-[15px] font-extrabold">Readiness checklist</h2>
            </div>
            <div className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600">
                  Implemented
                </p>
                <ul className="space-y-2">
                  {READY.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[13px] text-ink-500">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-600">
                  Not ready
                </p>
                <ul className="space-y-2">
                  {NOT_READY.map(({ task, blocker }) => (
                    <li key={task} className="flex items-start gap-2 text-[13px] text-ink-500">
                      <XCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
                      <span>
                        {task}
                        {blocker && (
                          <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-400">
                            {blocker}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
              <AlertTriangle size={16} className="text-gold-600" />
              <h2 className="text-[15px] font-extrabold">Unresolved decisions</h2>
            </div>
            <ul className="divide-y divide-ink-100">
              {DECISIONS.map((d) => (
                <li key={d.n} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-extrabold text-navy-700">
                    {d.n}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-navy-900">{d.decision}</p>
                    <p className="text-xs text-ink-400">{d.options}</p>
                  </div>
                  {d.blocker ? (
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600">
                      Blocker
                    </span>
                  ) : (
                    <span className="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-bold text-ink-400">
                      Open
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card">
          <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
            <GitBranch size={16} className="text-gold-600" />
            <h2 className="text-[15px] font-extrabold">Integration sequence</h2>
          </div>
          <ol className="p-5">
            {SEQUENCE.map((s, i) => (
              <li key={s.step} className="relative flex gap-4 pb-6 last:pb-0">
                {i < SEQUENCE.length - 1 && (
                  <span className="absolute left-[15px] top-8 h-full w-px bg-ink-200" aria-hidden />
                )}
                <span
                  className={`num z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
                    s.step === 1
                      ? "border-gold-500 bg-gold-100 text-gold-600"
                      : "border-ink-200 bg-white text-ink-400"
                  }`}
                >
                  {s.step}
                </span>
                <div className="pt-1">
                  <p className="text-sm font-bold text-navy-900">{s.label}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">
                    <CircleDashed size={11} />
                    Depends on: <span className="num font-semibold">{s.depends}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </MainLayout>
  );
}
