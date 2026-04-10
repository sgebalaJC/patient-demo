import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { WORKSPACE } from "../lib/paths.js";

function safePath(path: string): string | null {
  if (path.includes("..")) return null;
  const resolved = resolve(WORKSPACE, path);
  if (!resolved.startsWith(WORKSPACE)) return null;
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
  const searchDir = pattern ? safePath(pattern) : WORKSPACE;
  if (!searchDir) return Response.json({ error: "Invalid pattern" }, { status: 400 });

  try {
    const result = execSync(`find ${searchDir} -type f 2>/dev/null | sort`, {
      timeout: 10000,
      encoding: "utf-8",
    });
    const files = result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replace(WORKSPACE + "/", ""));
    return Response.json({ files });
  } catch {
    return Response.json({ files: [] });
  }
}
