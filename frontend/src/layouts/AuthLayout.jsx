import { Outlet } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ShieldCheck, Lock, UserCheck } from "lucide-react";
import Logo from "../components/Logo";

const HIGHLIGHTS = [
  {
    icon: ShieldCheck,
    title: "Security first",
    text: "Short-lived access tokens, rotating refresh tokens and hashed credentials on every request.",
  },
  {
    icon: UserCheck,
    title: "Verified identity",
    text: "Encrypted document checks and an in-house review process keep every account accountable.",
  },
  {
    icon: Lock,
    title: "You stay in control",
    text: "Change your password at any time — other sessions are signed out automatically.",
  },
];

export default function AuthLayout() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden flex-col justify-between bg-navy-900 px-12 py-10 text-white lg:flex">
        <div>
          <Logo light />
        </div>

        <motion.div
          className="max-w-md"
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <p className="eyebrow text-gold-400">Digital banking platform</p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.1] text-white">
            Clear accounts.
            <br />
            Confident decisions.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-100/80">
            Register, verify your identity and manage your profile from one secure
            dashboard built on a service-oriented banking backend.
          </p>

          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-gold-400">
                  <Icon size={17} strokeWidth={2} />
                </span>
                <div>
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-navy-100/70">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </motion.div>

        <p className="text-xs text-navy-100/50">
          Meridian Bank demo environment · For evaluation purposes
        </p>
      </aside>

      <main className="flex min-h-screen flex-col bg-white">
        <div className="flex items-center justify-between px-6 pt-6 lg:px-14">
          <div className="lg:hidden">
            <Logo />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10 lg:px-14">
          <motion.div
            className="w-full max-w-[440px]"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </div>

        <p className="px-6 pb-6 text-center text-xs text-ink-400 lg:px-14">
          Protected by encrypted transport · Never share your one-time codes
        </p>
      </main>
    </div>
  );
}
