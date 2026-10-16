export const mockUser = {
  id: "usr_01HZX4KJ8NQWERTY",
  firstName: "Ada",
  middleName: "Byron",
  lastName: "Lovelace",
  username: "ada_lovelace",
  email: "ada@example.com",
  phoneNumber: "+1 555 123 4567",
  gender: "Female",
  dateOfBirth: "1815-12-10",
  addressLine1: "12 Analytical Engine Way",
  addressLine2: "Suite 42",
  city: "London",
  state: "Greater London",
  postalCode: "SW1A 1AA",
  country: "United Kingdom",
  bio: "Mathematician and writer, known for my work on Charles Babbage's Analytical Engine.",
  avatarUrl: null,
  role: "Personal",
  memberSince: "March 2024",
  verified: true,
  twoFactorEnabled: true,
  lastPasswordChange: "2026-07-15",
};

export const mockSessions = [
  { id: "sess_1", device: "Chrome on Windows", ip: "192.168.1.10", lastActive: "2026-10-15T12:00:00Z", current: true },
  { id: "sess_2", device: "Safari on iPhone", ip: "192.168.1.15", lastActive: "2026-10-14T08:30:00Z", current: false },
  { id: "sess_3", device: "Firefox on Linux", ip: "10.0.0.2", lastActive: "2026-10-13T16:45:00Z", current: false },
];

export const mockPhases = [
  { id: 1, name: "Project Setup", description: "Repository initialized, dependencies installed, and CI/CD pipeline configured.", status: "complete" },
  { id: 2, name: "Database Design", description: "Schema designed and migrations created for all core entities.", status: "complete" },
  { id: 3, name: "Authentication", description: "JWT-based auth with refresh tokens, email verification, and password reset.", status: "complete" },
  { id: 4, name: "User Management", description: "CRUD operations for user profiles with role-based access control.", status: "complete" },
  { id: 5, name: "Account Endpoints", description: "Bank account creation, retrieval, and balance inquiry endpoints.", status: "in_progress" },
  { id: 6, name: "Transaction Engine", description: "Core transaction processing with idempotency and audit logging.", status: "in_progress" },
  { id: 7, name: "Transfer Service", description: "Inter-account and external transfer capabilities with validation.", status: "pending" },
  { id: 8, name: "Notification System", description: "Email and in-app notifications for account events.", status: "pending" },
  { id: 9, name: "Admin Dashboard", description: "Administrative endpoints for user oversight and system health.", status: "pending" },
  { id: 10, name: "Production Deploy", description: "Final security audit, performance testing, and production rollout.", status: "pending" },
];

export const mockServiceInfo = {
  name: "User Service",
  version: "1.4.2",
  authMode: "dev",
  status: "healthy",
  uptime: "99.97%",
  lastDeployed: "2026-10-14T09:32:00Z",
};

export function getUserProfile() {
  return mockUser;
}

export function updateUserProfile(data) {
  return { ...mockUser, ...data };
}

export function changePassword() {
  return { success: true, message: "Password changed successfully" };
}