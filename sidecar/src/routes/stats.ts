import { $ } from "bun";
import { checkGatewayHealth, getVersion } from "../lib/process.js";

/** GET /stats — system memory, CPU, uptime, disk, OpenClaw version */
export async function handleStats(): Promise<Response> {
  const [memResult, uptimeResult, diskResult, healthy, version] = await Promise.allSettled([
    $`free -m | awk '/^Mem:/ {print $2,$3}'`.text(),
    $`cat /proc/uptime | awk '{print int($1)}'`.text(),
    $`df -BG / | awk 'NR==2 {print $2,$3}'`.text(),
    checkGatewayHealth(),
    getVersion(),
  ]);

  const memParts = (memResult.status === "fulfilled" ? memResult.value : "0 0").trim().split(" ");
  const uptime = uptimeResult.status === "fulfilled" ? parseInt(uptimeResult.value.trim()) || 0 : 0;
  const diskParts = (diskResult.status === "fulfilled" ? diskResult.value : "0G 0G").trim().split(" ");

  return Response.json({
    memoryTotalMb: parseInt(memParts[0]) || 0,
    memoryUsedMb: parseInt(memParts[1]) || 0,
    uptimeSeconds: uptime,
    diskTotalGb: parseInt(diskParts[0]) || 0,
    diskUsedGb: parseInt(diskParts[1]) || 0,
    gatewayHealthy: healthy.status === "fulfilled" ? healthy.value : false,
    version: version.status === "fulfilled" ? version.value : "unknown",
  });
}
