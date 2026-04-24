/**
 * Cron routes — list / add / delete / run / runs, all of which shell
 * out to `openclaw cron <subcommand>`. Previously inlined as a
 * ~100-line if/else block in index.ts. Split here so index.ts's route
 * table stays scannable.
 */

import { spawnSync } from "node:child_process";

const OPENCLAW = "/usr/bin/openclaw";

type SpawnOk = { ok: true; stdout: string };
type SpawnErr = { ok: false };
type SpawnResult = SpawnOk | SpawnErr;

function runOpenclaw(args: string[], timeoutMs = 15000): SpawnResult {
  const result = spawnSync(OPENCLAW, args, {
    timeout: timeoutMs,
    encoding: "utf-8",
    env: { ...process.env, HOME: "/root" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) return { ok: false };
  return { ok: true, stdout: (result.stdout as string).trim() };
}

/** Extract a JSON array from CLI output that may contain prose before/after. */
function extractJsonArray(out: string): string {
  const jsonStart = out.indexOf("[");
  const jsonEnd = out.lastIndexOf("]");
  return (jsonStart >= 0 && jsonEnd > jsonStart)
    ? out.slice(jsonStart, jsonEnd + 1)
    : "[]";
}

export function handleCronList(): Response {
  try {
    const res = runOpenclaw(["cron", "list", "--json"]);
    const body = res.ok ? extractJsonArray(res.stdout) : "[]";
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[cron] list failed:", err);
    return Response.json([]);
  }
}

export async function handleCronAdd(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>;
    const args = ["cron", "add"];
    if (body.name) args.push("--name", String(body.name));
    if (body.cron) args.push("--cron", String(body.cron));
    if (body.at) args.push("--at", String(body.at));
    if (body.tz) args.push("--tz", String(body.tz));
    if (body.message) args.push("--message", String(body.message));
    if (body.session) args.push("--session", String(body.session));
    if (body.announce) args.push("--announce");
    const res = runOpenclaw(args);
    if (!res.ok) return Response.json({ error: "Cron add failed" }, { status: 500 });
    return Response.json({ ok: true, output: res.stdout });
  } catch (err: any) {
    console.error("[cron] add failed:", err.message);
    return Response.json({ error: "Cron add failed" }, { status: 500 });
  }
}

export function handleCronDelete(jobId: string): Response {
  try {
    const res = runOpenclaw(["cron", "delete", jobId]);
    if (!res.ok) return Response.json({ error: "Cron delete failed" }, { status: 500 });
    return Response.json({ ok: true });
  } catch (err: any) {
    console.error("[cron] delete failed:", err);
    return Response.json({ error: "Cron delete failed" }, { status: 500 });
  }
}

export function handleCronRun(jobId: string): Response {
  try {
    const res = runOpenclaw(["cron", "run", jobId], 180000);
    if (!res.ok) return Response.json({ error: "Cron run failed" }, { status: 500 });
    return Response.json({ ok: true, output: res.stdout });
  } catch (err: any) {
    console.error("[cron] run failed:", err);
    return Response.json({ error: "Cron run failed" }, { status: 500 });
  }
}

export function handleCronRuns(jobId: string): Response {
  try {
    const res = runOpenclaw(["cron", "runs", "--id", jobId, "--json"]);
    const body = res.ok ? extractJsonArray(res.stdout) : "[]";
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[cron] runs failed:", err);
    return Response.json([]);
  }
}
