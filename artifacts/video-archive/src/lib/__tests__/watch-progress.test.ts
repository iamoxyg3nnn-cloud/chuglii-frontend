import { describe, expect, it } from "vitest";
import { mergeWatchProgress } from "../watch-progress";

describe("mergeWatchProgress", () => {
  it("adds the current session to cumulative watch time", () => {
    expect(mergeWatchProgress(
      { progress: 20, total_watch_ms: 120_000 },
      30_000,
      600_000,
    )).toEqual({ progress: 25, totalWatchMs: 150_000 });
  });

  it("never reduces previously saved progress when a new session starts", () => {
    expect(mergeWatchProgress(
      { progress: 72, total_watch_ms: 90_000 },
      15_000,
      600_000,
    )).toEqual({ progress: 72, totalWatchMs: 105_000 });
  });

  it("clamps progress to the valid 0–100 range", () => {
    expect(mergeWatchProgress(
      { progress: 140, total_watch_ms: 900_000 },
      900_000,
      600_000,
    )).toEqual({ progress: 100, totalWatchMs: 1_800_000 });
  });

  it("ignores invalid or negative stored values", () => {
    expect(mergeWatchProgress(
      { progress: -10, total_watch_ms: -500 },
      -100,
      0,
    )).toEqual({ progress: 0, totalWatchMs: 0 });
  });

  it("keeps prior progress when duration is unavailable", () => {
    expect(mergeWatchProgress(
      { progress: 38, total_watch_ms: 200_000 },
      20_000,
      0,
    )).toEqual({ progress: 38, totalWatchMs: 220_000 });
  });
});
