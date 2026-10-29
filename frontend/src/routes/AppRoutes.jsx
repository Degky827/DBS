import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import AuthLayout from "../layouts/AuthLayout";
import MainLayout from "../layouts/MainLayout";
import Landing from "../pages/public/Landing";
import Login from "../pages/auth/Login";
import Register from "../pages/auth/Register";
import VerifyEmail from "../pages/auth/VerifyEmail";
import ForgotPassword from "../pages/auth/ForgotPassword";
import ResetPassword from "../pages/auth/ResetPassword";
import Dashboard from "../pages/dashboard/Dashboard";
import Wallet from "../pages/wallet/Wallet";
import Transactions from "../pages/transactions/Transactions";
import Payments from "../pages/payments/Payments";
import KycVerification from "../pages/dashboard/KycVerification";
import OfficerReviews from "../pages/kyc/OfficerReviews";
import Profile from "../pages/profile/Profile";
import ViewProfile from "../pages/profile/ViewProfile";
import EditProfile from "../pages/profile/EditProfile";
import ChangePassword from "../pages/profile/ChangePassword";
import HealthMonitor from "../pages/health/HealthMonitor";
import NotFound from "../pages/errors/NotFound";
import Forbidden from "../pages/errors/Forbidden";
import ProtectedRoute from "../components/ProtectedRoute";
import { Spinner } from "../components/ui/Spinner";
import { getMe } from "../services/authService";
import { bootstrapSession } from "../services/session";
import { setUser } from "../store/authSlice";
import { OFFICER_ROLES } from "../utils/roles";

function SessionLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-50" role="status">
      <Spinner size={30} className="text-navy-600" />
      <span className="sr-only">Restoring session</span>
    </div>
  );
}

function GuestRoute() {
  const { status } = useSelector((state) => state.auth);
  if (status === "checking") return <SessionLoading />;
  if (status === "authenticated") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView({ behavior: "auto", block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname, hash]);
  return null;
}

function AppRoutes() {
  const dispatch = useDispatch();
  const status = useSelector((state) => state.auth.status);

  useEffect(() => {
    bootstrapSession();
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    getMe()
      .then(({ user }) => dispatch(setUser(user)))
      .catch(() => {});
  }, [status, dispatch]);

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route element={<AuthLayout />}>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/kyc" element={<KycVerification />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/view" element={<ViewProfile />} />
            <Route path="/profile/edit" element={<EditProfile />} />
            <Route path="/profile/security" element={<ChangePassword />} />
            <Route path="/health" element={<HealthMonitor />} />
            <Route element={<ProtectedRoute roles={OFFICER_ROLES} />}>
              <Route path="/officer/reviews" element={<OfficerReviews />} />
            </Route>
            <Route path="/forbidden" element={<Forbidden />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;
