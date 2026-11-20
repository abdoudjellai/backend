import type { BaseRecord } from "../../storage/json-collection.js";

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * A return-risk analysis of one order, produced by n8n and persisted by the backend.
 * Analyses are immutable: a new analysis of the same order is added to its history and
 * never overwrites an earlier one. The backend does not compute predictions.
 */
export interface AiAnalysis extends BaseRecord {
  storeId: string;
  orderId: string;
  /** Predicted probability (0–1) that the order is refused or returned. Not an actual outcome. */
  returnRisk: number;
  riskLevel: RiskLevel;
  recommendedCourier: string | null;
  recommendations: string[];
}
