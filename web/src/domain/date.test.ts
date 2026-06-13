import { describe, expect, it } from "vitest";
import { addDaysISO, dateFromISO, toISODate } from "./date";

describe("date helpers", () => {
  it("round-trips an ISO date without timezone drift", () => {
    expect(toISODate(dateFromISO("2026-06-14"))).toBe("2026-06-14");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysISO("2026-06-14", 1)).toBe("2026-06-15");
    expect(addDaysISO("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-06-14", -1)).toBe("2026-06-13");
  });

  it("rejects malformed dates", () => {
    expect(() => dateFromISO("not-a-date")).toThrow();
    expect(() => dateFromISO("")).toThrow();
  });
});
