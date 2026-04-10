import { $ } from "bun";
import { GATEWAY_URL } from "./paths.js";

const SERVICE_NAME = "openclaw-gateway";

export async function getStatus(): Promise<"running" | "stopped" | "failed" | "unknown"> {
  try {
    const result = await $`systemctl is-active ${SERVICE_NAME}`.text();
    const status = result.trim();
    if (status === "active") return "running";
    if (status === "inactive") return "stopped";
    if (status === "failed") return "failed";
    return "unknown";
  } catch {
    // systemctl returns non-zero for inactive/failed
    try {
      const result = await $`systemctl is-active ${SERVICE_NAME} 2>/dev/null || true`.text();
      const status = result.trim();
      if (status === "inactive") return "stopped";
      if (status === "failed") return "failed";
    } catch { /* ignore */ }
    return "unknown";
  }
}

export async function restart(): Promise<void> {
  await $`systemctl restart ${SERVICE_NAME}`.quiet();
}

export async function stop(): Promise<void> {
  await $`systemctl stop ${SERVICE_NAME}`.quiet();
}

export async function start(): Promise<void> {
  await $`systemctl start ${SERVICE_NAME}`.quiet();
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
    const result = await $`openclaw --version`.text();
    return result.trim();
  } catch {
    return "unknown";
  }
}
