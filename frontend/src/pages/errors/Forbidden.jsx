import { Link, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import PageTransition from "../../components/ui/PageTransition";

export default function Forbidden() {
  const location = useLocation();
  const from = location.state?.from?.pathname;

  return (
    <PageTransition className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <ShieldAlert size={26} />
      </span>
      <p className="eyebrow mt-6">Error 403</p>
      <h1 className="mt-2 text-3xl font-extrabold text-navy-900">Access denied</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">
        Your account does not have permission to view
        {from ? ` “${from}”` : " this page"}. If you believe this is a mistake,
        contact your administrator.
      </p>
      <Link to="/dashboard" className="btn-primary mt-6">
        Back to overview
      </Link>
    </PageTransition>
  );
}
