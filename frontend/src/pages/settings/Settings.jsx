import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  ArrowRight,
  Bell,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import { logoutUser } from "../../services/authService";
import { formatDate, titleCase } from "../../utils/format";

function SettingRow({ title, description, action, status }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-midnight">{title}</p>
        <p className="mt-0.5 max-w-md text-[12px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status}
        {action}
      </div>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const authUser = useSelector((state) => state.auth.user);
  const { profile, kyc, loading, profileError, refresh } = useAccount();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  const emailVerified = authUser?.isEmailVerified;

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError("");
    try {
      await logoutUser();
      navigate("/login");
    } catch {
      setSignOutError("We could not sign you out. Please try again.");
      setSigningOut(false);
    }
  };

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage the account actions and security controls that are available for your profile."
        actions={
          <button
            type="button"
            className="btn-ghost"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      {profileError ? <Alert tone="error">{profileError}</Alert> : null}
      {signOutError ? <Alert tone="error">{signOutError}</Alert> : null}

      {loading && !profile ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="card space-y-3 p-6">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <StaggerGroup className="grid gap-6 lg:grid-cols-2">
          <StaggerItem className="card">
            <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
              <UserRound size={16} className="text-brand-700" />
              <h2 className="text-[14px] font-extrabold text-midnight">Account</h2>
            </div>
            <div className="divide-y divide-ink-100 px-5">
              <SettingRow
                title="Personal information"
                description="Your name, phone number and address are used on your profile and identity checks."
                action={
                  <Link to="/profile/edit" className="btn-ghost py-2">
                    Edit profile
                  </Link>
                }
              />
              <SettingRow
                title="Email address"
                description={profile?.email || authUser?.email || "No email on file"}
                status={
                  emailVerified ? (
                    <span className="badge-success">Verified</span>
                  ) : (
                    <span className="badge-warning">Pending</span>
                  )
                }
                action={
                  emailVerified ? null : (
                    <Link
                      to="/verify-email"
                      state={{ email: profile?.email || authUser?.email }}
                      className="btn-ghost py-2"
                    >
                      <Mail size={14} /> Verify
                    </Link>
                  )
                }
              />
              <SettingRow
                title="Account type"
                description="Your role is enforced by the backend on every protected request."
                status={
                  <span className="badge-info">
                    {titleCase(profile?.role || authUser?.role)}
                  </span>
                }
              />
              <SettingRow
                title="Member since"
                description={profile?.createdAt ? formatDate(profile.createdAt) : "Not available"}
              />
            </div>
          </StaggerItem>

          <StaggerItem className="card">
            <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
              <KeyRound size={16} className="text-brand-700" />
              <h2 className="text-[14px] font-extrabold text-midnight">Security</h2>
            </div>
            <div className="divide-y divide-ink-100 px-5">
              <SettingRow
                title="Password"
                description={
                  profile?.passwordChangedAt
                    ? `Last changed ${formatDate(profile.passwordChangedAt)}. Changing it signs out other devices.`
                    : "Choose a strong password. Changing it signs out other devices."
                }
                action={
                  <Link to="/profile/security" className="btn-ghost py-2">
                    Change password
                  </Link>
                }
              />
              <SettingRow
                title="Access tokens"
                description="Access tokens expire after fifteen minutes and live only in memory. Refresh tokens are stored in an HttpOnly cookie."
                status={<span className="badge-success">Active</span>}
              />
              <SettingRow
                title="Current session"
                description="Sign out of this browser. Your refresh token family is revoked on the server."
                action={
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="btn-danger-outline py-2"
                  >
                    <LogOut size={14} /> {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                }
              />
            </div>
          </StaggerItem>

          <StaggerItem className="card">
            <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
              <ShieldCheck size={16} className="text-brand-700" />
              <h2 className="text-[14px] font-extrabold text-midnight">Identity verification</h2>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-bold text-midnight">Verification status</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                    Required for transfers and payments. Only the backend can change this status.
                  </p>
                </div>
                <StatusBadge value={kyc?.status} fallback="Not started" />
              </div>
              <Link to={kyc ? "/kyc/status" : "/kyc"} className="btn-primary py-2.5">
                {kyc ? "View verification status" : "Start verification"} <ArrowRight size={14} />
              </Link>
            </div>
          </StaggerItem>

          <StaggerItem className="card">
            <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
              <Bell size={16} className="text-brand-700" />
              <h2 className="text-[14px] font-extrabold text-midnight">Notifications</h2>
            </div>
            <div className="space-y-3 px-5 py-4 text-[12.5px] leading-relaxed text-muted">
              <p>
                Account notices are generated from your live wallet, profile and verification
                status, and appear in the bell in the top bar.
              </p>
              <p>
                Persisted email or SMS notification preferences are not available on this
                platform yet, so no preference controls are shown here.
              </p>
            </div>
          </StaggerItem>
        </StaggerGroup>
      )}
    </PageTransition>
  );
}
