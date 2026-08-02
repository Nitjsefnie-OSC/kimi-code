import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAgentsMd, prepareSystemPromptContext } from '../../src/profile/context';
import { testKaos } from '../fixtures/test-kaos';

let homeDir: string;
let workDir: string;
let extraDirs: string[];

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'kimi-agents-home-'));
  workDir = await mkdtemp(join(tmpdir(), 'kimi-agents-work-'));
  extraDirs = [];
  vi.spyOn(testKaos, 'gethome').mockReturnValue(homeDir);
  vi.spyOn(testKaos, 'getcwd').mockReturnValue(workDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(homeDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
  await Promise.all(extraDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loadAgentsMd user-level discovery', () => {
  it('loads user-level branded and generic files before project-level', async () => {
    await mkdir(join(homeDir, '.kimi-code'), { recursive: true });
    await writeFile(join(homeDir, '.kimi-code', 'AGENTS.md'), 'user branded', 'utf-8');
    await mkdir(join(homeDir, '.agents'), { recursive: true });
    await writeFile(join(homeDir, '.agents', 'AGENTS.md'), 'user generic', 'utf-8');
    await writeFile(join(workDir, 'AGENTS.md'), 'project instructions', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result).toContain('user branded');
    expect(result).toContain('user generic');
    expect(result).toContain('project instructions');
    expect(result.indexOf('user branded')).toBeLessThan(result.indexOf('user generic'));
    expect(result.indexOf('user generic')).toBeLessThan(result.indexOf('project instructions'));
  });

  it('loads generic user-level .agents/AGENTS.md', async () => {
    await mkdir(join(homeDir, '.agents'), { recursive: true });
    await writeFile(join(homeDir, '.agents', 'AGENTS.md'), 'dot-agents generic', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result).toContain('dot-agents generic');
  });

  it('falls back to project-level only when no user-level files exist', async () => {
    await writeFile(join(workDir, 'AGENTS.md'), 'project only', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result).toContain('project only');
    expect(result).not.toContain(homeDir);
  });

  it('does not load the same file twice when the work dir is the home dir', async () => {
    vi.spyOn(testKaos, 'getcwd').mockReturnValue(homeDir);
    await mkdir(join(homeDir, '.kimi-code'), { recursive: true });
    await writeFile(join(homeDir, '.kimi-code', 'AGENTS.md'), 'home branded', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result.split('home branded').length - 1).toBe(1);
  });
});

describe('loadAgentsMd brand home (KIMI_CODE_HOME)', () => {
  let brandHome: string;

  beforeEach(async () => {
    brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-brand-'));
  });

  afterEach(async () => {
    await rm(brandHome, { recursive: true, force: true });
  });

  it('loads the branded AGENTS.md from the brand home and generic from the real home', async () => {
    await writeFile(join(brandHome, 'AGENTS.md'), 'brand home instructions', 'utf-8');
    await mkdir(join(homeDir, '.agents'), { recursive: true });
    await writeFile(join(homeDir, '.agents', 'AGENTS.md'), 'real home generic', 'utf-8');

    const result = await loadAgentsMd(testKaos, brandHome);

    expect(result).toContain('brand home instructions');
    expect(result).toContain('real home generic');
  });

  it('ignores the real-home .kimi-code/AGENTS.md when the brand home is elsewhere', async () => {
    await writeFile(join(brandHome, 'AGENTS.md'), 'brand wins', 'utf-8');
    await mkdir(join(homeDir, '.kimi-code'), { recursive: true });
    await writeFile(join(homeDir, '.kimi-code', 'AGENTS.md'), 'stale real-home brand', 'utf-8');

    const result = await loadAgentsMd(testKaos, brandHome);

    expect(result).toContain('brand wins');
    expect(result).not.toContain('stale real-home brand');
  });

  it('falls back to the real-home .kimi-code/AGENTS.md when no brand home is given', async () => {
    await mkdir(join(homeDir, '.kimi-code'), { recursive: true });
    await writeFile(join(homeDir, '.kimi-code', 'AGENTS.md'), 'fallback branded', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result).toContain('fallback branded');
  });
});

describe('loadAgentsMd oversized content', () => {
  it('keeps the full content when AGENTS.md exceeds the recommended size', async () => {
    const largeContent = 'x'.repeat(40 * 1024);
    await writeFile(join(workDir, 'AGENTS.md'), largeContent, 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result).toContain(largeContent);
    expect(result).not.toContain('truncated or omitted');
  });
});

describe('prepareSystemPromptContext AGENTS.md size warning', () => {
  it('returns agentsMdWarning and keeps full content when oversized', async () => {
    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-brand-'));
    extraDirs.push(brandHome);
    const largeContent = 'x'.repeat(40 * 1024);
    await writeFile(join(workDir, 'AGENTS.md'), largeContent, 'utf-8');

    const result = await prepareSystemPromptContext(testKaos, brandHome);

    expect(result.agentsMd).toContain(largeContent);
    expect(result.agentsMdWarning).toBeDefined();
    expect(result.agentsMdWarning).toContain('exceeds the recommended');
  });

  it('does not return agentsMdWarning when within the recommended size', async () => {
    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-brand-'));
    extraDirs.push(brandHome);
    await writeFile(join(workDir, 'AGENTS.md'), 'small instructions', 'utf-8');

    const result = await prepareSystemPromptContext(testKaos, brandHome);

    expect(result.agentsMdWarning).toBeUndefined();
  });
});

describe('loadAgentsMd rules directories', () => {
  it('loads user-level and project-level rules after AGENTS.md, in lexicographic order', async () => {
    await writeFile(join(workDir, 'AGENTS.md'), 'project instructions', 'utf-8');

    const userRules = join(homeDir, '.kimi-code', 'rules');
    await mkdir(userRules, { recursive: true });
    // Written in reverse order on purpose: the reader must sort, not rely on
    // whatever order the filesystem hands back.
    await writeFile(join(userRules, 'zz-user.md'), 'user rule zz', 'utf-8');
    await writeFile(join(userRules, 'aa-user.md'), 'user rule aa', 'utf-8');

    const projectRules = join(workDir, '.kimi-code', 'rules');
    await mkdir(projectRules, { recursive: true });
    await writeFile(join(projectRules, 'zz-project.md'), 'project rule zz', 'utf-8');
    await writeFile(join(projectRules, 'aa-project.md'), 'project rule aa', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    const order = [
      'project instructions',
      'user rule aa',
      'user rule zz',
      'project rule aa',
      'project rule zz',
    ].map((needle) => {
      const index = result.indexOf(needle);
      expect(index, needle).toBeGreaterThanOrEqual(0);
      return index;
    });
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  it('annotates each rules file with its source path', async () => {
    const userRules = join(homeDir, '.kimi-code', 'rules');
    await mkdir(userRules, { recursive: true });
    await writeFile(join(userRules, 'doctrine.md'), 'annotated rule', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result).toContain(`<!-- From: ${join(userRules, 'doctrine.md')} -->`);
    expect(result).toContain('annotated rule');
  });

  it('ignores non-markdown files and nested directories inside a rules directory', async () => {
    const userRules = join(homeDir, '.kimi-code', 'rules');
    await mkdir(join(userRules, 'nested.md'), { recursive: true });
    await writeFile(join(userRules, 'notes.txt'), 'not a rule', 'utf-8');
    await writeFile(join(userRules, 'real.md'), 'real rule', 'utf-8');

    const result = await loadAgentsMd(testKaos);

    expect(result).toContain('real rule');
    expect(result).not.toContain('not a rule');
  });

  it('is a silent no-op when no rules directory exists', async () => {
    await writeFile(join(workDir, 'AGENTS.md'), 'project only', 'utf-8');

    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-brand-'));
    extraDirs.push(brandHome);
    const result = await prepareSystemPromptContext(testKaos, brandHome);

    expect(result.agentsMd).toContain('project only');
    expect(result.agentsMdWarning).toBeUndefined();
  });

  it('loads rules from the brand home when one is given', async () => {
    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-brand-'));
    extraDirs.push(brandHome);
    await mkdir(join(brandHome, 'rules'), { recursive: true });
    await writeFile(join(brandHome, 'rules', 'brand.md'), 'brand home rule', 'utf-8');
    await mkdir(join(homeDir, '.kimi-code', 'rules'), { recursive: true });
    await writeFile(join(homeDir, '.kimi-code', 'rules', 'stale.md'), 'stale rule', 'utf-8');

    const result = await loadAgentsMd(testKaos, brandHome);

    expect(result).toContain('brand home rule');
    expect(result).not.toContain('stale rule');
  });
});

describe('prepareSystemPromptContext rules size accounting', () => {
  it('counts rules bytes toward the instruction-size warning', async () => {
    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-brand-'));
    extraDirs.push(brandHome);
    await writeFile(join(workDir, 'AGENTS.md'), 'small instructions', 'utf-8');
    await mkdir(join(brandHome, 'rules'), { recursive: true });
    await writeFile(join(brandHome, 'rules', 'huge.md'), 'x'.repeat(40 * 1024), 'utf-8');

    const result = await prepareSystemPromptContext(testKaos, brandHome);

    expect(result.agentsMd).toContain('x'.repeat(40 * 1024));
    expect(result.agentsMdWarning).toBeDefined();
    expect(result.agentsMdWarning).toContain('exceeds the recommended');
  });
});

describe('prepareSystemPromptContext additional directories', () => {
  it('includes additional directory listings without loading their AGENTS.md', async () => {
    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-empty-brand-'));
    extraDirs.push(brandHome);
    const extraDir = await mkdtemp(join(tmpdir(), 'kimi-agents-extra-'));
    extraDirs.push(extraDir);

    await writeFile(join(workDir, 'AGENTS.md'), 'repo project instructions', 'utf-8');
    await writeFile(join(extraDir, 'AGENTS.md'), 'extra project instructions', 'utf-8');
    await writeFile(join(extraDir, 'extra-file.txt'), 'extra listing entry', 'utf-8');

    const result = await prepareSystemPromptContext(testKaos, brandHome, {
      additionalDirs: [extraDir],
    });

    const agentsMd = result.agentsMd ?? '';

    expect(result.cwdListing).toBeTypeOf('string');
    expect(result.additionalDirsInfo).toContain(`### ${extraDir}`);
    expect(result.additionalDirsInfo).toContain('extra-file.txt');
    expect(agentsMd).toContain('repo project instructions');
    expect(agentsMd).not.toContain('extra project instructions');
    expect(agentsMd.split('<!-- From:').length - 1).toBe(1);
  });

  it('loads user-level AGENTS.md once and skips additional directory AGENTS.md', async () => {
    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-empty-brand-'));
    extraDirs.push(brandHome);
    const extraDirA = await mkdtemp(join(tmpdir(), 'kimi-agents-extra-a-'));
    const extraDirB = await mkdtemp(join(tmpdir(), 'kimi-agents-extra-b-'));
    extraDirs.push(extraDirA, extraDirB);

    await mkdir(join(homeDir, '.agents'), { recursive: true });
    await writeFile(join(homeDir, '.agents', 'AGENTS.md'), 'shared user instructions', 'utf-8');
    await writeFile(join(extraDirA, 'AGENTS.md'), 'extra A instructions', 'utf-8');
    await writeFile(join(extraDirB, 'AGENTS.md'), 'extra B instructions', 'utf-8');

    const result = await prepareSystemPromptContext(testKaos, brandHome, {
      additionalDirs: [extraDirA, extraDirB],
    });

    const agentsMd = result.agentsMd ?? '';

    expect(result.additionalDirsInfo).toContain(`### ${extraDirA}`);
    expect(result.additionalDirsInfo).toContain(`### ${extraDirB}`);
    expect(agentsMd.split('shared user instructions').length - 1).toBe(1);
    expect(agentsMd).not.toContain('extra A instructions');
    expect(agentsMd).not.toContain('extra B instructions');
  });
});

describe('loadAgentsMd extra_agentmd_files', () => {
  it('loads a configured absolute file', async () => {
    const extraFile = join(workDir, 'bundle-rules.md');
    await writeFile(extraFile, 'bundle rules', 'utf-8');

    const result = await loadAgentsMd(testKaos, undefined, { extraAgentmdFiles: [extraFile] });

    expect(result).toContain('bundle rules');
  });

  it('resolves ~ against the OS home dir', async () => {
    await mkdir(join(homeDir, '.kimi-code'), { recursive: true });
    await writeFile(join(homeDir, '.kimi-code', 'bundle-rules.md'), 'tilde rules', 'utf-8');

    const result = await loadAgentsMd(testKaos, undefined, {
      extraAgentmdFiles: ['~/.kimi-code/bundle-rules.md'],
    });

    expect(result).toContain('tilde rules');
  });

  it('resolves a relative path against the project root', async () => {
    await mkdir(join(workDir, 'docs'), { recursive: true });
    await writeFile(join(workDir, 'docs', 'rules.md'), 'relative rules', 'utf-8');

    const result = await loadAgentsMd(testKaos, undefined, {
      extraAgentmdFiles: ['docs/rules.md'],
    });

    expect(result).toContain('relative rules');
  });

  it('treats a listed file that does not exist as a silent no-op', async () => {
    await writeFile(join(workDir, 'AGENTS.md'), 'project instructions', 'utf-8');

    const result = await loadAgentsMd(testKaos, undefined, {
      extraAgentmdFiles: [join(workDir, 'nope.md'), '~/also-missing.md'],
    });

    expect(result).toContain('project instructions');
    expect(result).not.toContain('nope.md');
  });

  it('loads after the user-level slots and before workspace files', async () => {
    await mkdir(join(homeDir, '.kimi-code'), { recursive: true });
    await writeFile(join(homeDir, '.kimi-code', 'AGENTS.md'), 'user branded', 'utf-8');
    await mkdir(join(homeDir, '.agents'), { recursive: true });
    await writeFile(join(homeDir, '.agents', 'AGENTS.md'), 'user generic', 'utf-8');
    await writeFile(join(workDir, 'AGENTS.md'), 'project instructions', 'utf-8');
    const extraFile = join(workDir, 'bundle-rules.md');
    await writeFile(extraFile, 'configured extra', 'utf-8');

    const result = await loadAgentsMd(testKaos, undefined, { extraAgentmdFiles: [extraFile] });

    expect(result.indexOf('user branded')).toBeLessThan(result.indexOf('configured extra'));
    expect(result.indexOf('user generic')).toBeLessThan(result.indexOf('configured extra'));
    expect(result.indexOf('configured extra')).toBeLessThan(
      result.indexOf('project instructions'),
    );
  });

  it('does not load the same file twice when it is also a built-in slot', async () => {
    await mkdir(join(homeDir, '.kimi-code'), { recursive: true });
    const slot = join(homeDir, '.kimi-code', 'AGENTS.md');
    await writeFile(slot, 'shared instructions', 'utf-8');

    const result = await loadAgentsMd(testKaos, undefined, { extraAgentmdFiles: [slot] });

    expect(result.split('shared instructions').length - 1).toBe(1);
  });

  it('counts extra files toward the combined size warning', async () => {
    const brandHome = await mkdtemp(join(tmpdir(), 'kimi-agents-brand-'));
    extraDirs.push(brandHome);
    const largeContent = 'x'.repeat(40 * 1024);
    const extraFile = join(workDir, 'huge-rules.md');
    await writeFile(extraFile, largeContent, 'utf-8');

    const withExtra = await prepareSystemPromptContext(testKaos, brandHome, {
      extraAgentmdFiles: [extraFile],
    });
    const withoutExtra = await prepareSystemPromptContext(testKaos, brandHome);

    expect(withExtra.agentsMd).toContain(largeContent);
    expect(withExtra.agentsMdWarning).toContain('exceeds the recommended');
    expect(withoutExtra.agentsMdWarning).toBeUndefined();
  });
});
