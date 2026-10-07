import { Outlet } from "react-router-dom";
import { ShieldCheck, Lock, Landmark } from "lucide-react";
import Logo from "../components/Logo";

const HIGHLIGHTS = [
  {
    icon: ShieldCheck,
    title: "Bank-grade security",
    text: "TLS encryption, hashed credentials and short-lived sessions on every request.",
  },
  {
    icon: Landmark,
    title: "Insured deposits",
    text: "Your balance is protected up to $250,000 per depositor, per institution.",
  },
  {
    icon: Lock,
    title: "You stay in control",
    text: "Freeze cards, set limits and review every login from your dashboard.",
  },
];

export default function AuthLayout() {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 px-12 py-10 text-white lg:flex">
        <div className="brand-texture absolute inset-0 opacity-70" />
        <div
          className="absolute -right-40 -top-40 h-96 w-96 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(201,162,39,.18), transparent 65%)" }}
        />

        <div className="relative">
          <Logo light />
        </div>

        <div className="relative max-w-md">
          <p className="eyebrow text-gold-400">Digital banking, done properly</p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.1] text-white">
            Your money deserves
            <br />
            a calmer interface.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-100/80">
            Open an account in minutes, verify your identity securely and move money
            with confidence — all from one dashboard.
          </p>

          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold-400/30 bg-gold-400/10 text-gold-400">
                  <Icon size={17} strokeWidth={2} />
                </span>
                <div>
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-navy-100/70">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-navy-100/50">
          © 2026 Meridian Bank · Member FDIC · Equal Housing Lender
        </p>
      </aside>

      <main className="flex min-h-screen flex-col bg-white">
        <div className="flex items-center justify-between px-6 pt-6 lg:px-14">
          <div className="lg:hidden">
            <Logo />
          </div>
          <p className="ml-auto hidden text-[13px] text-ink-400 lg:block">
            Need help?{" "}
            <a href="tel:+18005550199" className="link">
              1-800-555-0199
            </a>
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10 lg:px-14">
          <div className="w-full max-w-[440px]">
            <Outlet />
          </div>
        </div>

        <p className="px-6 pb-6 text-center text-xs text-ink-400 lg:px-14">
          Protected by 256-bit encryption · Never share your one-time codes
        </p>
      </main>
    </div>
  );
}
