import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ChevronDown,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  UserCog,
  X,
} from "lucide-react";
import Logo from "../components/Logo";
import { logoutUser } from "../services/authService";
import { isOfficer, roleLabel } from "../utils/roles";
import { initialsOf, todayLong } from "../utils/format";

function buildNav(user) {
  const items = [
    { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { to: "/kyc", label: "Identity verification", icon: ShieldCheck },
  ];

  if (isOfficer(user)) {
    items.push({ to: "/officer/reviews", label: "Review queue", icon: FileSearch });
  }

  items.push(
    { to: "/profile", label: "Profile & security", icon: UserCog },
    { to: "/health", label: "System health", icon: Activity }
  );

  return items;
}

function NavLinks({ items, onNavigate, variant = "sidebar" }) {
  return (
    <nav className="space-y-1">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            variant === "sidebar"
              ? `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-navy-100/60 hover:bg-white/5 hover:text-white"
                }`
              : `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  isActive ? "bg-navy-50 text-navy-900" : "text-ink-500 hover:bg-ink-50 hover:text-navy-800"
                }`
          }
        >
          <Icon size={17} strokeWidth={2} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function MainLayout() {
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);
  const reduceMotion = useReducedMotion();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const navItems = buildNav(user);
  const firstName = user?.firstName || "User";
  const lastName = user?.lastName || "";
  const initials = initialsOf(firstName, lastName);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClickAway = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
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
    navigate("/");
  };

  const sidebarContent = (
    <>
      <div className="px-2">
        <Logo light />
      </div>
      <NavLinks items={navItems} onNavigate={() => setDrawerOpen(false)} />
      <div className="mt-auto space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold-400">
            Signed in as
          </p>
          <p className="mt-1.5 truncate text-sm font-bold text-white">{user?.email}</p>
          <p className="mt-0.5 text-xs text-navy-100/60">{roleLabel(user?.role)} account</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-navy-100/60 transition hover:bg-white/5 hover:text-white"
        >
          <LogOut size={17} /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-navy-900 px-4 py-6 lg:flex">
        {sidebarContent}
      </aside>

      <AnimatePresence>
        {drawerOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-navy-950/50"
              onClick={() => setDrawerOpen(false)}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
            />
            <motion.aside
              className="absolute inset-y-0 left-0 flex w-72 flex-col bg-navy-900 px-4 py-6"
              initial={reduceMotion ? false : { x: -288 }}
              animate={{ x: 0 }}
              exit={reduceMotion ? undefined : { x: -288 }}
              transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
                className="absolute right-3 top-5 rounded-lg p-1.5 text-navy-100/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
              {sidebarContent}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-ink-200 bg-white px-4 lg:px-8">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-500 transition hover:border-navy-500/40 hover:text-navy-700 lg:hidden"
          >
            <Menu size={18} />
          </button>

          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-navy-900">Personal banking</p>
            <p className="hidden text-xs text-ink-400 sm:block">{todayLong()}</p>
          </div>

          <div ref={menuRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-3 rounded-lg border border-ink-200 py-1.5 pl-1.5 pr-2.5 transition hover:border-navy-500/40"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-navy-800 text-xs font-bold text-white">
                {initials}
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-[13px] font-bold text-navy-900">
                  {firstName} {lastName}
                </span>
                <span className="block text-[11px] text-ink-400">{roleLabel(user?.role)}</span>
              </span>
              <ChevronDown size={15} className="text-ink-400" />
            </button>

            <AnimatePresence>
              {menuOpen ? (
                <motion.div
                  role="menu"
                  className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-ink-200 bg-white py-1.5 shadow-[0_16px_40px_-18px_rgba(5,13,26,.35)]"
                  initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
                  style={{ transformOrigin: "top right" }}
                >
                  <div className="border-b border-ink-100 px-3 py-2.5">
                    <p className="truncate text-[13px] font-bold text-navy-900">
                      {firstName} {lastName}
                    </p>
                    <p className="truncate text-xs text-ink-400">{user?.email}</p>
                  </div>
                  <div className="p-1.5">
                    <NavLinks
                      items={[
                        { to: "/profile", label: "Profile", icon: UserCog },
                        { to: "/profile/security", label: "Change password", icon: ShieldCheck },
                        { to: "/health", label: "System health", icon: Activity },
                      ]}
                      variant="menu"
                      onNavigate={() => setMenuOpen(false)}
                    />
                  </div>
                  <div className="border-t border-ink-100 p-1.5">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-5 lg:px-8 lg:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
