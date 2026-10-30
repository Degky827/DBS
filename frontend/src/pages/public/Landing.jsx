import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeftRight,
  BadgeCheck,
  Check,
  ChevronDown,
  CreditCard,
  FileCheck2,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Wallet,
} from "lucide-react";
import MarketingHeader from "../../components/marketing/MarketingHeader";
import MarketingFooter from "../../components/marketing/MarketingFooter";
import HeroIllustration from "../../components/marketing/HeroIllustration";

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Secure Account Management",
    text: "Register with verified email, strong-password checks and session controls that sign out other devices when your credentials change.",
  },
  {
    icon: BadgeCheck,
    title: "Identity Verification (KYC)",
    text: "Upload an identity document, review the extracted details and complete a face and liveness check before an officer records the decision.",
  },
  {
    icon: Wallet,
    title: "Digital Wallet",
    text: "Open a wallet backed by a double-entry ledger, with every balance and posting recorded in one place.",
  },
  {
    icon: ArrowLeftRight,
    title: "Money Transfers",
    text: "Send same-currency transfers to another Meridian wallet. Idempotency keys stop a retry from debiting your account twice.",
  },
  {
    icon: CreditCard,
    title: "Payment Processing",
    text: "Start a deposit through the configured payment provider in test mode and confirm its status from the same dashboard.",
  },
  {
    icon: ListChecks,
    title: "Transaction Tracking",
    text: "Filter your ledger history by date and direction, with cursor-based paging for longer records.",
  },
];

const CONTROLS = [
  {
    icon: Lock,
    title: "Short-lived access tokens",
    text: "Fifteen-minute access tokens live in memory and are never written to browser storage.",
  },
  {
    icon: RefreshCw,
    title: "Rotating refresh tokens",
    text: "Refresh tokens stay in HttpOnly cookies, rotate on every use and are revoked when reused.",
  },
  {
    icon: KeyRound,
    title: "Hashed credentials",
    text: "Passwords and one-time codes are bcrypt-hashed before they are stored.",
  },
  {
    icon: MailCheck,
    title: "One-time email codes",
    text: "Email verification and password recovery both require a single-use code delivered to your inbox.",
  },
  {
    icon: FileCheck2,
    title: "Encrypted identity documents",
    text: "KYC files are encrypted at rest and served only through authenticated endpoints.",
  },
  {
    icon: Gauge,
    title: "Rate-limited endpoints",
    text: "Sign-in, verification and recovery are guarded by layered request limits.",
  },
];

const STEPS = [
  {
    icon: UserPlus,
    title: "Create your profile",
    text: "Add your personal details, pick a username and set a password with live strength feedback. Accept the terms and submit.",
  },
  {
    icon: BadgeCheck,
    title: "Verify email and identity",
    text: "Confirm the one-time code sent to your inbox, then upload an identity document and finish the face and liveness check.",
  },
  {
    icon: LayoutDashboard,
    title: "Bank with clarity",
    text: "Fund your wallet, transfer to another wallet and follow every entry in a ledger-backed transaction history.",
  },
];

const FAQS = [
  {
    question: "Is Meridian a real bank?",
    answer:
      "No. Meridian is an evaluation build of a digital banking platform. Accounts, wallets and payments run in a demo environment, no real money is held or moved, and external payments work only when the payment provider is configured in test mode.",
  },
  {
    question: "What do I need to create an account?",
    answer:
      "A valid email address, your name and date of birth, a phone number, a username, and a password that meets the strength requirements. You must be at least 18 years old and accept the terms.",
  },
  {
    question: "How does identity verification work?",
    answer:
      "You upload an identity document and review the details extracted from it, then complete a face and liveness check with the configured provider. A compliance officer records the final decision.",
  },
  {
    question: "What happens if I forget my password?",
    answer:
      "Request a one-time code by email, enter it with a new password, and every active session is signed out. The code expires after ten minutes.",
  },
  {
    question: "How is my information protected?",
    answer:
      "Access tokens expire after fifteen minutes, refresh tokens rotate inside HttpOnly cookies, sensitive endpoints are rate limited, and identity documents are encrypted at rest.",
  },
];

