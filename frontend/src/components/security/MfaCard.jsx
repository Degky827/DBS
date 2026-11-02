import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ShieldCheck, ShieldOff } from "lucide-react";
import Modal from "../ui/Modal";
import Alert from "../ui/Alert";
import { Skeleton, Spinner } from "../ui/Spinner";
import {
  beginMfaSetup,
  confirmMfaSetup,
  disableMfa,
  getMfaStatus,
} from "../../services/authService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDateTime } from "../../utils/format";

const EMPTY_DISABLE = { password: "", mode: "code", value: "" };

export default function MfaCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupCode, setSetupCode] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupSubmitting, setSetupSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableForm, setDisableForm] = useState(EMPTY_DISABLE);
  const [disableError, setDisableError] = useState("");
  const [disableSubmitting, setDisableSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await getMfaStatus());
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getMfaStatus();
        if (active) setStatus(data);
      } catch (requestError) {
        if (active) setError(normalizeApiError(requestError).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      setCopied("");
    }
  };

  const openSetup = async () => {
    setSetupOpen(true);
    setSetup(null);
    setRecoveryCodes(null);
    setSetupCode("");
    setSetupError("");
    setSetupLoading(true);
    try {
      setSetup(await beginMfaSetup());
    } catch (requestError) {
      setSetupError(normalizeApiError(requestError).message);
    } finally {
      setSetupLoading(false);
    }
  };

  const closeSetup = () => {
    if (setupSubmitting) return;
    setSetupOpen(false);
    setSetup(null);
    setRecoveryCodes(null);
    setSetupCode("");
    setSetupError("");
  };

  const confirmSetup = async (event) => {
    event.preventDefault();
    if (setupSubmitting) return;
    if (!/^\d{6}$/.test(setupCode.trim())) {
      setSetupError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setSetupSubmitting(true);
    setSetupError("");
    try {
      const result = await confirmMfaSetup(setupCode.trim());
      setRecoveryCodes(result.recoveryCodes);
      setNotice("Multi-factor authentication is now enabled.");
      await loadStatus();
    } catch (requestError) {
      setSetupError(normalizeApiError(requestError).message);
    } finally {
      setSetupSubmitting(false);
    }
  };

  const openDisable = () => {
    setDisableForm(EMPTY_DISABLE);
    setDisableError("");
    setDisableOpen(true);
  };

  const closeDisable = () => {
    if (disableSubmitting) return;
    setDisableOpen(false);
  };

  const submitDisable = async (event) => {
    event.preventDefault();
    if (disableSubmitting) return;

    if (!disableForm.password) {
      setDisableError("Enter your current password.");
      return;
    }
    const value = disableForm.value.trim();
    if (disableForm.mode === "code" && !/^\d{6}$/.test(value)) {
      setDisableError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    if (disableForm.mode === "recovery" && value.length < 6) {
      setDisableError("Enter one of your saved recovery codes.");
      return;
    }

    setDisableSubmitting(true);
    setDisableError("");
    try {
      await disableMfa({
        password: disableForm.password,
        ...(disableForm.mode === "recovery"
          ? { recoveryCode: value }
          : { code: value }),
      });
      setDisableOpen(false);
      setNotice("Multi-factor authentication has been disabled.");
      await loadStatus();
    } catch (requestError) {
      setDisableError(normalizeApiError(requestError).message);
    } finally {
      setDisableSubmitting(false);
    }
  };

  return (
    <section className="card">
      <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
        <ShieldCheck size={16} className="text-brand-700" />
        <h2 className="text-[14px] font-extrabold text-midnight">
          Multi-factor authentication
        </h2>
      </div>

      <div className="space-y-4 px-5 py-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] leading-relaxed text-muted">{error}</p>
            <button type="button" className="btn-ghost py-2" onClick={loadStatus}>
              Retry
            </button>
          </div>
        ) : status?.enabled ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-bold text-midnight">
                  Authenticator app
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                  A one-time code is required after your password. Recovery codes
                  remaining: <span className="font-semibold">{status.recoveryCodesRemaining}</span>
                  {status.enrolledAt ? ` · enrolled ${formatDateTime(status.enrolledAt)}` : ""}.
                </p>
              </div>
              <span className="badge-success">Enabled</span>
            </div>
            <button type="button" className="btn-danger-outline py-2" onClick={openDisable}>
              <ShieldOff size={14} /> Disable MFA
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-bold text-midnight">Not enabled</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                  Add a second factor so a stolen password is not enough to sign in
                  or approve sensitive transactions.
                </p>
              </div>
              <span className="badge-warning">Off</span>
            </div>
            <button type="button" className="btn-primary py-2" onClick={openSetup}>
              <ShieldCheck size={14} /> Set up MFA
            </button>
          </>
        )}

        {notice ? (
          <p className="text-[12px] font-semibold text-emerald-700" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <Modal
        open={setupOpen}
        onClose={closeSetup}
        title={recoveryCodes ? "Save your recovery codes" : "Set up an authenticator"}
        description={
          recoveryCodes
            ? "Each code can be used once if you lose access to your authenticator."
            : "Scan or enter the secret in your authenticator app, then confirm the current code."
        }
      >
        {setupLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] font-semibold text-ink-500">
            <Spinner size={16} className="text-brand-600" /> Preparing setup…
          </div>
        ) : recoveryCodes ? (
          <div className="space-y-4">
            <Alert tone="success">
              Multi-factor authentication is enabled. These codes are shown once.
            </Alert>
            <div className="grid grid-cols-2 gap-2">
              {recoveryCodes.map((code) => (
                <code
                  key={code}
                  className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-center font-mono text-[12.5px] font-semibold text-midnight"
                >
                  {code}
                </code>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-ink-100 pt-4">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => copy(recoveryCodes.join("\n"), "codes")}
              >
                {copied === "codes" ? <Check size={14} /> : <Copy size={14} />}
                {copied === "codes" ? "Copied" : "Copy codes"}
              </button>
              <button type="button" className="btn-primary" onClick={closeSetup}>
                I saved them
              </button>
            </div>
          </div>
        ) : setup ? (
          <form onSubmit={confirmSetup} className="space-y-4" noValidate>
            <Alert tone="error">{setupError}</Alert>
            <div className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Manual setup key
              </p>
              <p className="mt-1 break-all font-mono text-[13px] font-semibold text-midnight">
                {setup.secret}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px]">
                <button
                  type="button"
                  className="link inline-flex items-center gap-1"
                  onClick={() => copy(setup.secret, "secret")}
                >
                  {copied === "secret" ? <Check size={12} /> : <Copy size={12} />}
                  {copied === "secret" ? "Copied" : "Copy key"}
                </button>
                <button
                  type="button"
                  className="link inline-flex items-center gap-1"
                  onClick={() => copy(setup.otpauthUri, "uri")}
                >
                  {copied === "uri" ? <Check size={12} /> : <Copy size={12} />}
                  {copied === "uri" ? "Copied" : "Copy setup link"}
                </button>
              </div>
            </div>
            <p className="text-[12px] leading-relaxed text-muted">
              Add the key to your authenticator app as a time-based (TOTP) account for{" "}
              {setup.issuer || "Meridian Bank"}. Then enter the six-digit code it shows.
            </p>
            <div>
              <label htmlFor="mfa-setup-code" className="field-label">
                Authenticator code
              </label>
              <input
                id="mfa-setup-code"
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                className="field-input tracking-[0.3em]"
                placeholder="000000"
                value={setupCode}
                onChange={(event) => {
                  setSetupCode(event.target.value);
                  if (setupError) setSetupError("");
                }}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-ink-100 pt-4">
              <button
                type="button"
                className="btn-ghost"
                onClick={closeSetup}
                disabled={setupSubmitting}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={setupSubmitting}>
                {setupSubmitting ? (
                  <>
                    <Spinner size={15} /> Confirming…
                  </>
                ) : (
                  "Enable MFA"
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <Alert tone="error">{setupError}</Alert>
            <div className="flex justify-end">
              <button type="button" className="btn-ghost" onClick={closeSetup}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={disableOpen}
        onClose={closeDisable}
        title="Disable multi-factor authentication"
        description="Confirm your password and a current factor. Your other sessions stay signed in."
        size="sm"
      >
        <form onSubmit={submitDisable} className="space-y-4" noValidate>
          <Alert tone="error">{disableError}</Alert>
          <div>
            <label htmlFor="mfa-disable-password" className="field-label">
              Current password
            </label>
            <input
              id="mfa-disable-password"
              type="password"
              autoComplete="current-password"
              className="field-input"
              value={disableForm.password}
              onChange={(event) =>
                setDisableForm((current) => ({ ...current, password: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="mfa-disable-code" className="field-label">
              {disableForm.mode === "code" ? "Authenticator code" : "Recovery code"}
            </label>
            <input
              id="mfa-disable-code"
              autoComplete="one-time-code"
              inputMode={disableForm.mode === "code" ? "numeric" : "text"}
              maxLength={disableForm.mode === "code" ? 6 : 32}
              className="field-input tracking-[0.3em]"
              placeholder={disableForm.mode === "code" ? "000000" : "XXXXX-XXXXX"}
              value={disableForm.value}
              onChange={(event) =>
                setDisableForm((current) => ({ ...current, value: event.target.value }))
              }
            />
          </div>
          <button
            type="button"
            className="link text-[12.5px]"
            onClick={() =>
              setDisableForm((current) => ({
                ...current,
                mode: current.mode === "code" ? "recovery" : "code",
                value: "",
              }))
            }
          >
            {disableForm.mode === "code"
              ? "Use a recovery code instead"
              : "Use an authenticator code instead"}
          </button>
          <div className="flex flex-wrap justify-end gap-3 border-t border-ink-100 pt-4">
            <button
              type="button"
              className="btn-ghost"
              onClick={closeDisable}
              disabled={disableSubmitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn-danger" disabled={disableSubmitting}>
              {disableSubmitting ? (
                <>
                  <Spinner size={15} /> Disabling…
                </>
              ) : (
                "Disable MFA"
              )}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
