import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import AuthLayout from "../layouts/AuthLayout";
import MainLayout from "../layouts/MainLayout";
import StaffLayout from "../layouts/StaffLayout";
import NotFound from "../pages/errors/NotFound";
import Forbidden from "../pages/errors/Forbidden";
import ProtectedRoute from "../components/ProtectedRoute";

const Landing = lazy(() => import("../pages/public/Landing"));
const Login = lazy(() => import("../pages/auth/Login"));
const Register = lazy(() => import("../pages/auth/Register"));
const VerifyEmail = lazy(() => import("../pages/auth/VerifyEmail"));
const ForgotPassword = lazy(() => import("../pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("../pages/auth/ResetPassword"));
const Dashboard = lazy(() => import("../pages/dashboard/Dashboard"));
const Wallet = lazy(() => import("../pages/wallet/Wallet"));
const Transactions = lazy(() => import("../pages/transactions/Transactions"));
const TransactionDetails = lazy(() => import("../pages/transactions/TransactionDetails"));
const Transfers = lazy(() => import("../pages/transfers/Transfers"));
const Payments = lazy(() => import("../pages/payments/Payments"));
const KycOverview = lazy(() => import("../pages/kyc/KycOverview"));
const KycWizard = lazy(() => import("../pages/kyc/KycWizard"));
const KycStatus = lazy(() => import("../pages/kyc/KycStatus"));
const Profile = lazy(() => import("../pages/profile/Profile"));
const ViewProfile = lazy(() => import("../pages/profile/ViewProfile"));
const EditProfile = lazy(() => import("../pages/profile/EditProfile"));
const ChangePassword = lazy(() => import("../pages/profile/ChangePassword"));
const Settings = lazy(() => import("../pages/settings/Settings"));
const HealthMonitor = lazy(() => import("../pages/health/HealthMonitor"));
const AdminDashboard = lazy(() => import("../pages/admin/AdminDashboard"));
const AdminUsers = lazy(() => import("../pages/admin/AdminUsers"));
const AdminPolicies = lazy(() => import("../pages/admin/AdminPolicies"));
const AdminAuditLogs = lazy(() => import("../pages/admin/AdminAuditLogs"));
const OfficerDashboard = lazy(() => import("../pages/officer/OfficerDashboard"));
const OfficerVerifications = lazy(() => import("../pages/officer/OfficerVerifications"));
const OfficerReviewDetail = lazy(() => import("../pages/officer/OfficerReviewDetail"));
const FinanceDashboard = lazy(() => import("../pages/finance/FinanceDashboard"));
const FinanceTransactions = lazy(() => import("../pages/finance/FinanceTransactions"));
const FinanceTransactionDetail = lazy(() => import("../pages/finance/FinanceTransactionDetail"));
const FinancialReports = lazy(() => import("../components/staff/FinancialReports"));
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

function RouteLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-50" role="status">
      <Spinner size={30} className="text-navy-600" />
      <span className="sr-only">Loading page</span>
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
      <Suspense fallback={<RouteLoading />}>
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
      </Suspense>
    </BrowserRouter>
  );
}

export default AppRoutes;
