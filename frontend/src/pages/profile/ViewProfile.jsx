import { Link } from "react-router-dom";
import {
  Pencil,
  KeyRound,
  Mail,
  MapPin,
  User,
  Shield,
  BadgeCheck,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import { mockUser } from "../../mock/userService";

const SECTIONS = [
  {
    title: "Personal Information",
    icon: User,
    fields: [
      { label: "First Name", value: mockUser.firstName },
      { label: "Middle Name", value: mockUser.middleName },
      { label: "Last Name", value: mockUser.lastName },
      { label: "Gender", value: mockUser.gender },
      { label: "Date of Birth", value: new Date(mockUser.dateOfBirth).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) },
      { label: "Bio", value: mockUser.bio },
    ],
  },
  {
    title: "Contact Information",
    icon: Mail,
    fields: [
      { label: "Email", value: mockUser.email },
      { label: "Phone Number", value: mockUser.phoneNumber },
    ],
  },
  {
    title: "Address",
    icon: MapPin,
    fields: [
      { label: "Address Line 1", value: mockUser.addressLine1 },
      { label: "Address Line 2", value: mockUser.addressLine2 },
      { label: "City", value: mockUser.city },
      { label: "State", value: mockUser.state },
      { label: "Postal Code", value: mockUser.postalCode },
      { label: "Country", value: mockUser.country },
    ],
  },
  {
    title: "Security Information",
    icon: Shield,
    fields: [
      { label: "Username", value: mockUser.username },
      { label: "Role", value: mockUser.role },
      { label: "Member Since", value: mockUser.memberSince },
      { label: "Two-Factor Auth", value: mockUser.twoFactorEnabled ? "Enabled" : "Disabled" },
      { label: "Last Password Change", value: new Date(mockUser.lastPasswordChange).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) },
    ],
  },
];

export default function ViewProfile() {
  const fullName = `${mockUser.firstName} ${mockUser.middleName} ${mockUser.lastName}`;
  const initials = `${mockUser.firstName[0]}${mockUser.lastName[0]}`.toUpperCase();

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-5">
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-navy-800 text-2xl font-extrabold text-white shadow-[0_8px_24px_-12px_rgba(5,13,26,.7)]">
            {initials}
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold text-navy-900">{fullName}</h1>
              {mockUser.verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                  <BadgeCheck size={13} /> Verified
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-ink-500">@{mockUser.username}</p>
          </div>
          <div className="flex gap-3">
            <Link to="/profile/edit" className="btn-ghost">
              <Pencil size={15} /> Edit Profile
            </Link>
            <Link to="/profile/change-password" className="btn-primary w-auto! px-4!">
              <KeyRound size={15} /> Change Password
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <section key={section.title} className="card">
                <div className="flex items-center gap-2.5 border-b border-ink-100 px-5 py-4">
                  <Icon size={17} className="text-navy-600" />
                  <h2 className="text-[15px] font-extrabold text-navy-900">{section.title}</h2>
                </div>
                <dl className="divide-y divide-ink-100 px-5">
                  {section.fields.map((field) => (
                    <div key={field.label} className="flex items-baseline justify-between gap-4 py-3">
                      <dt className="shrink-0 text-[13px] font-medium text-ink-400">{field.label}</dt>
                      <dd className="text-right text-sm font-semibold text-navy-900">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </div>
    </MainLayout>
  );
}
