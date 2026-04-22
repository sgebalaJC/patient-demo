/**
 * Tests for sim/index.ts — isSimulationOn() flag + TTL cache.
 *
 * The cache is module-scoped (10s TTL) with no reset hook. We verify
 * behavior across three scenarios in a controlled order:
 *   1. `true` path first (store seeded) — populates cache with `true`.
 *   2. Flip the store to `false` — cache still wins, so result stays `true`.
 *   3. (Also covered) doc missing → false — verified via a fresh re-import
 *      with a cache-busted query suffix (Bun's module registry treats
 *      query suffixes as distinct modules).
 */
import { describe, test, expect } from "bun:test";
import { installFakeFirebase, resetStore, seedDoc } from "./_helpers.js";

installFakeFirebase();

const { isSimulationOn } = await import("../index.js");

describe("isSimulationOn", () => {
  test("returns true when system/settings.simulationMode is true", async () => {
    resetStore();
    seedDoc("system/settings", { simulationMode: true });
    expect(await isSimulationOn()).toBe(true);
  });

  test("cached value wins within TTL even if underlying state flips", async () => {
    // The previous test cached `true`. Flip to false underneath.
    resetStore();
    seedDoc("system/settings", { simulationMode: false });
    // Cache from previous test should still apply, so result stays true.
    expect(await isSimulationOn()).toBe(true);
  });

  test("returns false when doc is missing (fresh module)", async () => {
    resetStore();
    // Fresh import bypasses the cache from earlier tests.
    // @ts-ignore — Bun accepts query-suffixed specifiers at runtime.
    const fresh = await import("../index.js?fresh=missing");
    expect(await fresh.isSimulationOn()).toBe(false);
  });

  test("returns false when simulationMode is explicitly false (fresh module)", async () => {
    resetStore();
    seedDoc("system/settings", { simulationMode: false });
    // @ts-ignore — Bun accepts query-suffixed specifiers at runtime.
    const fresh = await import("../index.js?fresh=false");
    expect(await fresh.isSimulationOn()).toBe(false);
  });
});
