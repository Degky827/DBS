import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowLeftRight,
  ChevronDown,
  FileBarChart,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import Logo from "../components/Logo";
import { logoutUser } from "../services/authService";
import { initialsOf } from "../utils/format";
import { isAdmin, isFinance, isOfficer, roleLabel } from "../utils/roles";

const PAGE_META = [
  {
    pattern: /^\/officer\/verifications\/[^/]+$/,
    title: "Application review",
    parent: "Verification",
  },
  {
    pattern: /^\/finance\/transactions\/[^/]+$/,
    title: "Transaction detail",
    parent: "Finance",
  },
  { prefix: "/admin/users", title: "User management", parent: "Administration" },
  { prefix: "/admin/policies", title: "Financial policies", parent: "Administration" },
  { prefix: "/admin/audit-logs", title: "Audit records", parent: "Administration" },
  { prefix: "/admin/reports", title: "Reports", parent: "Administration" },
  { prefix: "/admin/dashboard", title: "Platform overview", parent: "Administration" },
  { prefix: "/officer/verifications", title: "Verification queue", parent: "Verification" },
  { prefix: "/officer/dashboard", title: "Review overview", parent: "Verification" },
  { prefix: "/finance/transactions", title: "Transaction monitoring", parent: "Finance" },
  { prefix: "/finance/reports", title: "Financial reports", parent: "Finance" },
  { prefix: "/finance/dashboard", title: "Financial operations", parent: "Finance" },
  { prefix: "/health", title: "System health", parent: "Operations" },
];

const pageMeta = (pathname) =>
  PAGE_META.find((entry) =>
    entry.pattern
      ? entry.pattern.test(pathname)
      : pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
  ) || { title: "Meridian operations", parent: "Staff" };

const adminSection = {
  label: "Administration",
  items: [
    { to: "/admin/dashboard", label: "Overview", icon: LayoutDashboard },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/policies", label: "Financial policies", icon: SlidersHorizontal },
    { to: "/admin/audit-logs", label: "Audit records", icon: ScrollText },
    { to: "/admin/reports", label: "Reports", icon: FileBarChart },
  ],
};

const verificationSection = {
  label: "Verification",
  items: [
    { to: "/officer/dashboard", label: "Overview", icon: ShieldCheck },
    { to: "/officer/verifications", label: "Review queue", icon: FileSearch },
  ],
};

const financeSection = {
  label: "Finance",
  items: [
    { to: "/finance/dashboard", label: "Overview", icon: LayoutDashboard },
    { to: "/finance/transactions", label: "Transactions", icon: ArrowLeftRight },
    { to: "/finance/reports", label: "Reports", icon: FileBarChart },
  ],
};

const systemSection = {
  label: "System",
  items: [{ to: "/health", label: "Service health", icon: Activity }],
};

const sectionsFor = (user) => {
  const sections = [];
  if (isAdmin(user)) sections.push(adminSection);
  if (isOfficer(user)) sections.push(verificationSection);
  if (isFinance(user)) sections.push(financeSection);
  sections.push(systemSection);
  return sections;
};

function SidebarNav({ user, onNavigate, id }) {
  const sections = sectionsFor(user);
  return (
    <nav id={id} aria-label="Staff navigation" className="space-y-6">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
            {section.label}
          </p>
          <div className="mt-2 space-y-1">
            {section.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/officer/verifications"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition ${
                    isActive
                      ? "bg-brand-600 text-white shadow-[0_8px_20px_-12px_rgba(23,105,224,.9)]"
                      : "text-white/65 hover:bg-white/[0.07] hover:text-white"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={17}
                      strokeWidth={isActive ? 2.2 : 1.9}
                      className={
                        isActive ? "text-white" : "text-white/55 group-hover:text-white/80"
                      }
                    />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function StaffLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useSelector((state) => state.auth);
  const reduceMotion = useReducedMotion();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const menuButtonRef = useRef(null);

  const meta = pageMeta(location.pathname);
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const initials = initialsOf(user?.firstName, user?.lastName);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    drawerCloseRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      menuButton?.focus();
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClickAway = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    await logoutUser();
    navigate("/login");
  };

  const sidebarContent = (onNavigate) => (
    <>
      <div className="px-2">
        <Logo light />
      </div>
      <div className="mt-8 flex-1 overflow-y-auto">
        <SidebarNav
          id={onNavigate ? "staff-navigation-drawer" : "staff-navigation"}
          user={user}
          onNavigate={onNavigate}
        />
      </div>
      <div className="mt-6 space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-200">
            Signed in as
          </p>
          <p className="mt-1.5 truncate text-[13px] font-bold text-white">
            {user?.email || "—"}
          </p>
          <p className="mt-0.5 text-xs text-white/45">{roleLabel(user?.role)}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold text-white/60 transition hover:bg-white/[0.07] hover:text-white"
        >
          <LogOut size={17} /> Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[264px] flex-col border-r border-white/5 bg-midnight px-4 py-6 lg:flex print:hidden">
        {sidebarContent()}
      </aside>

      <AnimatePresence>
        {drawerOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-midnight-deep/60"
              onClick={() => setDrawerOpen(false)}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Staff navigation"
              className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-midnight px-4 py-6"
              initial={reduceMotion ? false : { x: -288 }}
              animate={{ x: 0 }}
              exit={reduceMotion ? undefined : { x: -288 }}
              transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <button
                ref={drawerCloseRef}
                type="button"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
                className="absolute right-3 top-5 rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
              {sidebarContent(() => setDrawerOpen(false))}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              aria-controls="staff-navigation-drawer"
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-muted transition hover:border-brand-600/40 hover:text-midnight lg:hidden"
            >
              <Menu size={18} />
            </button>

            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                {meta.parent}
              </p>
              <h1 className="truncate text-[15px] font-extrabold text-midnight">
                {meta.title}
              </h1>
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <span className="hidden rounded-full border border-ink-200 bg-white px-3 py-1 text-[11px] font-bold text-ink-500 sm:inline">
                {roleLabel(user?.role)}
              </span>
              <span className="hidden h-6 w-px bg-ink-200 sm:block" aria-hidden="true" />

              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-1.5 transition hover:bg-ink-50"
                >
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="h-8 w-8 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-midnight text-[11px] font-bold text-white">
                      {initials}
                    </span>
                  )}
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block max-w-[12rem] truncate text-[13px] font-bold text-midnight">
                      {fullName || "Staff account"}
                    </span>
                    <span className="block text-[11px] text-muted">
                      {user?.email}
                    </span>
                  </span>
                  <ChevronDown size={15} className="text-muted" />
                </button>

                <AnimatePresence>
                  {menuOpen ? (
                    <motion.div
                      role="menu"
                      className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-ink-200 bg-white py-1.5 shadow-[0_20px_48px_-20px_rgba(16,43,70,.35)]"
                      initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
                      style={{ transformOrigin: "top right" }}
                    >
                      <div className="border-b border-ink-100 px-3 py-2.5">
                        <p className="truncate text-[13px] font-bold text-midnight">
                          {fullName || "Staff account"}
                        </p>
                        <p className="truncate text-xs text-muted">{user?.email}</p>
                        <p className="mt-1 text-[11px] font-semibold text-ink-400">
                          {roleLabel(user?.role)} access
                        </p>
                      </div>
                      <div className="p-1.5">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-danger transition hover:bg-red-50"
                        >
                          <LogOut size={16} /> Log out
                        </button>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
