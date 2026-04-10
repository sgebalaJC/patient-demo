import { readFileSync, writeFileSync } from "fs";
import { CONFIG_PATH } from "../lib/paths.js";

/** GET /config — read openclaw.json */
export function readConfig(): Response {
  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    return Response.json(JSON.parse(content));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** PATCH /config — merge-patch openclaw.json */
export async function patchConfig(request: Request): Promise<Response> {
  const patch = await request.json();
  if (!patch || typeof patch !== "object") {
    return Response.json({ error: "JSON object required" }, { status: 400 });
  }

  try {
    const current = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const merged = deepMerge(current, patch as Record<string, unknown>);
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (srcVal && typeof srcVal === "object" && !Array.isArray(srcVal) && tgtVal && typeof tgtVal === "object" && !Array.isArray(tgtVal)) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
