import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  KeyRound,
  Mail,
  MapPin,
  Pencil,
  Phone,
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
import { GENDER_LABELS } from "../../services/userService";
import { formatDate, initialsOf, isUninitializedDate, titleCase } from "../../utils/format";
import { kycCopy } from "../../utils/kyc";

function DetailRow({ icon: Icon, label, value, action }) {
  return (
    <div className="flex items-start gap-3 py-3.5">
      {Icon ? (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-muted">
          <Icon size={15} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
        <dd className="mt-0.5 break-words text-[13.5px] font-semibold text-midnight">
          {value || "Not provided"}
        </dd>
      </div>
      {action}
    </div>
  );
}

export default function Profile() {
  const authUser = useSelector((state) => state.auth.user);
  const { profile, kyc, loading, profileError, refresh } = useAccount();

  const displayUser = profile || authUser;
  const fullName = [profile?.firstName, profile?.middleName, profile?.lastName]
    .filter(Boolean)
    .join(" ");
  const initials = initialsOf(displayUser?.firstName, displayUser?.lastName);
  const emailVerified = authUser?.isEmailVerified;
  const copy = kycCopy(kyc);
  const address = [
    profile?.addressLine1,
    profile?.addressLine2,
    profile?.city,
    profile?.state,
    profile?.postalCode,
    profile?.country,
  ]
    .filter(Boolean)
    .join(", ");
  const dateOfBirth = isUninitializedDate(profile?.dateOfBirth)
    ? ""
    : formatDate(profile?.dateOfBirth);

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Review the personal details linked to your Meridian account and keep them up to date."
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

      {loading && !profile ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="card space-y-4 p-6">
            <Skeleton className="h-16 w-16 rounded-2xl" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="card space-y-3 p-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : (
        <StaggerGroup className="space-y-6">
          <StaggerItem className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-5 px-5 py-6 sm:px-6">
              {displayUser?.avatarUrl ? (
                <img
                  src={displayUser.avatarUrl}
                  alt={`${fullName || "Profile"} avatar`}
                  className="h-20 w-20 rounded-2xl border border-ink-100 object-cover"
                />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-midnight text-2xl font-extrabold text-white">
                  {initials}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-extrabold tracking-tight text-midnight">
                    {fullName || "Complete your profile"}
                  </h2>
                  {emailVerified ? (
                    <span className="badge-success">
                      <BadgeCheck size={13} /> Email verified
                    </span>
                  ) : (
                    <span className="badge-warning">Email pending</span>
                  )}
                  <StatusBadge value={kyc?.status} fallback="KYC not started" />
                </div>
                <p className="mt-1 truncate text-[13.5px] text-muted">
                  {displayUser?.email || "No email on file"}
                  {profile?.username ? ` · @${profile.username}` : ""}
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {titleCase(profile?.role || authUser?.role)} account
                  {profile?.createdAt ? ` · Member since ${formatDate(profile.createdAt)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link to="/profile/edit" className="btn-primary">
                  <Pencil size={15} /> Edit profile
                </Link>
                <Link to="/profile/view" className="btn-ghost">
                  Full profile
                </Link>
              </div>
            </div>
          </StaggerItem>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <StaggerItem className="card">
              <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                <div className="flex items-center gap-2">
                  <UserRound size={16} className="text-brand-700" />
                  <h3 className="text-[14px] font-extrabold text-midnight">Personal information</h3>
                </div>
                <Link to="/profile/edit" className="text-[12px] font-bold text-brand-700">
                  Edit
                </Link>
              </div>
              <dl className="divide-y divide-ink-100 px-5">
                <DetailRow icon={UserRound} label="Full name" value={fullName} />
                <DetailRow
                  icon={Mail}
                  label="Email address"
                  value={profile?.email || authUser?.email}
                  action={
                    emailVerified ? (
                      <span className="badge-success shrink-0">Verified</span>
                    ) : (
                      <Link
                        to="/verify-email"
                        state={{ email: profile?.email || authUser?.email }}
                        className="shrink-0 text-[12px] font-bold text-brand-700"
                      >
                        Verify
                      </Link>
                    )
                  }
                />
                <DetailRow icon={Phone} label="Phone number" value={profile?.phoneNumber} />
                <DetailRow icon={CalendarDays} label="Date of birth" value={dateOfBirth} />
                <DetailRow
                  label="Gender"
                  value={GENDER_LABELS[profile?.gender] || titleCase(profile?.gender)}
                />
                <DetailRow icon={MapPin} label="Address" value={address} />
              </dl>
            </StaggerItem>

            <div className="space-y-6">
              <StaggerItem className="card">
                <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
                  <ShieldCheck size={16} className="text-brand-700" />
                  <h3 className="text-[14px] font-extrabold text-midnight">Account information</h3>
                </div>
                <dl className="divide-y divide-ink-100 px-5">
                  <DetailRow
                    label="Account type"
                    value={titleCase(profile?.role || authUser?.role)}
                  />
                  <DetailRow
                    label="Member since"
                    value={profile?.createdAt ? formatDate(profile.createdAt) : ""}
                  />
                  <DetailRow
                    label="Email status"
                    value={emailVerified ? "Verified" : "Pending verification"}
                  />
                  <DetailRow
                    label="Identity verification"
                    value={kyc ? titleCase(kyc.status) : "Not started"}
                    action={
                      <Link to="/kyc/status" className="shrink-0 text-[12px] font-bold text-brand-700">
                        Details
                      </Link>
                    }
                  />
                </dl>
              </StaggerItem>

              <StaggerItem className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                      Identity verification
                    </p>
                    <h3 className="mt-1 text-[14px] font-extrabold text-midnight">{copy.headline}</h3>
                  </div>
                  <StatusBadge value={kyc?.status} fallback="Not started" />
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{copy.description}</p>
                {kyc?.status === "REJECTED" && kyc.decisionReason ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">
                    <span className="font-bold">Reason:</span> {kyc.decisionReason}
                  </p>
                ) : null}
                <Link to={copy.nextTo} className="btn-primary mt-4 py-2.5">
                  {copy.nextLabel} <ArrowRight size={14} />
                </Link>
              </StaggerItem>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <StaggerItem className="card">
              <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-4">
                <KeyRound size={16} className="text-brand-700" />
                <h3 className="text-[14px] font-extrabold text-midnight">Security</h3>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-bold text-midnight">Password</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {profile?.passwordChangedAt
                        ? `Last changed ${formatDate(profile.passwordChangedAt)}`
                        : "Password change has not been recorded on this profile."}
                    </p>
                  </div>
                  <Link to="/profile/security" className="btn-ghost shrink-0 py-2">
                    Change
                  </Link>
                </div>
                <div className="rounded-lg bg-ink-50 px-3.5 py-3 text-[12px] leading-relaxed text-muted">
                  Access tokens are short-lived and held in memory. Changing your password
                  revokes every other refresh session.
                </div>
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700"
                >
                  Open settings <ArrowRight size={13} />
                </Link>
              </div>
            </StaggerItem>

            <StaggerItem className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h3 className="text-[14px] font-extrabold text-midnight">Data and privacy</h3>
              </div>
              <div className="space-y-3 px-5 py-4 text-[12.5px] leading-relaxed text-muted">
                <p>
                  Identity documents are encrypted at rest and only accessible to you and
                  authorised verification officers.
                </p>
                <p>
                  Your profile details are used to verify your identity and operate your wallet.
                  Internal identifiers are never shown in this interface.
                </p>
                <Link
                  to="/kyc/status"
                  className="inline-flex items-center gap-1 text-[12px] font-bold text-brand-700"
                >
                  View verification record <ArrowRight size={13} />
                </Link>
              </div>
            </StaggerItem>
          </div>
        </StaggerGroup>
      )}
    </PageTransition>
  );
}
