import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowLeftRight,
  Bell,
  ChevronDown,
  CreditCard,
  FileSearch,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import Logo from "../components/Logo";
import { AccountProvider, useAccount } from "../context/AccountContext";
import { logoutUser } from "../services/authService";
import { isOfficer, roleLabel } from "../utils/roles";
import { initialsOf } from "../utils/format";

const PAGE_META = [
  { prefix: "/dashboard", title: "Dashboard", parent: "Overview" },
  { prefix: "/wallet", title: "Wallet", parent: "Banking" },
  { prefix: "/transactions", title: "Transactions", parent: "Banking" },
  { prefix: "/payments", title: "Payments", parent: "Banking" },
  { prefix: "/kyc/verify", title: "Verify identity", parent: "Identity verification" },
  { prefix: "/kyc/status", title: "Verification status", parent: "Identity verification" },
  { prefix: "/kyc", title: "Identity verification", parent: "Account" },
  { prefix: "/profile/edit", title: "Edit profile", parent: "Profile" },
  { prefix: "/profile/view", title: "Full profile", parent: "Profile" },
  { prefix: "/profile/security", title: "Change password", parent: "Profile" },
  { prefix: "/profile", title: "Profile", parent: "Account" },
  { prefix: "/settings", title: "Settings", parent: "Account" },
  { prefix: "/health", title: "System health", parent: "Operations" },
  { prefix: "/officer/reviews", title: "Review queue", parent: "Operations" },
  { prefix: "/forbidden", title: "Access restricted", parent: "Account" },
];

