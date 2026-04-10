import { getStatus, restart, checkGatewayHealth, getVersion } from "../lib/process.js";

/** GET /status — process state + gateway health */
export async function handleStatus(): Promise<Response> {
  const [processStatus, healthy, version] = await Promise.all([
    getStatus(),
    checkGatewayHealth(),
    getVersion(),
  ]);
  return Response.json({ processStatus, healthy, version });
}

/** POST /restart — restart the OpenClaw gateway service */
export async function handleRestart(): Promise<Response> {
  try {
    await restart();

    // Wait for gateway to become healthy (up to 30s)
    let healthy = false;
    for (let i = 0; i < 6; i++) {
      await Bun.sleep(5000);
      healthy = await checkGatewayHealth();
      if (healthy) break;
    }

    return Response.json({ ok: true, healthy });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
