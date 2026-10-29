import { useSelector } from "react-redux";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "./ui/Spinner";

export default function ProtectedRoute({ roles }) {
  const { status, user } = useSelector((state) => state.auth);
  const location = useLocation();

  if (status === "checking") {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50" role="status">
        <Spinner size={30} className="text-navy-600" />
        <span className="sr-only">Restoring session</span>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && roles.length > 0 && !roles.includes(user?.role)) {
    return <Navigate to="/forbidden" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
