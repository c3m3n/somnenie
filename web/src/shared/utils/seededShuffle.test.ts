import { describe, expect, it } from "vitest";
import { seededShuffle } from "./seededShuffle";

describe("seededShuffle", () => {
  it("returns a different order for different seeds", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const first = seededShuffle(items, 12345);
    const second = seededShuffle(items, 67890);
    expect(first).not.toEqual(items);
    expect(second).not.toEqual(items);
    expect(first).not.toEqual(second);
  });

  it("returns the same order for the same seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const first = seededShuffle(items, 42);
    const second = seededShuffle(items, 42);
    expect(first).toEqual(second);
  });

  it("preserves all items", () => {
    const items = ["a", "b", "c", "d", "e"];
    const shuffled = seededShuffle(items, 7);
    expect(shuffled.sort()).toEqual([...items].sort());
  });

  it("returns a new array", () => {
    const items = [1, 2, 3];
    const shuffled = seededShuffle(items, 1);
    expect(shuffled).not.toBe(items);
  });
});
