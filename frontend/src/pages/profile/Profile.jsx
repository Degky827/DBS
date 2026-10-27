import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { BadgeCheck, KeyRound, Pencil, RefreshCw, ShieldCheck } from "lucide-react";
import { getMyProfile, GENDER_LABELS } from "../../services/userService";
import { getKycStatus } from "../../services/kycService";
import { formatDate, displayValue, initialsOf, titleCase } from "../../utils/format";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { LoadingBlock } from "../../components/ui/Spinner";

export default function Profile() {
  const navigate = useNavigate();
  const authUser = useSelector((state) => state.auth.user);
  const [profile, setProfile] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const [profileResult, kycResult] = await Promise.allSettled([getMyProfile(), getKycStatus()]);
    if (profileResult.status === "fulfilled") setProfile(profileResult.value);
    else setError(profileResult.value?.response?.data?.message || "Unable to load your profile.");
    if (kycResult.status === "fulfilled") setKyc(kycResult.value);
    setLoading(false);
  }, []);

  const refresh = () => {
    setLoading(true);
    load();
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [profileResult, kycResult] = await Promise.allSettled([getMyProfile(), getKycStatus()]);
      if (!mounted) return;
      if (profileResult.status === "fulfilled") setProfile(profileResult.value);
      else setError(profileResult.value?.response?.data?.message || "Unable to load your profile.");
      if (kycResult.status === "fulfilled") setKyc(kycResult.value);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const fullName = profile
    ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
    : "";
  const initials = profile
    ? initialsOf(profile.firstName, profile.lastName)
    : initialsOf(authUser?.firstName, authUser?.lastName);
  const verified = authUser?.isEmailVerified;

  const DETAILS = profile
    ? [
        ["Full name", fullName || "—"],
        ["Username", displayValue(profile.username)],
        ["Email", displayValue(profile.email)],
        ["Date of birth", formatDate(profile.dateOfBirth)],
        ["Gender", GENDER_LABELS[profile.gender] || displayValue(profile.gender)],
        ["Phone number", displayValue(profile.phoneNumber)],
        ["Member since", formatDate(profile.createdAt)],
      ]
    : [];

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Profile & security"
        description="Review your personal details, manage your password and check your verification status."
        actions={
          <button type="button" className="btn-ghost" onClick={refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      {loading && <LoadingBlock label="Loading your profile…" />}

      {!loading && error && (
        <div className="card px-5 py-10 text-center">
          <p className="text-sm font-medium text-red-600">{error}</p>
          <button type="button" onClick={load} className="btn-ghost mt-4">
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      )}

      {!loading && !error && profile && (
        <StaggerGroup className="space-y-6">
          <StaggerItem className="card flex flex-wrap items-center gap-5 p-5">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={`${fullName || "Profile"} avatar`}
                className="h-16 w-16 rounded-2xl object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy-800 text-xl font-extrabold text-white">
                {initials}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-extrabold text-navy-900">
                  {fullName || "Complete your profile"}
                </h2>
                {verified && (
                  <span className="badge-success">
                    <BadgeCheck size={13} /> Verified
                  </span>
                )}
                <StatusBadge value={kyc?.status} fallback="KYC not started" />
              </div>
              <p className="mt-1 truncate text-sm text-ink-500">
                {displayValue(profile.username)} · {displayValue(profile.email)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/profile/edit")}
              className="btn-ghost ml-auto"
            >
              <Pencil size={15} /> Edit profile
            </button>
          </StaggerItem>

          <StaggerGroup className="grid gap-6 lg:grid-cols-2">
            <StaggerItem className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h3 className="text-[15px] font-extrabold">Personal details</h3>
              </div>
              <dl className="divide-y divide-ink-100 px-5">
                {DETAILS.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 py-3.5">
                    <dt className="text-[13px] font-medium text-ink-400">{label}</dt>
                    <dd className="text-right text-sm font-bold text-navy-900">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-ink-100 px-5 py-3.5">
                <Link to="/profile/view" className="link text-[13px]">
                  Open full profile
                </Link>
              </div>
            </StaggerItem>

            <StaggerItem className="space-y-6">
              <div className="card">
                <div className="border-b border-ink-100 px-5 py-4">
                  <h3 className="text-[15px] font-extrabold">Security settings</h3>
                </div>
                <div className="divide-y divide-ink-100">
                  <div className="flex items-center gap-4 px-5 py-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
                      <KeyRound size={17} />
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-navy-900">Password</p>
                      <p className="text-xs text-ink-400">
                        {profile.passwordChangedAt
                          ? `Last changed ${formatDate(profile.passwordChangedAt)}`
                          : "Never changed"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/profile/security")}
                      className="btn-secondary py-2 text-xs"
                    >
                      Change
                    </button>
                  </div>
                  <div className="flex items-start gap-4 px-5 py-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
                      <ShieldCheck size={17} />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-navy-900">Active sessions</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
                        Sessions are managed with short-lived access tokens. Changing your
                        password signs out every other device immediately.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <Alert tone="info">
                Your role is <span className="font-bold">{titleCase(profile.role)}</span>.
                Roles are enforced by the backend on every protected request.
              </Alert>
            </StaggerItem>
          </StaggerGroup>
        </StaggerGroup>
      )}
    </PageTransition>
  );
}
