import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  FileCheck2,
  FileText,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import Alert from "../../components/ui/Alert";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Spinner";
import { useAccount } from "../../context/AccountContext";
import { formatDate, titleCase } from "../../utils/format";
import {
  KYC_STEPS,
  currentKycStep,
  documentTypeLabel,
  kycCopy,
} from "../../utils/kyc";

const REQUIREMENTS = [
  {
    icon: UserRound,
    title: "Your legal name and date of birth",
    text: "These come from your profile and must match the identity document exactly.",
  },
  {
    icon: FileText,
    title: "A government-issued photo ID",
    text: "Passport, national ID, driver's licence or residence permit. JPG, PNG or WebP up to 10 MB.",
  },
  {
    icon: ScanFace,
    title: "A face and liveness check",
    text: "A short secure session with our verification provider confirms the document belongs to you.",
  },
];

export default function KycOverview() {
  const { profile, kyc, loading, kycUnavailable, refresh } = useAccount();
  const copy = kycCopy(kyc);
  const documents = kyc?.documents || [];
  const activeStep = currentKycStep(kyc, documents.length);
  const rejected = kyc?.status === "REJECTED";

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        eyebrow="Identity verification"
        title="Identity verification"
        description="Verify your identity once to unlock transfers and payments. Your documents are encrypted and reviewed only by authorised officers."
        actions={
          <button type="button" className="btn-ghost" onClick={() => refresh()} disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      />

      {kycUnavailable ? (
        <Alert tone="warning">
          We could not reach the verification service. Refresh to try again.
        </Alert>
      ) : null}

      {loading && !kyc ? (
        <div className="card space-y-4 p-6">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !kyc ? (
        <StaggerGroup className="space-y-6">
          <StaggerItem className="relative overflow-hidden rounded-2xl bg-midnight px-6 py-8 text-white sm:px-8">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-200">
                <ShieldCheck size={13} /> Required for payments
              </span>
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                Verify your identity to unlock your account
              </h2>
              <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/65">
                Meridian is required to confirm who you are before money can move. The check
                takes a few minutes and only needs a profile that is up to date and a valid
                photo ID.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  to="/kyc/verify"
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-bold text-midnight transition hover:bg-brand-50"
                >
                  Start verification <ArrowRight size={15} />
                </Link>
                <Link
                  to="/profile/edit"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/85 transition hover:bg-white/10"
                >
                  Review profile first
                </Link>
              </div>
              <p className="mt-4 text-[11px] text-white/45">
                Current status: not started. Nothing has been submitted yet.
              </p>
            </div>
          </StaggerItem>

          <div className="grid gap-6 lg:grid-cols-2">
            <StaggerItem className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h3 className="text-[14px] font-extrabold text-midnight">What you will need</h3>
              </div>
              <ul className="divide-y divide-ink-100 px-5">
                {REQUIREMENTS.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex items-start gap-3 py-4">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Icon size={16} />
                    </span>
                    <div>
                      <p className="text-[13px] font-bold text-midnight">{title}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </StaggerItem>

            <StaggerItem className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h3 className="text-[14px] font-extrabold text-midnight">How it works</h3>
              </div>
              <ol className="space-y-4 px-5 py-4">
                {KYC_STEPS.map((step, index) => (
                  <li key={step.id} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-midnight text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-[13px] font-bold text-midnight">{step.label}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </StaggerItem>
          </div>
        </StaggerGroup>
      ) : (
        <StaggerGroup className="space-y-6">
          <StaggerItem className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                    kyc.status === "APPROVED"
                      ? "bg-[#ecfdf3] text-success"
                      : rejected
                        ? "bg-[#fef2f2] text-danger"
                        : "bg-brand-50 text-brand-700"
                  }`}
                >
                  {kyc.status === "APPROVED" ? <BadgeCheck size={20} /> : <ShieldCheck size={20} />}
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                    Current status
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold tracking-tight text-midnight">
                    {copy.headline}
                  </h2>
                  <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
                    {copy.description}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge value={kyc.status} />
                <p className="text-[11px] text-muted">
                  Application created {formatDate(kyc.createdAt)}
                </p>
              </div>
            </div>

            {rejected && kyc.decisionReason ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] leading-relaxed text-red-700">
                <span className="font-bold">Decision reason:</span> {kyc.decisionReason}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-4">
              <Link to={copy.nextTo} className="btn-primary">
                {copy.nextLabel} <ArrowRight size={15} />
              </Link>
              <Link to="/kyc/status" className="btn-ghost">
                Status timeline
              </Link>
            </div>
          </StaggerItem>

          <StaggerItem className="card p-5 sm:p-6">
            <h3 className="text-[14px] font-extrabold text-midnight">Verification progress</h3>
            <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {KYC_STEPS.map((step, index) => {
                const done = index < activeStep || kyc.status === "APPROVED";
                const current = index === activeStep && kyc.status !== "APPROVED";
                const attention =
                  current && (rejected || kyc.status === "NEEDS_RESUBMISSION");
                return (
                  <li
                    key={step.id}
                    className={`rounded-xl border p-3.5 ${
                      attention
                        ? "border-[#fde68a] bg-[#fffbeb]"
                        : current
                          ? "border-brand-600/30 bg-brand-50"
                          : done
                            ? "border-ink-200 bg-white"
                            : "border-ink-200 bg-ink-50/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                          done
                            ? "bg-[#ecfdf3] text-success"
                            : attention
                              ? "bg-[#fffbeb] text-warning"
                              : current
                                ? "bg-brand-600 text-white"
                                : "bg-ink-200 text-muted"
                        }`}
                      >
                        {done ? <Check size={13} /> : index + 1}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                        {done ? "Done" : attention ? "Action needed" : current ? "Current" : "Next"}
                      </span>
                    </div>
                    <p className="mt-2 text-[12.5px] font-bold text-midnight">{step.label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{step.description}</p>
                  </li>
                );
              })}
            </ol>
          </StaggerItem>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <StaggerItem className="card">
              <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                <h3 className="text-[14px] font-extrabold text-midnight">Automated checks</h3>
                <Link to="/kyc/status" className="text-[12px] font-bold text-brand-700">
                  Details
                </Link>
              </div>
              <dl className="divide-y divide-ink-100 px-5">
                {[
                  ["Provider check", kyc.providerStatus, "Not started"],
                  ["Document verification", kyc.documentVerificationStatus, "Pending"],
                  ["Profile comparison", kyc.dataComparisonStatus, "Pending"],
                  ["Face match", kyc.faceMatchStatus, "Pending"],
                  ["Liveness", kyc.livenessStatus, "Pending"],
                ].map(([label, value, fallback]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-3">
                    <dt className="text-[12.5px] text-muted">{label}</dt>
                    <dd>
                      <StatusBadge value={value} fallback={fallback} />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-ink-100 px-5 py-3 text-[11px] leading-relaxed text-muted">
                Automated results never decide your application on their own. A verification
                officer records the final decision.
              </div>
            </StaggerItem>

            <div className="space-y-6">
              <StaggerItem className="card">
                <div className="border-b border-ink-100 px-5 py-4">
                  <h3 className="text-[14px] font-extrabold text-midnight">Documents on file</h3>
                </div>
                {documents.length === 0 ? (
                  <div className="px-5 py-6">
                    <div className="flex items-center gap-2 text-[13px] font-bold text-midnight">
                      <FileCheck2 size={16} className="text-muted" /> No document uploaded yet
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">
                      Add a photo ID in the verification steps. Accepted formats are JPG, PNG
                      and WebP up to 10 MB.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-100 px-5">
                    {documents.map((document) => (
                      <li key={document.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-bold text-midnight">
                            {documentTypeLabel(document.documentType)}
                            {document.side ? ` · ${titleCase(document.side)}` : ""}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted">
                            Added {formatDate(document.createdAt)}
                          </p>
                        </div>
                        <StatusBadge value={document.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </StaggerItem>

              <StaggerItem className="rounded-xl border border-ink-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <Clock3 size={15} className="text-brand-700" />
                  <h3 className="text-[13px] font-extrabold text-midnight">What happens next</h3>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  {kyc.status === "APPROVED"
                    ? "Nothing further is needed. Your approval is recorded by the verification service."
                    : kyc.status === "PENDING_REVIEW"
                      ? "Wait for an officer decision. Most reviews are completed without further action from you."
                      : kyc.status === "REJECTED"
                        ? "No further changes can be made to this application. Review the decision reason before starting again."
                        : "Complete the remaining steps. You can close this page and return later; your draft is saved."}
                </p>
                {profile?.firstName ? null : (
                  <p className="mt-2 text-[12px] font-semibold text-warning">
                    Your profile is missing a legal name. Add it before continuing.
                  </p>
                )}
              </StaggerItem>
            </div>
          </div>
        </StaggerGroup>
      )}
    </PageTransition>
  );
}
