import { checkGatewayHealth, restart } from "./process.js";

/**
 * In-process health monitor. Every 60s probe the gateway; after 5 consecutive
 * failures, restart it. A 5-min cooldown prevents restart thrashing if an
 * out-of-process watchdog (e.g. systemd timer / cron script) fires alongside.
 */

const CHECK_INTERVAL_MS = 60_000;
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 300_000;

let consecutiveFailures = 0;
let healInProgress = false;
let lastHealAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

export function startHealthMonitor(): void {
  if (timer) return;
  console.log(`[health-monitor] started (interval=${CHECK_INTERVAL_MS / 1000}s, threshold=${FAILURE_THRESHOLD})`);

  timer = setInterval(async () => {
    const healthy = await checkGatewayHealth();

    if (healthy) {
      if (consecutiveFailures > 0) {
        console.log(`[health-monitor] gateway recovered after ${consecutiveFailures} failure(s)`);
      }
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures++;
    console.warn(`[health-monitor] gateway unhealthy (${consecutiveFailures}/${FAILURE_THRESHOLD})`);

    if (consecutiveFailures < FAILURE_THRESHOLD) return;
    if (healInProgress) return;

    const now = Date.now();
    if (now - lastHealAt < COOLDOWN_MS) {
      const remainingS = Math.round((COOLDOWN_MS - (now - lastHealAt)) / 1000);
      console.warn(`[health-monitor] threshold reached but cooldown active (${remainingS}s)`);
      return;
    }

    healInProgress = true;
    lastHealAt = now;
    try {
      console.warn(`[health-monitor] threshold reached — restarting gateway`);
      await restart();
      console.log(`[health-monitor] gateway restart issued`);
    } catch (err) {
      console.error(`[health-monitor] restart failed:`, err);
    } finally {
      healInProgress = false;
      consecutiveFailures = 0;
    }
  }, CHECK_INTERVAL_MS);
}

export function stopHealthMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
