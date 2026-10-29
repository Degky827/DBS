import { Link, Outlet } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ShieldCheck, Lock, UserCheck, ArrowLeft } from "lucide-react";
import Logo from "../components/Logo";

const HIGHLIGHTS = [
  {
    icon: ShieldCheck,
    title: "Security first",
    text: "Fifteen-minute access tokens, rotating refresh tokens and hashed credentials on every request.",
  },
  {
    icon: UserCheck,
    title: "Verified identity",
    text: "Encrypted document checks and a compliance review keep every account accountable.",
  },
  {
    icon: Lock,
    title: "You stay in control",
    text: "Change your password at any time and every other session is signed out automatically.",
  },
];

export default function AuthLayout() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden flex-col justify-between bg-midnight px-12 py-10 text-white lg:flex">
        <Link to="/" aria-label="Meridian Bank home" className="w-fit">
          <Logo light />
        </Link>

        <motion.div
          className="max-w-md"
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <span className="block h-1 w-10 rounded-full bg-brand-500" aria-hidden="true" />
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-300">
            Digital banking, made clear
          </p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.1] text-white">
            Clear accounts.
            <br />
            Confident decisions.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-brand-100/75">
            Register, verify your identity and manage your profile from one secure
            dashboard built on a service-oriented banking backend.
          </p>

          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-brand-300">
                  <Icon size={17} strokeWidth={2} />
                </span>
                <div>
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-brand-100/65">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </motion.div>

        <p className="text-xs text-brand-100/50">
          Meridian Bank demo environment · No real money is moved
        </p>
      </aside>

      <main className="flex min-h-screen flex-col bg-white">
        <div className="flex items-center justify-between gap-4 px-6 pt-6 lg:px-14">
          <Link to="/" aria-label="Meridian Bank home" className="lg:hidden">
            <Logo />
          </Link>
          <Link
            to="/"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-muted transition hover:bg-brand-50 hover:text-midnight"
          >
            <ArrowLeft size={15} /> Back to home
          </Link>
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
          Keep your one-time codes private · We will never ask you to share them
        </p>
      </main>
    </div>
  );
}
