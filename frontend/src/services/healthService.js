import { authApi, kycApi, userApi } from "./api";

const SERVICES = [
  { name: "auth-service", api: authApi },
  { name: "user-service", api: userApi },
  { name: "kyc-service", api: kycApi },
];

export const getServicesHealth = async () =>
  Promise.all(
    SERVICES.map(async ({ name, api }) => {
      try {
        const { data } = await api.get("/health");
        return {
          name,
          status: data.data.status,
          uptime: data.data.uptime,
          timestamp: data.data.timestamp,
          error: null,
        };
      } catch {
        return {
          name,
          status: "error",
          uptime: null,
          timestamp: null,
          error: "Health check failed. Confirm the service is running and reachable.",
        };
      }
    })
  );
