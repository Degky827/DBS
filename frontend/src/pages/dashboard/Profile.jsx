import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  BadgeCheck,
  Pencil,
  KeyRound,
  Loader2,
  RefreshCw,
  Globe,
  Smartphone,
} from "lucide-react";
import { getMyProfile, GENDER_LABELS } from "../../services/userService";

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const display = (v) => (v === null || v === undefined || v === "" ? "—" : v);

const SESSIONS = [
  { icon: Globe, device: "Chrome on Windows", where: "This device", when: "Active now" },
  { icon: Smartphone, device: "Meridian iOS App", where: "New York, US", when: "2 days ago" },
];

export default function Profile() {
  const navigate = useNavigate();
  const authUser = useSelector((state) => state.auth.user);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const user = await getMyProfile();
        if (active) setProfile(user);
      } catch (err) {
        if (active) setError(err.response?.data?.message || "Unable to load your profile.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const retry = async () => {
    setLoading(true);
    setError("");
    try {
      setProfile(await getMyProfile());
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load your profile.");
    } finally {
      setLoading(false);
    }
  };
  const fullName = profile
    ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
    : "";
  const initials = profile
    ? `${(profile.firstName || "")[0] || ""}${(profile.lastName || "")[0] || ""}`.toUpperCase() || "U"
    : (authUser?.firstName?.[0] || "") + (authUser?.lastName?.[0] || "") || "U";
  const verified = authUser?.isEmailVerified;

  const DETAILS = profile
    ? [
        ["Full name", fullName || "—"],
        ["Username", display(profile.username)],
        ["Email", display(profile.email)],
        ["Date of birth", formatDate(profile.dateOfBirth)],
        ["Gender", GENDER_LABELS[profile.gender] || display(profile.gender)],
        ["Phone number", display(profile.phoneNumber)],
        ["Member since", formatDate(profile.createdAt)],
      ]
    : [];

  return (
    <div className="space-y-6">
      {loading && (
        <div className="card flex items-center justify-center gap-3 px-5 py-16 text-sm font-semibold text-ink-500">
          <Loader2 size={18} className="animate-spin text-navy-600" /> Loading your profile…
        </div>
      )}

      {!loading && error && (
        <div className="card px-5 py-10 text-center">
          <p className="text-sm font-medium text-red-600">{error}</p>
          <button type="button" onClick={retry} className="btn-ghost mt-4 w-auto! px-4!">
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      )}

      {!loading && !error && profile && (
        <>
          <div className="flex flex-wrap items-center gap-5">
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
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold">{fullName || "Complete your profile"}</h1>
                {verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    <BadgeCheck size={13} /> Verified
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink-500">
                @{display(profile.username)} · {display(profile.email)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/profile/edit")}
              className="btn-ghost ml-auto"
            >
              <Pencil size={15} /> Edit profile
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[15px] font-extrabold">Personal details</h2>
              </div>
              <dl className="divide-y divide-ink-100 px-5">
                {DETAILS.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 py-3.5">
                    <dt className="text-[13px] font-medium text-ink-400">{label}</dt>
                    <dd className="text-right text-sm font-bold text-navy-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="card">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[15px] font-extrabold">Security settings</h2>
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
                    className="btn-ghost py-2! text-xs"
                  >
                    Change
                  </button>
                </div>

                <div className="px-5 py-4">
                  <p className="text-sm font-bold text-navy-900">Full profile</p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    View your complete address, bio and account details.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("/profile/view")}
                    className="link mt-1 text-[13px]!"
                  >
                    Open full profile →
                  </button>
                </div>
              </div>
            </section>

            <section className="card lg:col-span-2">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="text-[15px] font-extrabold">Active sessions</h2>
              </div>
              <ul className="divide-y divide-ink-100">
                {SESSIONS.map(({ icon: Icon, device, where, when }) => (
                  <li key={device} className="flex items-center gap-4 px-5 py-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
                      <Icon size={17} />
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-navy-900">{device}</p>
                      <p className="text-xs text-ink-400">{where}</p>
                    </div>
                    <span className="text-xs font-semibold text-ink-400">{when}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
