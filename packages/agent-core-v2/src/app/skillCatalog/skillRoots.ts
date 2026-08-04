/**
 * `skillCatalog` domain — skill-root resolution primitives.
 *
 * Resolves the ordered `SkillRoot` list a discovery backend should scan for the
 * user (home) and project (workspace) skill locations. Brand directories are
 * preferred over generic ones (`.kimi-code/skills` before `.agents/skills`),
 * and the project root is found by walking up to `.git`. Pure path/fs probes;
 * no scoped state.
 */

import { promises as fs } from 'node:fs';
import path from 'pathe';

import type { SkillRoot, SkillSource } from './types';

const USER_BRAND_DIRS = ['skills'] as const;
const USER_GENERIC_DIRS = ['.agents/skills'] as const;
const PROJECT_BRAND_DIRS = ['.kimi-code/skills'] as const;
const PROJECT_GENERIC_DIRS = ['.agents/skills'] as const;

/**
 * `DEBUG_SKILL_ROOTS=1` traces every skill-root decision to stderr.
 *
 * Skill discovery is a chain of silent no-ops by design: a configured dir that
 * does not resolve where you think, or resolves somewhere that is not a
 * directory, is dropped without a word, so "my skills are not loaded" carries
 * no information about WHICH link failed. This prints the input, the resolved
 * path, and the accept/reject verdict at each link, which is the difference
 * between reading the code and knowing what it did.
 */
const DEBUG = Boolean(process.env['DEBUG_SKILL_ROOTS']);

function trace(event: string, fields: Record<string, unknown>): void {
  if (!DEBUG) return;
  const rendered = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  process.stderr.write(`[skill-roots] ${event} ${rendered}\n`);
}

export interface SkillRootsOptions {
  readonly mergeAllAvailableSkills?: boolean;
}

export async function userRoots(
  homeDir: string,
  osHomeDir: string,
  options: SkillRootsOptions = {},
): Promise<readonly SkillRoot[]> {
  const roots: SkillRoot[] = [];
  const mergeAllAvailableSkills = options.mergeAllAvailableSkills ?? true;
  await pushBrandGroup(roots, USER_BRAND_DIRS, homeDir, 'user', mergeAllAvailableSkills);
  await pushFirstExisting(roots, USER_GENERIC_DIRS, osHomeDir, 'user');
  return roots;
}

export async function projectRoots(
  workDir: string,
  options: SkillRootsOptions = {},
): Promise<readonly SkillRoot[]> {
  const projectRoot = await findProjectRoot(workDir);
  const roots: SkillRoot[] = [];
  const mergeAllAvailableSkills = options.mergeAllAvailableSkills ?? true;
  await pushBrandGroup(roots, PROJECT_BRAND_DIRS, projectRoot, 'project', mergeAllAvailableSkills);
  await pushFirstExisting(roots, PROJECT_GENERIC_DIRS, projectRoot, 'project');
  return roots;
}

export interface ProjectSkillRootCandidates {
  readonly projectRoot: string;
  readonly candidates: readonly string[];
}

export async function projectSkillRootCandidates(
  workDir: string,
): Promise<ProjectSkillRootCandidates> {
  const projectRoot = await findProjectRoot(workDir);
  return {
    projectRoot,
    candidates: [...PROJECT_BRAND_DIRS, ...PROJECT_GENERIC_DIRS].map((dir) =>
      path.join(projectRoot, dir),
    ),
  };
}

export async function configuredRoots(
  dirs: readonly string[],
  workDir: string,
  osHomeDir: string,
  source: SkillSource,
): Promise<readonly SkillRoot[]> {
  const projectRoot = await findProjectRoot(workDir);
  trace('configuredRoots.enter', {
    dirs, workDir, projectRoot, osHomeDir, source, count: dirs.length,
  });
  const roots: SkillRoot[] = [];
  for (const dir of dirs) {
    const resolved = resolveConfiguredDir(dir, projectRoot, osHomeDir);
    const accepted = await pushExistingRoot(roots, resolved, source);
    trace('configuredRoots.entry', { dir, resolved, accepted });
  }
  trace('configuredRoots.exit', { accepted: roots.map((r) => r.path) });
  return roots;
}

async function findProjectRoot(workDir: string): Promise<string> {
  const start = path.resolve(workDir);
  let current = start;
  while (true) {
    if (await exists(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

async function pushFirstExisting(
  out: SkillRoot[],
  dirs: readonly string[],
  base: string,
  source: SkillSource,
): Promise<void> {
  for (const dir of dirs) {
    if (await pushExistingRoot(out, path.join(base, dir), source)) return;
  }
}

async function pushBrandGroup(
  out: SkillRoot[],
  dirs: readonly string[],
  base: string,
  source: SkillSource,
  mergeAllAvailableSkills: boolean,
): Promise<void> {
  if (!mergeAllAvailableSkills) {
    await pushFirstExisting(out, dirs, base, source);
    return;
  }
  for (const dir of dirs) {
    await pushExistingRoot(out, path.join(base, dir), source);
  }
}

async function pushExistingRoot(
  out: SkillRoot[],
  dir: string,
  source: SkillSource,
): Promise<boolean> {
  if (!(await isDir(dir))) {
    trace('reject.notADirectory', { dir, source });
    return false;
  }
  const resolved = await realpath(dir);
  const duplicate = out.some((root) => root.path === resolved);
  trace(duplicate ? 'reject.duplicate' : 'accept', { dir, resolved, source });
  if (!duplicate) out.push({ path: resolved, source });
  return true;
}

function resolveConfiguredDir(dir: string, projectRoot: string, osHomeDir: string): string {
  if (dir === '~') return osHomeDir;
  if (dir.startsWith('~/')) return path.join(osHomeDir, dir.slice(2));
  if (path.isAbsolute(dir)) return dir;
  return path.resolve(projectRoot, dir);
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function realpath(p: string): Promise<string> {
  return (await fs.realpath(p)).replaceAll('\\', '/');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
