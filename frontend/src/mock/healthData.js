const health = {
  service: "user-service",
  status: "healthy",
  uptime: 864000,
  timestamp: "2026-10-16T12:00:00.000Z",
};

export async function getHealth() {
  return { ...health };
}

export { health };
