import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from "fs";

const SKILLS_DIR = process.env.SKILLS_DIR || "/root/skills";
const SKILLS_REGISTRY = `${SKILLS_DIR}/registry.json`;
const WORKSPACE_SKILLS = "/root/.openclaw/workspace/skills";

// Ensure workspace skills dir exists
if (!existsSync(WORKSPACE_SKILLS)) {
  mkdirSync(WORKSPACE_SKILLS, { recursive: true });
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  requiresWorkspace: boolean;
  enhancedByWorkspace: boolean;
  category: string;
  installed: boolean;
}

/** GET /skills — list all available skills with install status */
export function handleListSkills(): Response {
  try {
    const registry = JSON.parse(readFileSync(SKILLS_REGISTRY, "utf-8")) as SkillInfo[];

    const skills = registry.map(skill => ({
      ...skill,
      installed: existsSync(`${WORKSPACE_SKILLS}/${skill.id}/SKILL.md`),
    }));

    return Response.json({ skills });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** POST /skills/:id/install — install a skill to the workspace */
export function handleInstallSkill(id: string): Response {
  const sourcePath = `${SKILLS_DIR}/${id}`;
  const destPath = `${WORKSPACE_SKILLS}/${id}`;

  if (!existsSync(`${sourcePath}/SKILL.md`)) {
    return Response.json({ error: `Skill '${id}' not found in registry` }, { status: 404 });
  }

  try {
    mkdirSync(destPath, { recursive: true });
    cpSync(sourcePath, destPath, { recursive: true });
    console.log(`[skills] Installed: ${id}`);
    return Response.json({ ok: true, id, installed: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** POST /skills/:id/uninstall — remove a skill from the workspace */
export function handleUninstallSkill(id: string): Response {
  const destPath = `${WORKSPACE_SKILLS}/${id}`;

  if (!existsSync(destPath)) {
    return Response.json({ error: `Skill '${id}' is not installed` }, { status: 404 });
  }

  try {
    rmSync(destPath, { recursive: true });
    console.log(`[skills] Uninstalled: ${id}`);
    return Response.json({ ok: true, id, installed: false });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
