/**
 * `profile` domain — extra instruction-file config section.
 *
 * Registers the top-level config domain `extraAgentmdFiles`; the value stays
 * camelCase in memory, TOML uses the snake_case key `extra_agentmd_files`.
 *
 * Load order: the listed files are read AFTER the user-level slots
 * (`<brand home>/AGENTS.md`, then `~/.agents/AGENTS.md` / `agents.md`) and
 * BEFORE any workspace file (`<dir>/.kimi-code/AGENTS.md`, `<dir>/AGENTS.md`),
 * so project instructions still have the last word. Entries resolve exactly
 * like `extra_skill_dirs`: `~` / `~/…` against the OS home dir, absolute paths
 * as given, everything else against the project root. A listed file that does
 * not exist is a silent no-op, and the loaded content counts toward the
 * combined AGENTS.md size warning.
 */

import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const EXTRA_AGENTMD_FILES_SECTION = 'extraAgentmdFiles';
export const ExtraAgentmdFilesConfigSchema = z.array(z.string()).optional();
export type ExtraAgentmdFilesConfig = z.infer<typeof ExtraAgentmdFilesConfigSchema>;

registerConfigSection(EXTRA_AGENTMD_FILES_SECTION, ExtraAgentmdFilesConfigSchema, {
  defaultValue: [],
});
