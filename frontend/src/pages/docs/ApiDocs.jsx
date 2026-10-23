import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  FileJson,
  Globe,
  Lock,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";

const METHOD_STYLES = {
  GET: "border-emerald-200 bg-emerald-50 text-emerald-700",
  POST: "border-gold-400/40 bg-gold-100 text-gold-600",
  PATCH: "border-navy-100 bg-navy-50 text-navy-700",
};

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/health",
    auth: "None",
    authType: "none",
    description: "Liveness probe — returns service status and uptime.",
    request: null,
    response: [
      ["service", "string", 'Service name, e.g. "user-service"'],
      ["status", "string", '"healthy" | "warning" | "error"'],
      ["uptime", "number", "Seconds since last restart"],
      ["timestamp", "string", "ISO 8601 time of the check"],
    ],
    errors: "—",
  },
  {
    method: "POST",
    path: "/api/v1/auth/dev-login",
    auth: "Public",
    authType: "none",
    description: "Development login — verifies email + password and returns a dev session token.",
    request: [
      ["email", "string", "Account email address"],
      ["password", "string", "Account password"],
    ],
    response: [
      ["success", "boolean", "Always true on 200"],
      ["message", "string", "Human-readable result"],
      ["data.token", "string", "Dev Bearer token"],
      ["data.user", "object", "Authenticated user profile"],
    ],
    errors: "400 · 401 · 429",
  },
  {
    method: "POST",
    path: "/api/v1/auth/dev-logout",
    auth: "Bearer (dev)",
    authType: "bearer",
    description: "Revokes the current development session token.",
    request: [
      ["Authorization", "header", "Bearer <dev token>"],
    ],
    response: [
      ["success", "boolean", "Always true on 200"],
      ["message", "string", "Human-readable result"],
    ],
    errors: "401",
  },
  {
    method: "GET",
    path: "/api/v1/users/me",
    auth: "Bearer (dev)",
    authType: "bearer",
    description: "Returns the profile of the authenticated user (from the token subject).",
    request: [
      ["Authorization", "header", "Bearer <dev token>"],
    ],
    response: [
      ["success", "boolean", "Always true on 200"],
      ["data.id", "string", "Independent UserProfile UUID"],
      ["data.email", "string", "Profile email"],
      ["data.firstName", "string", "Given name"],
      ["data.lastName", "string", "Family name"],
    ],
    errors: "401 · 404 · 500",
  },
  {
    method: "PATCH",
    path: "/api/v1/users/me",
    auth: "Bearer (dev)",
    authType: "bearer",
    description: "Updates profile fields and optionally uploads a PNG, JPEG, or WebP avatar (maximum 5 MB).",
    request: [
      ["Authorization", "header", "Bearer <dev token>"],
      ["firstName", "string?", "New given name"],
      ["lastName", "string?", "New family name"],
      ["phoneNumber", "string?", "New phone number"],
      ["bio", "string?", "New biography"],
      ["avatar", "file?", "Profile photo (PNG, JPEG, or WebP; up to 5 MB)"],
    ],
    response: [
      ["success", "boolean", "Always true on 200"],
      ["data.updatedAt", "string", "ISO 8601 update time"],
    ],
    errors: "400 · 401 · 404 · 500",
  },
  {
    method: "PATCH",
    path: "/api/v1/users/me/password",
    auth: "Bearer (dev)",
    authType: "bearer",
    description: "Changes the password and revokes all other dev sessions for the user.",
    request: [
      ["Authorization", "header", "Bearer <dev token>"],
      ["currentPassword", "string", "Existing password"],
      ["newPassword", "string", "New password (8-72 characters)"],
    ],
    response: [
      ["success", "boolean", "Always true on 200"],
      ["data.passwordChangedAt", "string", "ISO 8601 change time"],
    ],
    errors: "400 · 401 · 404 · 429 · 500",
  },
];

function SchemaTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">
            <th className="py-2 pr-4">Field</th>
            <th className="py-2 pr-4">Type</th>
            <th className="py-2">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map(([field, type, desc]) => (
            <tr key={field}>
              <td className="num py-2 pr-4 font-mono text-xs font-bold text-navy-800">{field}</td>
              <td className="py-2 pr-4">
                <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-500">
                  {type}
                </span>
              </td>
              <td className="py-2 text-[13px] text-ink-500">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiDocs() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);

  const toggle = (path) => setOpen((cur) => (cur === path ? null : path));

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="link mb-3 text-[13px]!"
            >
              ← Back to overview
            </button>
            <p className="eyebrow">User service</p>
            <h1 className="mt-1 text-2xl font-extrabold">API documentation</h1>
            <p className="mt-1 max-w-xl text-sm text-ink-500">
              Six endpoints, one response envelope —{" "}
              <code className="num rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-navy-800">
                {"{ success, message, data }"}
              </code>{" "}
              on success,{" "}
              <code className="num rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-navy-800">
                {"{ success: false, message, errors }"}
              </code>{" "}
              on failure.
            </p>
          </div>
          <a
            href="/api/v1/openapi.json"
            className="btn-ghost ml-auto"
          >
            <FileJson size={15} /> OpenAPI specification
          </a>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-gold-400/40 bg-gold-100/60 p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-gold-600" />
          <div>
            <p className="text-sm font-bold text-gold-600">Development authentication only</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">
              All protected endpoints currently run with{" "}
              <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-xs text-navy-800">AUTH_MODE=dev</code>{" "}
              bearer tokens. Production JWT verification (issuer, audience, signing keys) is not
              implemented yet — see the integration status page before calling these from a real
              client.
            </p>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-ink-100 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3">Path</th>
                  <th className="px-5 py-3">Auth</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3 text-right">Expand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {ENDPOINTS.map((ep) => {
                  const isOpen = open === ep.path;
                  return [
                    <tr
                      key={ep.path}
                      onClick={() => toggle(ep.path)}
                      className={`cursor-pointer transition ${isOpen ? "bg-navy-50/60" : "hover:bg-ink-50"}`}
                    >
                      <td className="px-5 py-3.5">
                        <span
                          className={`num inline-block w-16 rounded-md border px-2 py-1 text-center text-[11px] font-extrabold tracking-wide ${METHOD_STYLES[ep.method]}`}
                        >
                          {ep.method}
                        </span>
                      </td>
                      <td className="num px-5 py-3.5 font-mono text-[13px] font-bold text-navy-800">
                        {ep.path}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500">
                          {ep.authType === "bearer" ? (
                            <Lock size={13} className="text-gold-600" />
                          ) : (
                            <Globe size={13} className="text-emerald-600" />
                          )}
                          {ep.auth}
                        </span>
                      </td>
                      <td className="max-w-md px-5 py-3.5 text-[13px] text-ink-500">
                        {ep.description}
                        <span className="mt-0.5 block text-[11px] font-semibold text-ink-400">
                          Errors: <span className="num">{ep.errors}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <ChevronDown
                          size={16}
                          className={`ml-auto text-ink-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${ep.path}-schema`}>
                        <td colSpan={5} className="bg-navy-50/40 px-5 py-5">
                          <div className="grid gap-6 lg:grid-cols-2">
                            <div>
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                                Request
                              </p>
                              {ep.request ? (
                                <SchemaTable rows={ep.request} />
                              ) : (
                                <p className="text-[13px] text-ink-500">
                                  No request body — simple GET probe.
                                </p>
                              )}
                            </div>
                            <div>
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                                Response — <span className="num">200</span>
                              </p>
                              <SchemaTable rows={ep.response} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
