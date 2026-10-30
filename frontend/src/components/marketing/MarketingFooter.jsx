import { Link } from "react-router-dom";
import Logo from "../Logo";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { label: "Features", to: "/#features" },
      { label: "Security", to: "/#security" },
      { label: "How it works", to: "/#how-it-works" },
      { label: "FAQ", to: "/#faq" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Create an account", to: "/register" },
      { label: "Sign in", to: "/login" },
      { label: "Verify your email", to: "/verify-email" },
      { label: "Reset password", to: "/forgot-password" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "About Meridian", to: "/#about" },
      { label: "Account protection", to: "/#security" },
      { label: "Identity checks", to: "/#features" },
      { label: "Wallet & transfers", to: "/#features" },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer className="bg-midnight text-white">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <Link to="/" aria-label="Meridian Bank home" className="inline-block">
              <Logo light />
            </Link>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-brand-100/70">
              A service-oriented digital banking platform for accounts, identity
              verification, wallets and tracked transactions.
            </p>
            <p className="mt-5 inline-flex rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-brand-100/80">
              Demo environment
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-200/80">
                  {column.title}
                </p>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        to={link.to}
                        className="text-[13px] font-medium text-white/70 transition hover:text-white"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-[12px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Meridian Bank. Evaluation build.</p>
          <p>No real money is held or moved in this environment.</p>
        </div>
      </div>
    </footer>
  );
}
