// Roles come from the auth-service JWT `role` claim (also mirrored on the
// user-service profile). The backend enforces these server-side; the frontend
// only uses them to show or hide navigation and routes.
export const ADMIN_ROLES = ["ADMIN"];
export const OFFICER_ROLES = ["ADMIN", "OFFICER", "VERIFICATION_OFFICER"];
export const FINANCE_ROLES = ["ADMIN", "FINANCIAL_OFFICER"];
export const STAFF_ROLES = [
  "ADMIN",
  "OFFICER",
  "VERIFICATION_OFFICER",
  "FINANCIAL_OFFICER",
];

export const isAdmin = (user) => ADMIN_ROLES.includes(user?.role);
export const isOfficer = (user) => OFFICER_ROLES.includes(user?.role);
export const isFinance = (user) => FINANCE_ROLES.includes(user?.role);
export const isStaff = (user) => STAFF_ROLES.includes(user?.role);

// Staff land on the dashboard that matches their primary responsibility.
export const homePathForRole = (role) => {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "FINANCIAL_OFFICER") return "/finance/dashboard";
  if (OFFICER_ROLES.includes(role)) return "/officer/dashboard";
  return "/dashboard";
};

export const roleLabel = (role) =>
  (role || "USER")
    .toString()
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
