import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import PageTransition from "../../components/ui/PageTransition";

export default function NotFound() {
  return (
    <PageTransition className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
        <Compass size={26} />
      </span>
      <p className="eyebrow mt-6">Error 404</p>
      <h1 className="mt-2 text-3xl font-extrabold text-navy-900">Page not found</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">
        The page you are looking for does not exist or may have been moved. Return
        to your overview to continue.
      </p>
      <Link to="/dashboard" className="btn-primary mt-6">
        Back to overview
      </Link>
    </PageTransition>
  );
}
