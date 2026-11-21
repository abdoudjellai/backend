import { z } from "zod";

/**
 * Reporting periods for the owner assistant, resolved in the business timezone.
 *
 * The model never does date arithmetic for common requests: it names a preset ("this_month") and
 * the backend computes the exact boundaries. Custom ranges use inclusive local calendar dates.
 */

export const BUSINESS_TIMEZONE = "Africa/Algiers";
/** Algeria is UTC+1 all year (no daylight saving time since 1981). */
const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "last_7_days",
  "last_30_days",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "all_time",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

const localDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}($|T)/, "expected a date like 2026-11-30");

/** Zod schema shared by every period-aware tool. Descriptions are sent to the model. */
export const periodSpecSchema = z.object({
  period: z
    .enum(PERIOD_PRESETS)
    .optional()
    .describe(
      "Named period, resolved in Algeria time. Weeks start on Sunday. 'last_7_days'/'last_30_days' include today. Ignored when 'start' is given.",
    ),
  start: localDateString
    .optional()
    .describe("Custom period first day, YYYY-MM-DD, inclusive (Algeria time). Use only for dates no preset covers."),
  end: localDateString.optional().describe("Custom period last day, YYYY-MM-DD, inclusive. Defaults to today."),
});
export type PeriodSpec = z.infer<typeof periodSpecSchema>;

/** Thrown for argument problems that Zod cannot express (impossible dates, start after end). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export interface ResolvedPeriod {
  preset: PeriodPreset | "custom";
  /** Inclusive UTC instant bounds used for filtering. */
  startMs: number;
  endMs: number;
  /** Length of the full period (equals the covered length unless the period is still running). */
  fullSpanMs: number;
  /** True when the period has not finished yet (e.g. this_month mid-month). */
  isPartial: boolean;
  /** Overrides the preset label for derived periods ("Previous period"). */
  label?: string;
}

/** JSON-friendly description of a period for tool results. */
export interface PeriodInfo {
  label: string;
  /** First local day (YYYY-MM-DD), or null for all_time. */
  from: string | null;
  /** Last local day (YYYY-MM-DD), inclusive. */
  to: string;
  timezone: string;
  isPartial: boolean;
}

/* ------------------------------------------------------------------ */
/* Local calendar helpers (fixed UTC+1 offset)                         */
/* ------------------------------------------------------------------ */

/** UTC instant of local midnight for a local calendar date (month is 0-based; overflow is normalized). */
function localMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - OFFSET_MS;
}

