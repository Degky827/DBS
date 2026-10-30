import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import AuthLayout from "../layouts/AuthLayout";
import MainLayout from "../layouts/MainLayout";
import StaffLayout from "../layouts/StaffLayout";
import Landing from "../pages/public/Landing";
import Login from "../pages/auth/Login";
import Register from "../pages/auth/Register";
import VerifyEmail from "../pages/auth/VerifyEmail";
import ForgotPassword from "../pages/auth/ForgotPassword";
import ResetPassword from "../pages/auth/ResetPassword";
import Dashboard from "../pages/dashboard/Dashboard";
import Wallet from "../pages/wallet/Wallet";
import Transactions from "../pages/transactions/Transactions";
import TransactionDetails from "../pages/transactions/TransactionDetails";
import Transfers from "../pages/transfers/Transfers";
import Payments from "../pages/payments/Payments";
import KycOverview from "../pages/kyc/KycOverview";
import KycWizard from "../pages/kyc/KycWizard";
import KycStatus from "../pages/kyc/KycStatus";
import Profile from "../pages/profile/Profile";
import ViewProfile from "../pages/profile/ViewProfile";
import EditProfile from "../pages/profile/EditProfile";
import ChangePassword from "../pages/profile/ChangePassword";
import Settings from "../pages/settings/Settings";
import HealthMonitor from "../pages/health/HealthMonitor";
import AdminDashboard from "../pages/admin/AdminDashboard";
import AdminUsers from "../pages/admin/AdminUsers";
import AdminPolicies from "../pages/admin/AdminPolicies";
import AdminAuditLogs from "../pages/admin/AdminAuditLogs";
import OfficerDashboard from "../pages/officer/OfficerDashboard";
import OfficerVerifications from "../pages/officer/OfficerVerifications";
import OfficerReviewDetail from "../pages/officer/OfficerReviewDetail";
import FinanceDashboard from "../pages/finance/FinanceDashboard";
import FinanceTransactions from "../pages/finance/FinanceTransactions";
import FinanceTransactionDetail from "../pages/finance/FinanceTransactionDetail";
import FinancialReports from "../components/staff/FinancialReports";
import NotFound from "../pages/errors/NotFound";
import Forbidden from "../pages/errors/Forbidden";
import ProtectedRoute from "../components/ProtectedRoute";
import { Spinner } from "../components/ui/Spinner";
import { getMe } from "../services/authService";
import { bootstrapSession } from "../services/session";
import { setUser } from "../store/authSlice";
import {
  ADMIN_ROLES,
  FINANCE_ROLES,
  OFFICER_ROLES,
  STAFF_ROLES,
  homePathForRole,
  isStaff,
} from "../utils/roles";

function SessionLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-50" role="status">
      <Spinner size={30} className="text-navy-600" />
      <span className="sr-only">Restoring session</span>
    </div>
  );
}

function GuestRoute() {
  const { status, user } = useSelector((state) => state.auth);
  if (status === "checking") return <SessionLoading />;
  if (status === "authenticated") return <Navigate to={homePathForRole(user?.role)} replace />;
  return <Outlet />;
}

// Staff accounts use the operations shell. Sending them to the customer shell
// would mount customer-only account context that does not apply to them.
function CustomerShell() {
  const { user } = useSelector((state) => state.auth);
  if (isStaff(user)) return <Navigate to={homePathForRole(user?.role)} replace />;
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
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route
            path="/forbidden"
            element={
              <div className="grid min-h-screen place-items-center bg-canvas px-4 py-16">
                <Forbidden />
              </div>
            }
          />
          <Route element={<CustomerShell />}>
            <Route element={<MainLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/transfers" element={<Transfers />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/transactions/:reference" element={<TransactionDetails />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/kyc" element={<KycOverview />} />
              <Route path="/kyc/verify" element={<KycWizard />} />
              <Route path="/kyc/status" element={<KycStatus />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/view" element={<ViewProfile />} />
              <Route path="/profile/edit" element={<EditProfile />} />
              <Route path="/profile/security" element={<ChangePassword />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={ADMIN_ROLES} />}>
            <Route element={<StaffLayout />}>
              <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/policies" element={<AdminPolicies />} />
              <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
              <Route path="/admin/reports" element={<FinancialReports scope="admin" />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={OFFICER_ROLES} />}>
            <Route element={<StaffLayout />}>
              <Route path="/officer" element={<Navigate to="/officer/dashboard" replace />} />
              <Route path="/officer/dashboard" element={<OfficerDashboard />} />
              <Route path="/officer/verifications" element={<OfficerVerifications />} />
              <Route
                path="/officer/verifications/:submissionId"
                element={<OfficerReviewDetail />}
              />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={FINANCE_ROLES} />}>
            <Route element={<StaffLayout />}>
              <Route path="/finance" element={<Navigate to="/finance/dashboard" replace />} />
              <Route path="/finance/dashboard" element={<FinanceDashboard />} />
              <Route path="/finance/transactions" element={<FinanceTransactions />} />
              <Route
                path="/finance/transactions/:reference"
                element={<FinanceTransactionDetail />}
              />
              <Route path="/finance/reports" element={<FinancialReports scope="finance" />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={STAFF_ROLES} />}>
            <Route element={<StaffLayout />}>
              <Route path="/health" element={<HealthMonitor />} />
            </Route>
          </Route>
        </Route>

        <Route
          path="*"
          element={
            <div className="grid min-h-screen place-items-center bg-canvas px-4 py-16">
              <NotFound />
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;
