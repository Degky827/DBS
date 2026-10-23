import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Pencil,
  KeyRound,
  Mail,
  MapPin,
  User,
  Shield,
  BadgeCheck,
  Loader2,
  RefreshCw,
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

const display = (value) => (value === null || value === undefined || value === "" ? "—" : value);

export default function ViewProfile() {
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

  const sections = profile
    ? [
        {
          title: "Personal Information",
          icon: User,
          fields: [
            { label: "First Name", value: display(profile.firstName) },
            { label: "Middle Name", value: display(profile.middleName) },
            { label: "Last Name", value: display(profile.lastName) },
            { label: "Gender", value: GENDER_LABELS[profile.gender] || display(profile.gender) },
            { label: "Date of Birth", value: formatDate(profile.dateOfBirth) },
            { label: "Bio", value: display(profile.bio) },
          ],
        },
        {
          title: "Contact Information",
          icon: Mail,
          fields: [
            { label: "Email", value: display(profile.email) },
            { label: "Phone Number", value: display(profile.phoneNumber) },
          ],
        },
        {
          title: "Address",
          icon: MapPin,
          fields: [
            { label: "Address Line 1", value: display(profile.addressLine1) },
            { label: "Address Line 2", value: display(profile.addressLine2) },
            { label: "City", value: display(profile.city) },
            { label: "State", value: display(profile.state) },
            { label: "Postal Code", value: display(profile.postalCode) },
            { label: "Country", value: display(profile.country) },
          ],
        },
        {
          title: "Security Information",
          icon: Shield,
          fields: [
            { label: "Username", value: display(profile.username) },
            { label: "Role", value: display(profile.role) },
            { label: "Member Since", value: formatDate(profile.createdAt) },
            {
              label: "Last Password Change",
              value: profile.passwordChangedAt ? formatDate(profile.passwordChangedAt) : "Never",
            },
          ],
        },
      ]
    : [];

  const fullName = profile
    ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
    : "";
  const initials = profile
    ? `${(profile.firstName || "")[0] || ""}${(profile.lastName || "")[0] || ""}`.toUpperCase() || "U"
    : "U";
  const verified = authUser?.isEmailVerified;

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
                  className="h-20 w-20 rounded-2xl object-cover shadow-[0_8px_24px_-12px_rgba(5,13,26,.7)]"
                />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-navy-800 text-2xl font-extrabold text-white shadow-[0_8px_24px_-12px_rgba(5,13,26,.7)]">
                  {initials}
                </span>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-extrabold text-navy-900">
                    {fullName || "Complete your profile"}
                  </h1>
                  {verified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                      <BadgeCheck size={13} /> Verified
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-ink-500">@{display(profile.username)}</p>
              </div>
              <div className="flex gap-3">
                <Link to="/profile/edit" className="btn-ghost">
                  <Pencil size={15} /> Edit Profile
                </Link>
                <Link to="/profile/security" className="btn-primary w-auto! px-4!">
                  <KeyRound size={15} /> Change Password
                </Link>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <section key={section.title} className="card">
                    <div className="flex items-center gap-2.5 border-b border-ink-100 px-5 py-4">
                      <Icon size={17} className="text-navy-600" />
                      <h2 className="text-[15px] font-extrabold text-navy-900">{section.title}</h2>
                    </div>
                    <dl className="divide-y divide-ink-100 px-5">
                      {section.fields.map((field) => (
                        <div
                          key={field.label}
                          className="flex items-baseline justify-between gap-4 py-3"
                        >
                          <dt className="shrink-0 text-[13px] font-medium text-ink-400">
                            {field.label}
                          </dt>
                          <dd className="text-right text-sm font-semibold text-navy-900">
                            {field.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}
            </div>
          </>
        )}
    </div>
  );
}