const pageMeta = (pathname) => {
  return (
    PAGE_META.find(
      (entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
    ) || { title: "Meridian", parent: "" }
  );
};

const NAV_SECTIONS = [
  {
    label: "Banking",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/wallet", label: "Wallet", icon: WalletCards },
      { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { to: "/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/kyc", label: "Identity verification", icon: ShieldCheck },
      { to: "/profile", label: "Profile", icon: UserRound },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function SidebarNav({ user, onNavigate, id }) {
  const sections = NAV_SECTIONS.map((section) => ({ ...section }));
  if (isOfficer(user)) {
    sections.push({
      label: "Operations",
      items: [{ to: "/officer/reviews", label: "Review queue", icon: FileSearch }],
    });
  }

  return (
    <nav id={id} aria-label="Main navigation" className="space-y-6">
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
                      className={isActive ? "text-white" : "text-white/55 group-hover:text-white/80"}
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

function NoticeIcon({ tone }) {
  if (tone === "warning") {
    return <ShieldAlert size={16} className="text-warning" />;
  }
  if (tone === "info") {
    return <Info size={16} className="text-brand-700" />;
  }
  return <ShieldCheck size={16} className="text-success" />;
}

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useSelector((state) => state.auth);
  const { profile, notices, actionableNoticeCount, loading: accountLoading } = useAccount();
  const reduceMotion = useReducedMotion();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const menuRef = useRef(null);
  const noticesRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const menuButtonRef = useRef(null);

  const meta = pageMeta(location.pathname);
  const displayUser = profile || user;
  const firstName = displayUser?.firstName || "there";
  const initials = initialsOf(displayUser?.firstName, displayUser?.lastName);
  const fullName = [displayUser?.firstName, displayUser?.lastName].filter(Boolean).join(" ");

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
    if (!menuOpen && !noticesOpen) return undefined;
    const onClickAway = (event) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
      if (noticesOpen && noticesRef.current && !noticesRef.current.contains(event.target)) {
        setNoticesOpen(false);
      }
    };
    const onEscape = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setNoticesOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen, noticesOpen]);

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
          id={onNavigate ? "primary-navigation-drawer" : "primary-navigation"}
          user={displayUser}
          onNavigate={onNavigate}
        />
      </div>
      <div className="mt-6 space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-200">
            Signed in as
          </p>
          <p className="mt-1.5 truncate text-[13px] font-bold text-white">
            {displayUser?.email || "—"}
          </p>
          <p className="mt-0.5 text-xs text-white/45">
            {roleLabel(displayUser?.role)} account
          </p>
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

  const menuItems = [
    { to: "/profile", label: "Profile", icon: UserRound },
    { to: "/settings", label: "Settings", icon: Settings },
    { to: "/profile/security", label: "Change password", icon: KeyRound },
  ];
  if (isOfficer(displayUser)) {
    menuItems.push({ to: "/health", label: "System health", icon: Activity });
  }

  return (
    <div className="min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[260px] flex-col border-r border-white/5 bg-midnight px-4 py-6 lg:flex">
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
              aria-label="Main navigation"
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

      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              aria-controls="primary-navigation-drawer"
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-muted transition hover:border-brand-600/40 hover:text-midnight lg:hidden"
            >
              <Menu size={18} />
            </button>

            <div className="min-w-0">
              {meta.parent ? (
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  {meta.parent}
                </p>
              ) : null}
              <h2 className="truncate text-[15px] font-extrabold text-midnight">{meta.title}</h2>
            </div>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
              <div ref={noticesRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNoticesOpen((open) => !open);
                    setMenuOpen(false);
                  }}
                  aria-label={
                    actionableNoticeCount
                      ? `Account notices, ${actionableNoticeCount} need attention`
                      : "Account notices"
                  }
                  aria-haspopup="dialog"
                  aria-expanded={noticesOpen}
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted transition hover:border-ink-200 hover:bg-ink-50 hover:text-midnight"
                >
                  <Bell size={18} />
                  {actionableNoticeCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[9px] font-bold text-white">
                      {actionableNoticeCount > 9 ? "9+" : actionableNoticeCount}
                    </span>
                  ) : null}
                </button>

                <AnimatePresence>
                  {noticesOpen ? (
                    <motion.div
                      role="dialog"
                      aria-label="Account notices"
                      className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_20px_48px_-20px_rgba(16,43,70,.35)]"
                      initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
                      style={{ transformOrigin: "top right" }}
                    >
                      <div className="border-b border-ink-100 px-4 py-3">
                        <p className="text-[13px] font-extrabold text-midnight">Account notices</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          Live actions from your account and verification status.
                        </p>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {accountLoading ? (
                          <p className="px-4 py-6 text-center text-[13px] text-muted">
                            Checking your account…
                          </p>
                        ) : notices.length === 0 ? (
                          <p className="px-4 py-6 text-center text-[13px] text-muted">
                            You&apos;re all caught up. There are no actions waiting for you.
                          </p>
                        ) : (
                          <ul className="divide-y divide-ink-100">
                            {notices.map((notice) => (
                              <li key={notice.id}>
                                <Link
                                  to={notice.to}
                                  onClick={() => setNoticesOpen(false)}
                                  className="flex items-start gap-3 px-4 py-3 transition hover:bg-ink-50"
                                >
                                  <span className="mt-0.5">
                                    <NoticeIcon tone={notice.tone} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-[13px] font-bold text-midnight">
                                      {notice.title}
                                    </span>
                                    <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                                      {notice.description}
                                    </span>
                                    <span className="mt-1 inline-block text-[12px] font-bold text-brand-700">
                                      {notice.actionLabel}
                                    </span>
                                  </span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <span className="hidden h-6 w-px bg-ink-200 sm:block" aria-hidden="true" />

              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen((open) => !open);
                    setNoticesOpen(false);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-1.5 transition hover:bg-ink-50 sm:pr-2.5"
                >
                  {displayUser?.avatarUrl ? (
                    <img
                      src={displayUser.avatarUrl}
                      alt=""
                      className="h-8 w-8 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-midnight text-[11px] font-bold text-white">
                      {initials}
                    </span>
                  )}
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block max-w-[10rem] truncate text-[13px] font-bold text-midnight">
                      {fullName || firstName}
                    </span>
                    <span className="block text-[11px] text-muted">
                      {roleLabel(displayUser?.role)}
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
                          {fullName || "Your account"}
                        </p>
                        <p className="truncate text-xs text-muted">{displayUser?.email}</p>
                      </div>
                      <div className="p-1.5">
                        {menuItems.map(({ to, label, icon: Icon }) => (
                          <NavLink
                            key={to}
                            to={to}
                            role="menuitem"
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-body transition hover:bg-ink-50"
                          >
                            <Icon size={16} className="text-muted" /> {label}
                          </NavLink>
                        ))}
                      </div>
                      <div className="border-t border-ink-100 p-1.5">
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
          className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function MainLayout() {
  return (
    <AccountProvider>
      <AuthenticatedLayout />
    </AccountProvider>
  );
}
