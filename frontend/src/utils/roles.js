// Roles come from the auth-service JWT `role` claim (also mirrored on the
// user-service profile). The backend enforces these server-side; the frontend
// only uses them to show or hide navigation and routes.
export const OFFICER_ROLES = ["ADMIN", "OFFICER", "VERIFICATION_OFFICER"];

export const isOfficer = (user) => OFFICER_ROLES.includes(user?.role);

export const roleLabel = (role) =>
  (role || "USER")
    .toString()
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
