import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  FileWarning,
  KeyRound,
  SearchX,
  ServerCrash,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import StatusCard from "../../components/StatusCard";

const MOCK_ERRORS = {
  400: {
    label: "Bad Request",
    icon: Ban,
    explanation:
      "The server rejected the request because the payload is malformed or fails validation (Zod field errors). Fix the request body and retry.",
    response: {
      success: false,
      message: "Validation failed",
      errors: [{ field: "email", message: "Invalid email address" }],
    },
  },
  401: {
    label: "Unauthorized",
    icon: KeyRound,
    explanation:
      "No valid Bearer token was presented, or the token is expired / has an invalid signature. The client must re-authenticate.",
    response: {
      success: false,
      message: "Invalid or expired token",
      errors: null,
    },
  },
  404: {
    label: "Not Found",
    icon: SearchX,
    explanation:
      "The authenticated user has no matching UserProfile row (or the route does not exist). The user ID is always taken from the verified token subject.",
    response: {
      success: false,
      message: "User profile not found",
      errors: null,
    },
  },
  500: {
    label: "Internal Server Error",
    icon: ServerCrash,
    explanation:
      "An unexpected failure inside the service. Check the health endpoint and structured logs (PII-redacted) before retrying.",
    response: {
      success: false,
      message: "Unexpected server error",
      errors: null,
    },
  },
};

export default function ErrorDemo() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(null);

  const active = selected ? MOCK_ERRORS[selected] : null;

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
          <p className="eyebrow">Error handling</p>
          <h1 className="mt-1 text-2xl font-extrabold">Error response demo</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-500">
            Trigger each error envelope exactly as the user service would return it. All responses
            follow the shared failure shape.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(MOCK_ERRORS).map(([code, e]) => {
            const Icon = e.icon;
            const isSelected = selected === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => setSelected(code)}
                className={`card group flex items-center gap-3 px-4 py-3.5 text-left transition hover:border-navy-500/40 hover:shadow-[0_8px_24px_-16px_rgba(5,13,26,.45)] ${
                  isSelected ? "border-navy-500/50 bg-navy-50/60" : ""
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition group-hover:bg-navy-800 group-hover:text-white ${
                    isSelected ? "bg-navy-800 text-white" : "bg-ink-50 text-ink-500"
                  }`}
                >
                  <Icon size={17} />
                </span>
                <span className="text-sm font-bold text-navy-900">
                  <span className="num">{code}</span> — {e.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card">
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                <FileWarning size={16} className="text-gold-600" /> Mock error response
              </h2>
            </div>
            <div className="p-5">
              {active ? (
                <>
                  <span className="num inline-block rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-extrabold text-red-600">
                    {selected} {active.label}
                  </span>
                  <pre className="num mt-3 overflow-x-auto rounded-lg bg-navy-900 p-4 font-mono text-xs leading-relaxed text-navy-100">
                    {JSON.stringify(active.response, null, 2)}
                  </pre>
                </>
              ) : (
                <p className="py-6 text-center text-sm text-ink-400">
                  Select an error code above to see the response envelope.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-4">
            {Object.entries(MOCK_ERRORS).map(([code, e]) => (
              <StatusCard
                key={code}
                title={`${code} — ${e.label}`}
                description={e.explanation}
                status={code === "500" ? "failed" : "pending"}
              />
            ))}
          </section>
        </div>
      </div>
    </MainLayout>
  );
}
