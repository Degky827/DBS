import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { BadgeCheck, KeyRound, Mail, MapPin, User, Shield } from "lucide-react";
import { getMyProfile, GENDER_LABELS } from "../../services/userService";
import { normalizeApiError } from "../../utils/apiError";
import { formatDate, displayValue, initialsOf, titleCase } from "../../utils/format";
import PageTransition, { StaggerGroup, StaggerItem } from "../../components/ui/PageTransition";
import PageHeader from "../../components/ui/PageHeader";
import { LoadingBlock } from "../../components/ui/Spinner";

export default function ViewProfile() {
  const authUser = useSelector((state) => state.auth.user);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setProfile(await getMyProfile());
    } catch (err) {
      const { message } = normalizeApiError(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = () => {
    setLoading(true);
    load();
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getMyProfile();
        if (mounted) setProfile(user);
      } catch (err) {
        if (mounted) setError(normalizeApiError(err).message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const sections = profile
    ? [
        {
          title: "Personal information",
          icon: User,
          fields: [
            { label: "First name", value: displayValue(profile.firstName) },
            { label: "Middle name", value: displayValue(profile.middleName) },
            { label: "Last name", value: displayValue(profile.lastName) },
            { label: "Gender", value: GENDER_LABELS[profile.gender] || displayValue(profile.gender) },
            { label: "Date of birth", value: formatDate(profile.dateOfBirth) },
            { label: "Bio", value: displayValue(profile.bio) },
          ],
        },
        {
          title: "Contact information",
          icon: Mail,
          fields: [
            { label: "Email", value: displayValue(profile.email) },
            { label: "Phone number", value: displayValue(profile.phoneNumber) },
          ],
        },
        {
          title: "Address",
          icon: MapPin,
          fields: [
            { label: "Address line 1", value: displayValue(profile.addressLine1) },
            { label: "Address line 2", value: displayValue(profile.addressLine2) },
            { label: "City", value: displayValue(profile.city) },
            { label: "State", value: displayValue(profile.state) },
            { label: "Postal code", value: displayValue(profile.postalCode) },
            { label: "Country", value: displayValue(profile.country) },
          ],
        },
        {
          title: "Security information",
          icon: Shield,
          fields: [
            { label: "Username", value: displayValue(profile.username) },
            { label: "Role", value: titleCase(profile.role) },
            { label: "Member since", value: formatDate(profile.createdAt) },
            {
              label: "Last password change",
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
    ? initialsOf(profile.firstName, profile.lastName)
    : initialsOf(authUser?.firstName, authUser?.lastName);
  const verified = authUser?.isEmailVerified;

  return (
    <PageTransition className="space-y-6">
      <PageHeader
        backTo="/profile"
        backLabel="Profile"
        eyebrow="Account"
        title="Full profile"
        actions={
          <>
            <Link to="/profile/edit" className="btn-ghost">
              <KeyRound size={15} /> Edit profile
            </Link>
            <Link to="/profile/security" className="btn-primary">
              Change password
            </Link>
          </>
        }
      />

      {loading && <LoadingBlock label="Loading your profile…" />}

      {!loading && error && (
        <div className="card px-5 py-10 text-center">
          <p className="text-sm font-medium text-red-600">{error}</p>
          <button type="button" onClick={refresh} className="btn-ghost mt-4">
            Try again
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
                className="h-20 w-20 rounded-2xl object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-navy-800 text-2xl font-extrabold text-white">
                {initials}
              </span>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-extrabold text-navy-900">
                  {fullName || "Complete your profile"}
                </h2>
                {verified && (
                  <span className="badge-success">
                    <BadgeCheck size={13} /> Verified
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-ink-500">@{displayValue(profile.username)}</p>
            </div>
          </StaggerItem>

          <StaggerGroup className="grid gap-6 lg:grid-cols-2">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <StaggerItem key={section.title} className="card">
                  <div className="flex items-center gap-2.5 border-b border-ink-100 px-5 py-4">
                    <Icon size={17} className="text-navy-600" />
                    <h3 className="text-[15px] font-extrabold text-navy-900">{section.title}</h3>
                  </div>
                  <dl className="divide-y divide-ink-100 px-5">
                    {section.fields.map((field) => (
                      <div key={field.label} className="flex items-baseline justify-between gap-4 py-3">
                        <dt className="shrink-0 text-[13px] font-medium text-ink-400">{field.label}</dt>
                        <dd className="break-words text-right text-sm font-semibold text-navy-900">
                          {field.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        </StaggerGroup>
      )}
    </PageTransition>
  );
}
