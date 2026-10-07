import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Receipt,
  UserCog,
  Bell,
  LogOut,
  LifeBuoy,
} from "lucide-react";
import Logo from "../components/Logo";

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/profile", label: "Profile & security", icon: UserCog },
];

const COMING_SOON = [
  { label: "Accounts", icon: Wallet },
  { label: "Transfers", icon: ArrowLeftRight },
  { label: "Transactions", icon: Receipt },
];

const USER = {
  name: "Ada Lovelace",
  role: "Personal · Checking",
  initials: "AL",
};

export default function MainLayout() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-ink-50">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-navy-900 px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo light />
        </div>

        <nav className="mt-9 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-navy-100/60 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon size={17} strokeWidth={2} />
              {label}
            </NavLink>
          ))}

          <p className="px-3 pb-1 pt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-navy-100/40">
            Banking
          </p>

          {COMING_SOON.map(({ label, icon: Icon }) => (
            <span
              key={label}
              className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-navy-100/35"
              title="Coming soon"
            >
              <Icon size={17} strokeWidth={2} />
              {label}
              <span className="ml-auto rounded border border-gold-400/30 bg-gold-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gold-400">
                Soon
              </span>
            </span>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-xl border border-gold-400/20 bg-gold-400/10 p-4">
            <p className="flex items-center gap-2 text-xs font-bold text-gold-400">
              <LifeBuoy size={14} /> Priority support
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-navy-100/70">
              Dedicated advisors available 24/7 for card and fraud issues.
            </p>
            <a href="tel:+18005550199" className="mt-2 inline-block text-xs font-bold text-white underline-offset-4 hover:underline">
              1-800-555-0199
            </a>
          </div>

          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-navy-100/60 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-ink-200 bg-white/85 px-5 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <Logo size="sm" />
          </div>

          <div className="hidden lg:block">
            <p className="text-sm font-bold text-navy-900">Personal banking</p>
            <p className="text-xs text-ink-400">Wednesday, 7 October 2026</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              aria-label="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-500 transition hover:border-navy-500/40 hover:text-navy-700"
            >
              <Bell size={17} />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold-500" />
            </button>

            <div className="flex items-center gap-3 rounded-lg border border-ink-200 py-1.5 pl-1.5 pr-3.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-navy-800 text-xs font-bold text-white">
                {USER.initials}
              </span>
              <div className="leading-tight">
                <p className="text-[13px] font-bold text-navy-900">{USER.name}</p>
                <p className="text-[11px] text-ink-400">{USER.role}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="px-5 py-7 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
