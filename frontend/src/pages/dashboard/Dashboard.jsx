import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  ArrowUpRight,
  BadgeCheck,
  CircleDashed,
  FileSearch,
  KeyRound,
  Pencil,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { getMyProfile, GENDER_LABELS } from "../../services/userService";
import { getKycStatus } from "../../services/kycService";
import { formatDate, displayValue, greetingForNow, titleCase } from "../../utils/format";
import { isOfficer, roleLabel } from "../../utils/roles";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import StatusBadge from "../../components/ui/StatusBadge";
import Alert from "../../components/ui/Alert";
import { Skeleton } from "../../components/ui/Spinner";

const kycCopy = (status) => {
  switch (status) {
    case "APPROVED":
      return "Your identity has been verified.";
    case "PENDING_REVIEW":
      return "Your information is with our team for review.";
    case "REJECTED":
      return "Your verification was not approved. Review the details and resubmit.";
    case "NEEDS_RESUBMISSION":
      return "Please upload a clearer identity document to continue.";
    case "IN_PROGRESS":
      return "Finish your secure identity check to continue.";
    default:
      return "Verify your identity to finish setting up your account.";
  }
};

export default function Dashboard() {
  const authUser = useSelector((state) => state.auth.user);
  const [profile, setProfile] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const [profileResult, kycResult] = await Promise.allSettled([
        getMyProfile(),
        getKycStatus(),
      ]);
      if (!active) return;
      if (profileResult.status === "fulfilled") setProfile(profileResult.value);
      else setError(profileResult.value?.response?.data?.message || "Unable to load your account data.");
      if (kycResult.status === "fulfilled") setKyc(kycResult.value);
      else if (kycResult.value?.response?.status !== 404) setKyc({ unavailable: true });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const name = [profile?.firstName || authUser?.firstName, profile?.lastName || authUser?.lastName]
    .filter(Boolean)
    .join(" ");
  const role = profile?.role || authUser?.role || "USER";
  const emailVerified = Boolean(authUser?.isEmailVerified);
  const profileComplete = Boolean(
    profile?.firstName &&
      profile?.lastName &&
      profile?.phoneNumber &&
      profile?.dateOfBirth &&
      !String(profile.dateOfBirth).startsWith("1970")
  );

  const checklist = [
    {
      label: "Complete your profile",
      done: profileComplete,
      to: "/profile/edit",
      pending: "Add your address and contact details",
    },
    {
      label: "Email verified",
      done: emailVerified,
      to: "/verify-email",
      pending: "Confirm your email address",
    },
    {
      label: "Identity verification",
      done: kyc?.status === "APPROVED",
      to: "/kyc",
      pending: kyc?.status ? `Current status: ${titleCase(kyc.status)}` : "Start your KYC check",
    },
  ];
  const doneCount = checklist.filter((item) => item.done).length;

  return (
    <PageTransition className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{greetingForNow()}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold text-navy-900">
              {name || "Your account"}
            </h1>
            <span className="badge-info">{roleLabel(role)}</span>
          </div>
          <p className="mt-1.5 text-sm text-ink-500">
            {profile?.email || authUser?.email || ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/profile/edit" className="btn-ghost">
            <Pencil size={15} /> Edit profile
          </Link>
          {isOfficer({ role }) && (
            <Link to="/officer/reviews" className="btn-primary">
              <FileSearch size={16} /> Review queue
            </Link>
          )}
        </div>
      </div>

      {error && <Alert tone="warning">{error}</Alert>}

      <StaggerGroup className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-800 text-white">
                <ShieldCheck size={20} />
              </span>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                  Identity verification
                </p>
                <h2 className="mt-1 text-lg font-extrabold text-navy-900">
                  {loading ? (
                    <Skeleton className="h-6 w-44" />
                  ) : kyc?.unavailable ? (
                    "Verification status unavailable"
                  ) : (
                    titleCase(kyc?.status || "Not started")
                  )}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">
                  {loading
                    ? "Checking your verification status…"
                    : kyc?.unavailable
                      ? "We couldn't reach the verification service. Try again from the verification page."
                      : kycCopy(kyc?.status)}
                </p>
              </div>
            </div>
            <Link to="/kyc" className="btn-ghost shrink-0">
              {kyc?.status === "APPROVED" ? "View details" : "Go to verification"}
              <ArrowUpRight size={15} />
            </Link>
          </div>

          {!loading && !kyc?.unavailable && kyc?.status ? (
            <div className="mt-5 grid gap-3 border-t border-ink-100 pt-4 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
                <span className="text-ink-500">Provider check</span>
                <StatusBadge value={kyc.providerStatus} fallback="Not started" />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
                <span className="text-ink-500">Document check</span>
                <StatusBadge value={kyc.documentVerificationStatus} fallback="Pending" />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
                <span className="text-ink-500">Data comparison</span>
                <StatusBadge value={kyc.dataComparisonStatus} fallback="Pending" />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
                <span className="text-ink-500">Face & liveness</span>
                <StatusBadge
                  value={kyc.faceMatchStatus || kyc.livenessStatus}
                  fallback="Pending"
                />
              </div>
            </div>
          ) : null}
        </StaggerItem>

        <StaggerItem className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
              Setup progress
            </p>
            <span className="badge-info num">
              {doneCount}/{checklist.length}
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {checklist.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className="group flex items-start gap-3 rounded-lg px-2 py-1.5 transition hover:bg-ink-50"
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      item.done ? "bg-emerald-50 text-emerald-600" : "bg-ink-100 text-ink-400"
                    }`}
                  >
                    {item.done ? <BadgeCheck size={13} /> : <CircleDashed size={12} />}
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-navy-900">{item.label}</span>
                    <span className="block text-xs text-ink-400">
                      {item.done ? "Completed" : item.pending}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </StaggerItem>
      </StaggerGroup>

      <StaggerGroup className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="card lg:col-span-2">
          <div className="border-b border-ink-100 px-5 py-4">
            <h2 className="text-[15px] font-extrabold">Account summary</h2>
          </div>
          {loading ? (
            <div className="space-y-3 px-5 py-5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <dl className="divide-y divide-ink-100 px-5">
              {[
                ["Full name", name || "—"],
                ["Username", displayValue(profile?.username)],
                ["Email", displayValue(profile?.email)],
                ["Phone", displayValue(profile?.phoneNumber)],
                ["Gender", GENDER_LABELS[profile?.gender] || displayValue(profile?.gender)],
                ["Member since", formatDate(profile?.createdAt)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-[13px] font-medium text-ink-400">{label}</dt>
                  <dd className="text-right text-sm font-bold text-navy-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="border-t border-ink-100 px-5 py-3.5">
            <Link to="/profile/view" className="link text-[13px]">
              Open full profile
            </Link>
          </div>
        </StaggerItem>

        <StaggerItem className="space-y-4">
          <div className="card p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
              Quick actions
            </p>
            <div className="mt-4 space-y-2">
              <Link to="/kyc" className="group flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-2.5 transition hover:border-navy-500/40 hover:bg-navy-50">
                <ShieldCheck size={17} className="text-navy-600" />
                <span className="text-sm font-bold text-navy-900">Identity verification</span>
                <ArrowUpRight size={14} className="ml-auto text-ink-300 transition group-hover:text-navy-600" />
              </Link>
              <Link to="/profile/security" className="group flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-2.5 transition hover:border-navy-500/40 hover:bg-navy-50">
                <KeyRound size={17} className="text-navy-600" />
                <span className="text-sm font-bold text-navy-900">Change password</span>
                <ArrowUpRight size={14} className="ml-auto text-ink-300 transition group-hover:text-navy-600" />
              </Link>
              <Link to="/health" className="group flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-2.5 transition hover:border-navy-500/40 hover:bg-navy-50">
                <Activity size={17} className="text-navy-600" />
                <span className="text-sm font-bold text-navy-900">System health</span>
                <ArrowUpRight size={14} className="ml-auto text-ink-300 transition group-hover:text-navy-600" />
              </Link>
            </div>
          </div>
        </StaggerItem>
      </StaggerGroup>
    </PageTransition>
  );
}
