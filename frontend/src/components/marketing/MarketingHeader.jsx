import { useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { Menu, X, ArrowRight } from "lucide-react";
import Logo from "../Logo";

const NAV = [
  { label: "Home", to: "/#home" },
  { label: "Features", to: "/#features" },
  { label: "Security", to: "/#security" },
  { label: "About", to: "/#about" },
];

export default function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const isAuthenticated = useSelector((state) => state.auth.status === "authenticated");

  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link to="/" aria-label="Meridian Bank home" onClick={close}>
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.label} to={item.to} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {isAuthenticated ? (
            <Link to="/dashboard" className="btn-brand px-4 py-2.5">
              Go to dashboard <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-midnight transition hover:bg-brand-50"
              >
                Log in
              </Link>
              <Link to="/register" className="btn-brand px-4 py-2.5">
                Get started
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="public-mobile-nav"
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-ink-200 text-midnight transition hover:bg-brand-50 lg:hidden"
        >
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>

      <div
        id="public-mobile-nav"
        hidden={!open}
        className="border-t border-ink-200 bg-white px-5 pb-6 pt-3 lg:hidden"
      >
        <nav className="flex flex-col" aria-label="Mobile">
          {NAV.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={close}
              className="rounded-lg px-3 py-3 text-sm font-semibold text-midnight transition hover:bg-brand-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 grid gap-3 border-t border-ink-200 pt-5">
          {isAuthenticated ? (
            <Link to="/dashboard" onClick={close} className="btn-brand w-full">
              Go to dashboard <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <Link to="/login" onClick={close} className="btn-brand-outline w-full">
                Log in
              </Link>
              <Link to="/register" onClick={close} className="btn-brand w-full">
                Get started <ArrowRight size={16} />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
