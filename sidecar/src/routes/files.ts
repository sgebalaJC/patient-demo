import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { spawnSync } from "child_process";
import { WORKSPACE } from "../lib/paths.js";

// Whitelist to keep shell metacharacters (`;`, backticks, `$()`, `|`, `&`,
// newlines, spaces) out of any path we pass to a child process or resolve
// against WORKSPACE. Tightened: segments must be non-empty, cannot start
// with `.`, and cannot contain `..`. Consecutive slashes and leading
// slashes are rejected too — the workspace path is relative.
//
// Empty path is allowed only for the list-all case, which is handled
// before this regex is consulted.
const SAFE_PATH = /^[A-Za-z0-9_\-][A-Za-z0-9._\-]*(?:\/[A-Za-z0-9_\-][A-Za-z0-9._\-]*)*$/;

function safePath(path: string): string | null {
  if (!path) return null;
  if (!SAFE_PATH.test(path)) return null;
  if (path.includes("..")) return null;
  const resolved = resolve(WORKSPACE, path);
  if (!resolved.startsWith(WORKSPACE + "/") && resolved !== WORKSPACE) return null;
  return resolved;
}

/** GET /files/:path — read a workspace file */
export function readFile(path: string): Response {
  const fullPath = safePath(path);
  if (!fullPath) return Response.json({ error: "Invalid path" }, { status: 400 });
  if (!existsSync(fullPath)) return Response.json({ error: "File not found" }, { status: 404 });

  try {
    const content = readFileSync(fullPath, "utf-8");
    return Response.json({ path, content });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** PUT /files/:path — write a workspace file */
export async function writeFileTo(path: string, request: Request): Promise<Response> {
  const fullPath = safePath(path);
  if (!fullPath) return Response.json({ error: "Invalid path" }, { status: 400 });

  const body = (await request.json()) as { content: string };
  if (typeof body.content !== "string") {
    return Response.json({ error: "content string required" }, { status: 400 });
  }

  try {
    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, body.content, "utf-8");
    return Response.json({ ok: true, path });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE /files/:path — delete a workspace file or directory */
export function deleteFilePath(path: string): Response {
  const fullPath = safePath(path);
  if (!fullPath) return Response.json({ error: "Invalid path" }, { status: 400 });

  try {
    if (existsSync(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /files?pattern=... — list workspace files */
export function listFiles(pattern: string): Response {
  // Empty pattern means "list everything under WORKSPACE"; validated paths
  // are resolved through safePath(). Reject anything else.
  const searchDir = pattern ? safePath(pattern) : WORKSPACE;
  if (!searchDir) return Response.json({ error: "Invalid pattern" }, { status: 400 });

  // Pass args as argv (shell:false) so metacharacters in `searchDir` are never
  // interpreted. The path-resolve + whitelist above already rules them out,
  // but this is defence in depth — no shell, no injection surface.
  const result = spawnSync("find", [searchDir, "-type", "f"], {
    timeout: 10000,
    encoding: "utf-8",
  });
  if (result.status !== 0 || !result.stdout) {
    return Response.json({ files: [] });
  }
  const files = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(WORKSPACE + "/", ""))
    .sort();
  return Response.json({ files });
}
