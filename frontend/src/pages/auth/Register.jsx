import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, User, AtSign, ShieldCheck } from "lucide-react";
import PasswordStrength from "../../components/PasswordStrength";
import { scorePassword } from "../../utils/passwordScore";
import { registerUser } from "../../services/authService";
import { normalizeApiError } from "../../utils/apiError";
import Alert from "../../components/ui/Alert";
import { Spinner } from "../../components/ui/Spinner";

const STEPS = [
  { key: "personal", label: "Personal", icon: User },
  { key: "account", label: "Account", icon: AtSign },
  { key: "security", label: "Security", icon: ShieldCheck },
  { key: "review", label: "Review", icon: Check },
];

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const QUESTIONS = [
  "What was the name of your first school?",
  "What city were you born in?",
  "What was your childhood nickname?",
  "What is your mother's maiden name?",
  "What was the make of your first car?",
];

const INITIAL = {
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  phoneNumber: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  securityQuestion: "",
  securityAnswer: "",
  acceptedTerms: false,
};

const NAME_RE = /^[A-Za-zÀ-ÿ' -]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;

export default function Register() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  const update = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  const validateStep = (index) => {
    const e = {};
    const f = form;

    if (index === 0) {
      if (!f.firstName.trim() || f.firstName.trim().length < 2 || !NAME_RE.test(f.firstName.trim()))
        e.firstName = "Enter a valid first name (2+ letters)";
      if (!f.lastName.trim() || f.lastName.trim().length < 2 || !NAME_RE.test(f.lastName.trim()))
        e.lastName = "Enter a valid last name (2+ letters)";
      if (!f.dateOfBirth) e.dateOfBirth = "Date of birth is required";
      else {
        const dob = new Date(f.dateOfBirth);
        const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (dob.getTime() > Date.now()) e.dateOfBirth = "Date of birth must be in the past";
        else if (age < 18) e.dateOfBirth = "You must be at least 18 years old";
      }
      if (!f.gender) e.gender = "Select an option";
      if (!PHONE_RE.test(f.phoneNumber.trim())) e.phoneNumber = "Enter 7-15 digits, optionally starting with +";
    }

    if (index === 1) {
      if (!USERNAME_RE.test(f.username.trim()))
        e.username = "3-30 characters: letters, numbers and underscores only";
      if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Enter a valid email address";
      if (scorePassword(f.password) < 1)
        e.password = "Use 8+ characters with uppercase, lowercase and a number";
      if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords do not match";
    }

    if (index === 2) {
      if (!f.securityQuestion) e.securityQuestion = "Choose a security question";
      if (f.securityAnswer.trim().length < 2) e.securityAnswer = "Answer is required";
      if (!f.acceptedTerms) e.acceptedTerms = "You must accept the Terms & Conditions";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError("");
    setSubmitting(true);

    try {
      await registerUser(form);
      navigate("/verify-email", {
        replace: true,
        state: { email: form.email },
      });
    } catch (err) {
      const { message, fields } = normalizeApiError(err);
      setServerError(message);
      if (Object.keys(fields).length) {
        setErrors(fields);
        if (fields.email || fields.username) setStep(1);
        else if (fields.firstName || fields.lastName || fields.dateOfBirth || fields.gender || fields.phoneNumber)
          setStep(0);
        else if (fields.securityQuestion || fields.securityAnswer || fields.acceptedTerms) setStep(2);
      }
      setSubmitting(false);
    }
  };

  const review = useMemo(
    () => [
      ["Name", [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ")],
      ["Date of birth", form.dateOfBirth],
      ["Gender", GENDERS.find((g) => g.value === form.gender)?.label ?? ""],
      ["Phone", form.phoneNumber],
      ["Username", form.username],
      ["Email", form.email],
      ["Security question", form.securityQuestion],
    ],
    [form]
  );

  const stepMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, x: 16 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -12 },
        transition: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] },
      };

  return (
    <div>
      <p className="eyebrow">Open an account</p>
      <h1 className="mt-2 text-3xl font-extrabold">Create your profile</h1>
      <p className="mt-2 text-[15px] text-ink-500">Four short steps — about two minutes.</p>

      <ol className="mt-7 flex items-center">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition ${
                    done
                      ? "border-navy-800 bg-navy-800 text-white"
                      : active
                        ? "border-navy-800 bg-white text-navy-800 ring-4 ring-navy-500/10"
                        : "border-ink-200 bg-white text-ink-400"
                  }`}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    active ? "text-navy-800" : "text-ink-400"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span className={`mx-2 mb-5 h-px flex-1 ${i < step ? "bg-navy-800" : "bg-ink-200"}`} />
              )}
            </li>
          );
        })}
      </ol>

      <Alert tone="error" className="mt-5">
        {serverError}
      </Alert>

      <form onSubmit={handleSubmit} noValidate className="mt-7">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} {...stepMotion}>
            {step === 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="field-label" htmlFor="firstName">First name</label>
                    <input id="firstName" className="field-input" value={form.firstName} onChange={update("firstName")} placeholder="Ada" aria-invalid={errors.firstName ? "true" : undefined} />
                    {errors.firstName && <p className="field-error">{errors.firstName}</p>}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="middleName">Middle name <span className="normal-case tracking-normal text-ink-400">(optional)</span></label>
                    <input id="middleName" className="field-input" value={form.middleName} onChange={update("middleName")} placeholder="Byron" />
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="lastName">Last name</label>
                  <input id="lastName" className="field-input" value={form.lastName} onChange={update("lastName")} placeholder="Lovelace" aria-invalid={errors.lastName ? "true" : undefined} />
                  {errors.lastName && <p className="field-error">{errors.lastName}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="field-label" htmlFor="dateOfBirth">Date of birth</label>
                    <input id="dateOfBirth" type="date" className="field-input" value={form.dateOfBirth} onChange={update("dateOfBirth")} aria-invalid={errors.dateOfBirth ? "true" : undefined} />
                    {errors.dateOfBirth && <p className="field-error">{errors.dateOfBirth}</p>}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="gender">Gender</label>
                    <select id="gender" className="field-input" value={form.gender} onChange={update("gender")} aria-invalid={errors.gender ? "true" : undefined}>
                      <option value="">Select…</option>
                      {GENDERS.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                    {errors.gender && <p className="field-error">{errors.gender}</p>}
                  </div>
                </div>

                <div>
                  <label className="field-label" htmlFor="phoneNumber">Phone number</label>
                  <input id="phoneNumber" className="field-input" value={form.phoneNumber} onChange={update("phoneNumber")} placeholder="+1 555 123 4567" aria-invalid={errors.phoneNumber ? "true" : undefined} />
                  {errors.phoneNumber && <p className="field-error">{errors.phoneNumber}</p>}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="field-label" htmlFor="username">Username</label>
                  <input id="username" className="field-input" value={form.username} onChange={update("username")} placeholder="ada_lovelace" autoComplete="username" aria-invalid={errors.username ? "true" : undefined} />
                  {errors.username && <p className="field-error">{errors.username}</p>}
                </div>

                <div>
                  <label className="field-label" htmlFor="email">Email address</label>
                  <input id="email" type="email" className="field-input" value={form.email} onChange={update("email")} placeholder="you@example.com" autoComplete="email" aria-invalid={errors.email ? "true" : undefined} />
                  {errors.email && <p className="field-error">{errors.email}</p>}
                </div>

                <div>
                  <label className="field-label" htmlFor="password">Password</label>
                  <input id="password" type="password" className="field-input" value={form.password} onChange={update("password")} placeholder="••••••••" autoComplete="new-password" aria-invalid={errors.password ? "true" : undefined} />
                  <PasswordStrength password={form.password} />
                  {errors.password && <p className="field-error">{errors.password}</p>}
                </div>

                <div>
                  <label className="field-label" htmlFor="confirmPassword">Confirm password</label>
                  <input id="confirmPassword" type="password" className="field-input" value={form.confirmPassword} onChange={update("confirmPassword")} placeholder="••••••••" autoComplete="new-password" aria-invalid={errors.confirmPassword ? "true" : undefined} />
                  {errors.confirmPassword && <p className="field-error">{errors.confirmPassword}</p>}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="field-label" htmlFor="securityQuestion">Security question</label>
                  <select id="securityQuestion" className="field-input" value={form.securityQuestion} onChange={update("securityQuestion")} aria-invalid={errors.securityQuestion ? "true" : undefined}>
                    <option value="">Choose a question…</option>
                    {QUESTIONS.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                  {errors.securityQuestion && <p className="field-error">{errors.securityQuestion}</p>}
                </div>

                <div>
                  <label className="field-label" htmlFor="securityAnswer">Security answer</label>
                  <input id="securityAnswer" className="field-input" value={form.securityAnswer} onChange={update("securityAnswer")} placeholder="Your answer" autoComplete="off" aria-invalid={errors.securityAnswer ? "true" : undefined} />
                  <p className="mt-1.5 text-xs text-ink-400">Stored hashed — used only to recover your account.</p>
                  {errors.securityAnswer && <p className="field-error">{errors.securityAnswer}</p>}
                </div>

                <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
                  <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed text-ink-500">
                    <input
                      type="checkbox"
                      checked={form.acceptedTerms}
                      onChange={update("acceptedTerms")}
                      className="mt-0.5 h-4 w-4 rounded border-ink-200 accent-navy-700"
                    />
                    <span>
                      I agree to the{" "}
                      <span className="font-semibold text-navy-600">Terms & Conditions</span> and{" "}
                      <span className="font-semibold text-navy-600">Privacy Policy</span>, and I
                      confirm the information provided is accurate.
                    </span>
                  </label>
                  {errors.acceptedTerms && <p className="field-error">{errors.acceptedTerms}</p>}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="card divide-y divide-ink-100 overflow-hidden">
                  {review.map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3">
                      <span className="text-[13px] font-medium text-ink-400">{label}</span>
                      <span className="text-right text-sm font-semibold text-navy-900">{value || "—"}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-[13px] leading-relaxed text-navy-700">
                  Next we will email you a 6-digit code. You must confirm it before
                  signing in. Identity verification can be completed from your
                  dashboard afterwards.
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-7 flex items-center gap-3">
          {step > 0 && (
            <button type="button" onClick={back} className="btn-ghost" disabled={submitting}>
              <ArrowLeft size={16} /> Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={next} className="btn-primary flex-1">
              Continue <ArrowRight size={17} />
            </button>
          ) : (
            <button type="submit" className="btn-primary flex-1" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner size={17} /> Creating account…
                </>
              ) : (
                <>
                  Create account <Check size={17} />
                </>
              )}
            </button>
          )}
        </div>
      </form>

      <p className="mt-7 text-center text-sm text-ink-500">
        Already have an account?{" "}
        <Link to="/" className="link">Sign in</Link>
      </p>
    </div>
  );
}
