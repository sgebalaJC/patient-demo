/**
 * Platform token budget — reads `platform/config`, `platform/bonus`, and the
 * current month's `platform/usage-YYYY-MM` doc to decide whether to fall back
 * to the economy model. Records usage fire-and-forget after each chat request.
 *
 * Budget semantics:
 *   allowance = config.monthlyAllowanceTokens + bonus.tokensRemaining
 *   If usage.outputTokens >= allowance, inject X-Model-Override: {economyModel}
 *
 * Token counts are extracted from the gateway response when available; if
 * OpenClaw doesn't surface `usage`, fall back to a rough char/4 estimate so
 * monitoring still works and the fallback trips eventually.
 */

import { getDb } from "./firebase.js";
import { FieldValue } from "firebase-admin/firestore";

export const DEFAULT_ECONOMY_MODEL = "gpt-4.1-mini";
const DEFAULT_MONTHLY_ALLOWANCE = 10_000_000;

export interface BudgetState {
  /** When true, the gateway call should be forced onto the economy model. */
  overBudget: boolean;
  /** Model string to use when overBudget is true. */
  economyModel: string;
  /** Current bonus token balance (informational). */
  bonusRemaining: number;
  /** Current month's cumulative output tokens (informational). */
  usedOutput: number;
  /** Effective allowance = monthly + bonus (informational). */
  allowance: number;
}

export interface GatewayUsage {
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

// 60-second in-memory cache keyed to the singleton — chat is high-frequency
// and Firestore reads are billed per op.
let cache: { state: BudgetState; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

function currentMonthDocId(): string {
  const d = new Date();
  return `usage-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getBudgetState(): Promise<BudgetState> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.state;
  }
  try {
    const db = getDb();
    const [configSnap, bonusSnap, usageSnap] = await Promise.all([
      db.doc("platform/config").get(),
      db.doc("platform/bonus").get(),
      db.doc(`platform/${currentMonthDocId()}`).get(),
    ]);

    const config = configSnap.data() ?? {};
    const bonus = bonusSnap.data() ?? {};
    const usage = usageSnap.data() ?? {};

    const monthlyAllowance: number =
      typeof config.monthlyAllowanceTokens === "number"
        ? config.monthlyAllowanceTokens
        : DEFAULT_MONTHLY_ALLOWANCE;
    const economyModel: string =
      typeof config.economyModel === "string" && config.economyModel
        ? config.economyModel
        : DEFAULT_ECONOMY_MODEL;
    const bonusRemaining: number =
      typeof bonus.tokensRemaining === "number" ? bonus.tokensRemaining : 0;
    const usedOutput: number =
      typeof usage.outputTokens === "number" ? usage.outputTokens : 0;

    const allowance = monthlyAllowance + bonusRemaining;
    const state: BudgetState = {
      overBudget: usedOutput >= allowance,
      economyModel,
      bonusRemaining,
      usedOutput,
      allowance,
    };
    cache = { state, fetchedAt: Date.now() };
    return state;
  } catch (err) {
    // Never block chat on Firestore read failures.
    console.error("[platform-budget] getBudgetState failed:", err);
    return {
      overBudget: false,
      economyModel: DEFAULT_ECONOMY_MODEL,
      bonusRemaining: 0,
      usedOutput: 0,
      allowance: DEFAULT_MONTHLY_ALLOWANCE,
    };
  }
}

export function invalidateBudgetCache(): void {
  cache = null;
}

/**
 * Fire-and-forget: increment the current month's usage doc and, if the
 * monthly allowance is exceeded, decrement the bonus balance by the output
 * portion. Never throws — chat path must not fail on accounting errors.
 */
export function recordUsage(usage: GatewayUsage): void {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) return;

  (async () => {
    try {
      const db = getDb();
      const usageRef = db.doc(`platform/${currentMonthDocId()}`);
      await usageRef.set(
        {
          inputTokens: FieldValue.increment(inputTokens),
          outputTokens: FieldValue.increment(outputTokens),
          requestCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // If we're past the monthly allowance, also burn bonus tokens by the
      // output portion. This keeps the progress bar honest even after top-ups.
      const state = await getBudgetState();
      if (state.overBudget && state.bonusRemaining > 0 && outputTokens > 0) {
        const burn = Math.min(outputTokens, state.bonusRemaining);
        await db.doc("platform/bonus").set(
          {
            tokensRemaining: FieldValue.increment(-burn),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      // Refresh cache on the next read so the next decision reflects the
      // post-write allowance.
      invalidateBudgetCache();
    } catch (err) {
      console.error("[platform-budget] recordUsage failed:", err);
    }
  })();
}

/**
 * Best-effort token estimate when the gateway doesn't surface a `usage`
 * object. Rule of thumb: ~4 characters per token. Counts the request body
 * as input and the reply as output.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
