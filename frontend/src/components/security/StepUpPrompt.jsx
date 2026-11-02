import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import Modal from "../ui/Modal";
import Alert from "../ui/Alert";
import { Spinner } from "../ui/Spinner";
import { registerStepUpHandler } from "../../services/stepUp";
import { stepUpMfa } from "../../services/authService";
import { normalizeApiError } from "../../utils/apiError";

const EMPTY = { mode: "code", value: "", error: "", submitting: false };

export default function StepUpPrompt() {
  const resolver = useRef(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    registerStepUpHandler(
      () =>
        new Promise((resolve, reject) => {
          resolver.current = { resolve, reject };
          setState(EMPTY);
          setOpen(true);
        })
    );
    return () => registerStepUpHandler(null);
  }, []);

  const finish = useCallback((action, payload) => {
    const current = resolver.current;
    resolver.current = null;
    setOpen(false);
    if (current) current[action](payload);
  }, []);

  const cancel = useCallback(() => {
    if (state.submitting) return;
    finish("reject", new Error("Step-up verification cancelled"));
  }, [finish, state.submitting]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (state.submitting) return;

    const value = state.value.trim();
    if (state.mode === "code" && !/^\d{6}$/.test(value)) {
      setState((current) => ({
        ...current,
        error: "Enter the 6-digit code from your authenticator app.",
      }));
      return;
    }
    if (state.mode === "recovery" && value.length < 6) {
      setState((current) => ({
        ...current,
        error: "Enter one of your saved recovery codes.",
      }));
      return;
    }

    setState((current) => ({ ...current, submitting: true, error: "" }));
    try {
      const result = await stepUpMfa(
        state.mode === "recovery"
          ? { recoveryCode: value }
          : { code: value }
      );
      finish("resolve", result.accessToken);
    } catch (error) {
      setState((current) => ({
        ...current,
        submitting: false,
        error: normalizeApiError(error).message,
      }));
    }
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
      title="Confirm it's you"
      description="This action needs a fresh second-factor check before it can continue."
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-brand-800">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand-700" />
          <p>Your verification is valid for a short window and only unlocks this action.</p>
        </div>

        <Alert tone="error">{state.error}</Alert>

        <div>
          <label htmlFor="step-up-code" className="field-label">
            {state.mode === "code" ? "Authenticator code" : "Recovery code"}
          </label>
          <input
            id="step-up-code"
            autoComplete="one-time-code"
            inputMode={state.mode === "code" ? "numeric" : "text"}
            maxLength={state.mode === "code" ? 6 : 32}
            className="field-input tracking-[0.3em]"
            placeholder={state.mode === "code" ? "000000" : "XXXXX-XXXXX"}
            value={state.value}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                value: event.target.value,
                error: "",
              }))
            }
            aria-invalid={state.error ? "true" : undefined}
          />
        </div>

        <button
          type="button"
          className="link text-[12.5px]"
          onClick={() =>
            setState((current) => ({
              ...current,
              mode: current.mode === "code" ? "recovery" : "code",
              value: "",
              error: "",
            }))
          }
        >
          {state.mode === "code"
            ? "Use a recovery code instead"
            : "Use an authenticator code instead"}
        </button>

        <div className="flex flex-wrap justify-end gap-3 border-t border-ink-100 pt-4">
          <button
            type="button"
            className="btn-ghost"
            onClick={cancel}
            disabled={state.submitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={state.submitting}>
            {state.submitting ? (
              <>
                <Spinner size={15} /> Verifying…
              </>
            ) : (
              "Verify and continue"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
