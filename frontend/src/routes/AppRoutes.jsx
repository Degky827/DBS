import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import AuthLayout from "../layouts/AuthLayout";
import MainLayout from "../layouts/MainLayout";
import Login from "../pages/auth/Login";
import Register from "../pages/auth/Register";
import VerifyEmail from "../pages/auth/VerifyEmail";
import ForgotPassword from "../pages/auth/ForgotPassword";
import ResetPassword from "../pages/auth/ResetPassword";
import Dashboard from "../pages/dashboard/Dashboard";
import Profile from "../pages/dashboard/Profile";
import ServiceDashboard from "../pages/dashboard/ServiceDashboard";
import ViewProfile from "../pages/profile/ViewProfile";
import EditProfile from "../pages/profile/EditProfile";
import ChangePassword from "../pages/profile/ChangePassword";
import ApiDocs from "../pages/docs/ApiDocs";
import SessionManagement from "../pages/sessions/SessionManagement";
import HealthMonitor from "../pages/health/HealthMonitor";
import ErrorDemo from "../pages/errors/ErrorDemo";
import IntegrationStatus from "../pages/integration/IntegrationStatus";
import ProtectedRoute from "../components/ProtectedRoute";
import { getMe } from "../services/authService";
import { setUser } from "../store/authSlice";

function GuestRoute({ children }) {
  const { isAuthenticated } = useSelector((state) => state.auth);
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  const dispatch = useDispatch();
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    getMe()
      .then(({ user }) => dispatch(setUser(user)))
      .catch(() => {});
  }, [isAuthenticated, dispatch]);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route element={<GuestRoute><Outlet /></GuestRoute>}>
            <Route path="/" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/service-dashboard" element={<ServiceDashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/view" element={<ViewProfile />} />
            <Route path="/profile/edit" element={<EditProfile />} />
            <Route path="/profile/security" element={<ChangePassword />} />
            <Route path="/docs" element={<ApiDocs />} />
            <Route path="/sessions" element={<SessionManagement />} />
            <Route path="/health" element={<HealthMonitor />} />
            <Route path="/errors/demo" element={<ErrorDemo />} />
            <Route path="/integration" element={<IntegrationStatus />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;