function localParts(ms: number): { year: number; month: number; day: number; weekday: number } {
  const shifted = new Date(ms + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

export function toLocalDate(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

function parseLocalDate(value: string, field: string): number {
  const date = value.slice(0, 10);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const ms = localMidnight(y, m - 1, d);
  // Reject impossible dates such as 2026-02-31 (Date.UTC would silently roll them over).
  if (toLocalDate(ms) !== date) throw new ToolInputError(`Invalid ${field} date: ${date}`);
  return ms;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

function full(preset: PeriodPreset, startMs: number, nextStartMs: number, now: number): ResolvedPeriod {
  const endOfFull = nextStartMs - 1;
  const isPartial = now < endOfFull;
  return { preset, startMs, endMs: isPartial ? now : endOfFull, fullSpanMs: nextStartMs - startMs, isPartial };
}

function resolvePreset(preset: PeriodPreset, now: number): ResolvedPeriod {
  const { year, month, day, weekday } = localParts(now);
  const today = localMidnight(year, month, day);
  switch (preset) {
    case "today":
      return full(preset, today, today + DAY_MS, now);
    case "yesterday":
      return full(preset, today - DAY_MS, today, now);
    case "this_week": {
      const start = today - weekday * DAY_MS;
      return full(preset, start, start + 7 * DAY_MS, now);
    }
    case "last_week": {
      const start = today - (weekday + 7) * DAY_MS;
      return full(preset, start, start + 7 * DAY_MS, now);
    }
    case "last_7_days":
      return { preset, startMs: today - 6 * DAY_MS, endMs: now, fullSpanMs: 7 * DAY_MS, isPartial: false };
    case "last_30_days":
      return { preset, startMs: today - 29 * DAY_MS, endMs: now, fullSpanMs: 30 * DAY_MS, isPartial: false };
    case "this_month":
      return full(preset, localMidnight(year, month, 1), localMidnight(year, month + 1, 1), now);
    case "last_month":
      return full(preset, localMidnight(year, month - 1, 1), localMidnight(year, month, 1), now);
    case "this_year":
      return full(preset, localMidnight(year, 0, 1), localMidnight(year + 1, 0, 1), now);
    case "last_year":
      return full(preset, localMidnight(year - 1, 0, 1), localMidnight(year, 0, 1), now);
    case "all_time":
      return { preset, startMs: 0, endMs: now, fullSpanMs: now, isPartial: false };
  }
}

/** Resolve a period spec. `fallback` applies when neither a preset nor a custom start is given. */
export function resolvePeriod(spec: PeriodSpec | undefined, now: Date, fallback: PeriodPreset): ResolvedPeriod {
  const nowMs = now.getTime();
  if (spec?.start === undefined) {
    if (spec?.end !== undefined) throw new ToolInputError("A custom period needs a 'start' date.");
    return resolvePreset(spec?.period ?? fallback, nowMs);
  }
  const startMs = parseLocalDate(spec.start, "start");
  const endDayMs = spec.end === undefined ? localMidnight(...ymd(nowMs)) : parseLocalDate(spec.end, "end");
  if (endDayMs < startMs) throw new ToolInputError("The period 'end' date is before its 'start' date.");
  const nextStart = endDayMs + DAY_MS;
  const isPartial = nowMs < nextStart - 1;
  return {
    preset: "custom",
    startMs,
    endMs: isPartial ? Math.max(nowMs, startMs) : nextStart - 1,
    fullSpanMs: nextStart - startMs,
    isPartial,
  };
}

function ymd(ms: number): [number, number, number] {
  const p = localParts(ms);
  return [p.year, p.month, p.day];
}

/**
 * The period immediately before `period`, of the same kind: the previous calendar month/year for
 * month/year presets, otherwise a window of the same full length ending just before it starts.
 */
export function previousPeriod(period: ResolvedPeriod): ResolvedPeriod {
  if (period.preset === "all_time") throw new ToolInputError("'all_time' has no previous period to compare with.");
  const { year, month } = localParts(period.startMs);
  let startMs: number;
  let nextStartMs = period.startMs;
  if (period.preset === "this_month" || period.preset === "last_month") {
    startMs = localMidnight(year, month - 1, 1);
  } else if (period.preset === "this_year" || period.preset === "last_year") {
    startMs = localMidnight(year - 1, 0, 1);
  } else {
    startMs = period.startMs - period.fullSpanMs;
    nextStartMs = period.startMs;
  }
  return { preset: "custom", startMs, endMs: nextStartMs - 1, fullSpanMs: nextStartMs - startMs, isPartial: false, label: "Previous period" };
}

/**
 * For a running period, the same elapsed slice of a previous period (e.g. Nov 1–21 vs Oct 1–21),
 * so partial periods can be compared fairly. Returns null when `current` is complete.
 */
export function sameElapsedSlice(current: ResolvedPeriod, previous: ResolvedPeriod): ResolvedPeriod | null {
  if (!current.isPartial) return null;
  const elapsed = current.endMs - current.startMs;
  const endMs = Math.min(previous.startMs + elapsed, previous.endMs);
  return {
    preset: "custom",
    startMs: previous.startMs,
    endMs,
    fullSpanMs: endMs - previous.startMs + 1,
    isPartial: false,
    label: "Previous period, same number of elapsed days",
  };
}

const LABELS: Record<PeriodPreset | "custom", string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  last_year: "Last year",
  all_time: "All time",
  custom: "Custom period",
};

export function describePeriod(period: ResolvedPeriod): PeriodInfo {
  return {
    label: period.label ?? LABELS[period.preset],
    from: period.preset === "all_time" ? null : toLocalDate(period.startMs),
    to: toLocalDate(period.endMs),
    timezone: BUSINESS_TIMEZONE,
    isPartial: period.isPartial,
  };
}

export function inPeriod(isoTimestamp: string, period: ResolvedPeriod): boolean {
  const time = Date.parse(isoTimestamp);
  return time >= period.startMs && time <= period.endMs;
}

/** Human-readable "today" line for the system prompt, e.g. "Saturday 2026-11-21". */
export function todayDescription(now: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: BUSINESS_TIMEZONE }).format(now);
  return `${weekday} ${toLocalDate(now.getTime())}`;
}
