import { getDatabaseStatus, type DatabaseStatus } from "../../config/database.js";

export interface HealthReport {
  status: "ok" | "unavailable";
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: DatabaseStatus;
  };
}

export function getHealthReport(): HealthReport {
  const database = getDatabaseStatus();
  return {
    status: database === "connected" ? "ok" : "unavailable",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database },
  };
}