function SectionHeading({ eyebrow, title, text, center = false }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-extrabold leading-tight text-midnight sm:text-4xl">
        {title}
      </h2>
      {text && <p className="mt-4 text-[15px] leading-relaxed text-muted">{text}</p>}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-body">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-midnight focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <MarketingHeader />

      <main id="main">
        <section id="home" className="relative scroll-mt-20 overflow-hidden bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3.5 py-1.5 text-[12px] font-semibold text-brand-700">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
                Digital banking, made clear
              </p>

              <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-midnight sm:text-5xl lg:text-[56px]">
                Banking that feels clear from the first click.
              </h1>

              <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-muted">
                Open an account, verify your identity and manage your wallet from one
                secure place. Every screen connects to a working service — no mock data
                and no fake success states.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/register" className="btn-brand">
                  Get started <ArrowRight size={17} />
                </Link>
                <Link to="/login" className="btn-brand-outline">
                  Sign in to your account
                </Link>
              </div>

              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-[13px] font-medium text-muted">
                {["Email verification", "Encrypted KYC documents", "Ledger-backed balances"].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-2">
                      <Check size={15} className="text-success" strokeWidth={2.5} />
                      {item}
                    </li>
                  )
                )}
              </ul>
            </div>

            <div className="mx-auto w-full max-w-[560px]">
              <HeroIllustration />
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 bg-canvas">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <SectionHeading
              eyebrow="Features"
              title="Everything an account needs, in one place"
              text="Six connected capabilities cover the path from registration to a recorded transaction — each one built into the platform you are signing in to."
              center
            />

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <article
                  key={title}
                  className="group rounded-2xl border border-ink-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,43,70,.04),0_18px_40px_-30px_rgba(16,43,70,.35)] transition hover:border-brand-200"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-100">
                    <Icon size={21} strokeWidth={2} />
                  </span>
                  <h3 className="mt-5 text-[17px] font-extrabold text-midnight">{title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="scroll-mt-20 bg-midnight text-white">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-300">
                  Security and trust
                </p>
                <h2 className="mt-3 text-3xl font-extrabold leading-tight text-white sm:text-4xl">
                  Built to protect every session, not just the password.
                </h2>
                <p className="mt-4 text-[15px] leading-relaxed text-brand-100/75">
                  These are controls running in the current build. Requests are
                  origin-checked, responses are covered by a strict content security
                  policy, and privileged KYC reviews are limited to officer roles.
                </p>

                <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
                  <p className="flex items-center gap-2 text-sm font-bold text-white">
                    <ShieldCheck size={17} className="text-brand-300" />
                    Your part stays simple
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-brand-100/70">
                    Use a unique password, keep your one-time codes private and request a
                    new code if yours expires. The platform handles token rotation and
                    session revocation.
                  </p>
                </div>
              </div>

              <ul className="grid gap-4 sm:grid-cols-2">
                {CONTROLS.map(({ icon: Icon, title, text }) => (
                  <li
                    key={title}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                  >
                    <Icon size={20} className="text-brand-300" strokeWidth={2} />
                    <h3 className="mt-4 text-sm font-bold text-white">{title}</h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-brand-100/70">
                      {text}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <SectionHeading
              eyebrow="How it works"
              title="Three steps from sign-up to your first transfer"
              text="No branch visit and no paperwork queue. Verification happens inside the same flow you use every day."
              center
            />

            <div className="relative mt-12 grid gap-5 lg:grid-cols-3">
              <div
                className="pointer-events-none absolute left-[16%] right-[16%] top-11 hidden border-t border-dashed border-ink-200 lg:block"
                aria-hidden="true"
              />
              {STEPS.map(({ icon: Icon, title, text }, index) => (
                <article
                  key={title}
                  className="relative rounded-2xl border border-ink-200 bg-white p-6"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[0_1px_2px_rgba(16,43,70,.18)]">
                      <Icon size={20} strokeWidth={2} />
                    </span>
                    <span className="num text-[12px] font-bold tracking-[0.18em] text-ink-300">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 text-[17px] font-extrabold text-midnight">{title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 bg-canvas">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
              <SectionHeading
                eyebrow="FAQ"
                title="Questions people ask before signing up"
                text="If something is still unclear, start with account recovery or create an account and explore the demo environment."
              />

              <div className="divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white px-5">
                {FAQS.map(({ question, answer }) => (
                  <details key={question} className="group py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-bold text-midnight [&::-webkit-details-marker]:hidden">
                      {question}
                      <ChevronDown
                        size={17}
                        className="shrink-0 text-ink-400 transition group-open:rotate-180"
                      />
                    </summary>
                    <p className="mt-3 pr-6 text-[13.5px] leading-relaxed text-muted">{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="scroll-mt-20 bg-white">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="overflow-hidden rounded-3xl bg-brand-600 px-6 py-12 text-white sm:px-12 lg:px-16 lg:py-16">
              <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-100">
                    About Meridian
                  </p>
                  <h2 className="mt-3 text-3xl font-extrabold leading-tight text-white sm:text-4xl">
                    A transparent look at digital banking, end to end.
                  </h2>
                  <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-brand-100/85">
                    Meridian is a full-stack evaluation platform: a React client backed by
                    dedicated authentication, user and KYC services, PostgreSQL and a
                    double-entry ledger. The public experience you are reading is the same
                    one that talks to those services.
                  </p>

                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                      to="/register"
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-midnight shadow-[0_1px_2px_rgba(16,43,70,.2)] transition hover:bg-brand-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
                    >
                      Create an account <ArrowRight size={17} />
                    </Link>
                    <Link
                      to="/login"
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/40 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
                    >
                      Sign in
                    </Link>
                  </div>
                </div>

                <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  {[
                    ["3", "independent backend services"],
                    ["2", "ledger entries per transfer"],
                    ["1", "dashboard for every step"],
                  ].map(([value, label]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-white/15 bg-white/[0.08] px-5 py-4"
                    >
                      <dt className="num text-2xl font-extrabold text-white">{value}</dt>
                      <dd className="mt-1 text-[12.5px] font-medium text-brand-100/80">
                        {label}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
