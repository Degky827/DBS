import { BadgeCheck, Pencil, KeyRound, ShieldCheck, Smartphone, Globe } from "lucide-react";

const PROFILE = {
  firstName: "Ada",
  middleName: "Byron",
  lastName: "Lovelace",
  username: "ada_lovelace",
  email: "ada@example.com",
  dob: "10 December 1815",
  gender: "Female",
  phone: "+1 555 123 4567",
  role: "Personal",
  memberSince: "March 2024",
  verified: true,
};

const DETAILS = [
  ["Full name", [PROFILE.firstName, PROFILE.middleName, PROFILE.lastName].filter(Boolean).join(" ")],
  ["Username", PROFILE.username],
  ["Date of birth", PROFILE.dob],
  ["Gender", PROFILE.gender],
  ["Phone number", PROFILE.phone],
  ["Member since", PROFILE.memberSince],
];

const SESSIONS = [
  { icon: Globe, device: "Chrome on Windows", where: "New York, US · This device", when: "Active now" },
  { icon: Smartphone, device: "Meridian iOS App", where: "New York, US", when: "2 days ago" },
];

export default function Profile() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-5">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy-800 text-xl font-extrabold text-white">
          AL
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold">Ada Lovelace</h1>
            {PROFILE.verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                <BadgeCheck size={13} /> Verified
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            @{PROFILE.username} · {PROFILE.email}
          </p>
        </div>
        <button type="button" className="btn-ghost ml-auto">
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
                <p className="text-xs text-ink-400">Last changed 3 months ago</p>
              </div>
              <button type="button" className="btn-ghost py-2! text-xs">Change</button>
            </div>

            <div className="flex items-center gap-4 px-5 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
                <ShieldCheck size={17} />
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold text-navy-900">Two-factor authentication</p>
                <p className="text-xs text-ink-400">OTP via email on every new device</p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" defaultChecked className="peer sr-only" />
                <span className="h-6 w-11 rounded-full bg-ink-200 transition peer-checked:bg-emerald-500" />
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
              </label>
            </div>

            <div className="px-5 py-4">
              <p className="text-sm font-bold text-navy-900">Security question</p>
              <p className="mt-0.5 text-xs text-ink-400">
                What was the name of your first school?{" "}
                <span className="font-semibold text-navy-600">· Change</span>
              </p>
            </div>
          </div>
        </section>

        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h2 className="text-[15px] font-extrabold">Active sessions</h2>
            <button type="button" className="link text-[13px]!">Sign out everywhere</button>
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
    </div>
  );
}
