import { storage } from "../../storage/index.js";

export interface HealthReport {
  status: "ok" | "unavailable";
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    storage: "ok" | "unavailable";
  };
}

export async function getHealthReport(): Promise<HealthReport> {
  const storageOk = await storage.isHealthy();
  return {
    status: storageOk ? "ok" : "unavailable",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: { storage: storageOk ? "ok" : "unavailable" },
  };
}
