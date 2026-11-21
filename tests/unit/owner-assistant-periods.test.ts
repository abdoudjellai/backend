import { describe, it, expect } from "vitest";
import {
  describePeriod,
  inPeriod,
  previousPeriod,
  resolvePeriod,
  sameElapsedSlice,
  todayDescription,
  ToolInputError,
} from "../../src/modules/owner-assistant/owner-assistant.periods.js";

// Saturday 2026-11-21, 11:00 in Algeria (UTC+1).
const NOW = new Date("2026-11-21T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("resolvePeriod presets (Africa/Algiers, UTC+1)", () => {
  it("this_month starts at local midnight on the 1st and is partial", () => {
    const p = resolvePeriod({ period: "this_month" }, NOW, "all_time");
    expect(iso(p.startMs)).toBe("2026-10-31T23:00:00.000Z");
    expect(p.endMs).toBe(NOW.getTime());
    expect(p.isPartial).toBe(true);
    expect(describePeriod(p)).toMatchObject({ label: "This month", from: "2026-11-01", to: "2026-11-21", isPartial: true });
  });

  it("last_month covers the whole previous month inclusively", () => {
    const p = resolvePeriod({ period: "last_month" }, NOW, "all_time");
    expect(iso(p.startMs)).toBe("2026-09-30T23:00:00.000Z");
    expect(iso(p.endMs)).toBe("2026-10-31T22:59:59.999Z");
    expect(p.isPartial).toBe(false);
    expect(describePeriod(p)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("this_week starts on Sunday", () => {
    expect(describePeriod(resolvePeriod({ period: "this_week" }, NOW, "all_time")).from).toBe("2026-11-15");
    expect(describePeriod(resolvePeriod({ period: "last_week" }, NOW, "all_time"))).toMatchObject({ from: "2026-11-08", to: "2026-11-14" });
  });

  it("uses the local date, not the UTC date, around midnight", () => {
    const lateUtc = new Date("2026-11-21T23:30:00.000Z"); // 00:30 on 2026-11-22 in Algiers
    expect(describePeriod(resolvePeriod({ period: "today" }, lateUtc, "all_time")).from).toBe("2026-11-22");
    expect(todayDescription(lateUtc)).toBe("Sunday 2026-11-22");
  });

  it("rolling windows include today", () => {
    expect(describePeriod(resolvePeriod({ period: "last_7_days" }, NOW, "all_time"))).toMatchObject({ from: "2026-11-15", to: "2026-11-21" });
    expect(describePeriod(resolvePeriod({ period: "last_30_days" }, NOW, "all_time")).from).toBe("2026-10-23");
  });

  it("applies the fallback when nothing is specified", () => {
    expect(resolvePeriod(undefined, NOW, "this_month").preset).toBe("this_month");
    expect(resolvePeriod({}, NOW, "all_time").preset).toBe("all_time");
    expect(describePeriod(resolvePeriod({}, NOW, "all_time")).from).toBeNull();
  });
});

describe("resolvePeriod custom ranges", () => {
  it("treats the end date as inclusive of the whole local day", () => {
    const p = resolvePeriod({ start: "2026-10-01", end: "2026-10-31" }, NOW, "all_time");
    expect(inPeriod("2026-10-31T22:30:00.000Z", p)).toBe(true); // 23:30 local on Oct 31
    expect(inPeriod("2026-10-31T23:00:00.000Z", p)).toBe(false); // 00:00 local on Nov 1
    expect(inPeriod("2026-09-30T22:59:59.999Z", p)).toBe(false);
  });

  it("accepts ISO datetimes by using their date part", () => {
    expect(describePeriod(resolvePeriod({ start: "2026-10-05T12:00:00Z" }, NOW, "all_time")).from).toBe("2026-10-05");
  });

  it("defaults the end to today and is partial", () => {
    const p = resolvePeriod({ start: "2026-11-10" }, NOW, "all_time");
    expect(p.isPartial).toBe(true);
    expect(p.endMs).toBe(NOW.getTime());
  });

  it("rejects impossible dates, reversed ranges and an end without a start", () => {
    expect(() => resolvePeriod({ start: "2026-02-31" }, NOW, "all_time")).toThrow(ToolInputError);
    expect(() => resolvePeriod({ start: "2026-11-10", end: "2026-11-01" }, NOW, "all_time")).toThrow(/before/);
    expect(() => resolvePeriod({ end: "2026-11-01" }, NOW, "all_time")).toThrow(/start/);
  });
});

describe("previousPeriod / sameElapsedSlice", () => {
  it("this_month → full last month, plus a same-elapsed slice", () => {
    const current = resolvePeriod({ period: "this_month" }, NOW, "all_time");
    const previous = previousPeriod(current);
    expect(describePeriod(previous)).toMatchObject({ from: "2026-10-01", to: "2026-10-31", isPartial: false });
    const slice = sameElapsedSlice(current, previous);
    expect(slice).not.toBeNull();
    expect(describePeriod(slice!)).toMatchObject({ from: "2026-10-01", to: "2026-10-21" });
  });

  it("last_month → the month before it", () => {
    const previous = previousPeriod(resolvePeriod({ period: "last_month" }, NOW, "all_time"));
    expect(describePeriod(previous)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("rolling and custom periods shift back by their length", () => {
    expect(describePeriod(previousPeriod(resolvePeriod({ period: "last_7_days" }, NOW, "all_time")))).toMatchObject({ from: "2026-11-08", to: "2026-11-14" });
    expect(describePeriod(previousPeriod(resolvePeriod({ start: "2026-10-11", end: "2026-10-20" }, NOW, "all_time")))).toMatchObject({ from: "2026-10-01", to: "2026-10-10" });
  });

  it("has no slice for complete periods and no previous for all_time", () => {
    const last = resolvePeriod({ period: "last_month" }, NOW, "all_time");
    expect(sameElapsedSlice(last, previousPeriod(last))).toBeNull();
    expect(() => previousPeriod(resolvePeriod({ period: "all_time" }, NOW, "all_time"))).toThrow(ToolInputError);
  });
});
