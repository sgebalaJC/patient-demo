import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const WORKSPACE_SKILLS = "/root/.openclaw/workspace/skills";

if (!existsSync(WORKSPACE_SKILLS)) {
  mkdirSync(WORKSPACE_SKILLS, { recursive: true });
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

/**
 * Parse the YAML frontmatter of a SKILL.md to pull `name` and `description`.
 * Hand-rolled — frontmatter is tiny + flat, not worth a yaml dep.
 */
function readFrontmatter(path: string): { name?: string; description?: string } {
  try {
    const content = readFileSync(path, "utf-8");
    if (!content.startsWith("---")) return {};
    const end = content.indexOf("\n---", 3);
    if (end === -1) return {};
    const block = content.slice(3, end);
    const out: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * GET /skills — list installed skills.
 *
 * Skills are deployed to disk by `sidecar/deploy.sh`, not registered through
 * the UI. This endpoint enumerates `/root/.openclaw/workspace/skills/` and
 * reads each SKILL.md's frontmatter (name + description). No registry file,
 * no shell-out — robust against the compiled-binary `find` quirks that broke
 * the previous `/files`-based listing.
 */
export function handleListSkills(): Response {
  if (!existsSync(WORKSPACE_SKILLS)) {
    return Response.json({ skills: [] });
  }
  try {
    const skills: SkillInfo[] = [];
    for (const entry of readdirSync(WORKSPACE_SKILLS)) {
      const dir = join(WORKSPACE_SKILLS, entry);
      const skillFile = join(dir, "SKILL.md");
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(skillFile)) continue;
      const fm = readFrontmatter(skillFile);
      skills.push({
        id: entry,
        name: fm.name || entry,
        description: fm.description || "",
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ skills });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /skills/:id — return the full SKILL.md body for one installed skill. */
export function handleReadSkill(id: string): Response {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return Response.json({ error: "Invalid skill id" }, { status: 400 });
  }
  const path = join(WORKSPACE_SKILLS, id, "SKILL.md");
  if (!existsSync(path)) {
    return Response.json({ error: "Skill not found" }, { status: 404 });
  }
  try {
    return Response.json({ id, content: readFileSync(path, "utf-8") });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
