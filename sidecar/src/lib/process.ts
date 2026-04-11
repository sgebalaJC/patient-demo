import { execSync } from "child_process";
import { GATEWAY_URL } from "./paths.js";

/**
 * OpenClaw gateway is managed by the `openclaw` CLI as a user process under
 * /root/.openclaw — it is NOT a systemd unit on the GCE host. Shell out to
 * `openclaw gateway <cmd>` the same way skills.ts does it, with HOME=/root so
 * the CLI can find its state directory.
 */

const OPENCLAW_BIN = "/usr/bin/openclaw";
const OPENCLAW_ENV = { ...process.env, HOME: "/root" };

function runOpenclaw(command: string, timeoutMs: number): string {
  return execSync(`${OPENCLAW_BIN} ${command}`, {
    timeout: timeoutMs,
    encoding: "utf-8",
    env: OPENCLAW_ENV,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export async function getStatus(): Promise<"running" | "stopped" | "failed" | "unknown"> {
  // checkGatewayHealth() is the authoritative liveness signal used by /status.
  // We use that here instead of parsing `openclaw gateway status` which has
  // varied output across versions.
  try {
    const healthy = await checkGatewayHealth();
    return healthy ? "running" : "stopped";
  } catch {
    return "unknown";
  }
}

export async function restart(): Promise<void> {
  runOpenclaw("gateway restart", 60_000);
}

export async function stop(): Promise<void> {
  runOpenclaw("gateway stop", 30_000);
}

export async function start(): Promise<void> {
  runOpenclaw("gateway start", 30_000);
}

export async function checkGatewayHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getVersion(): Promise<string> {
  try {
    return runOpenclaw("--version", 10_000).trim();
  } catch {
    return "unknown";
  }
}
