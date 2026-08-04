/**
 * `_base` text helpers — Markdown frontmatter parsing.
 *
 * Splits a Markdown document into its YAML frontmatter block and body. Pure
 * text processing with no IO and no domain knowledge. A document without a
 * leading `---` fence parses as all body with `data: null`; an unterminated
 * fence is a `FrontmatterError`.
 */

import { load as loadYaml } from 'js-yaml';

export class FrontmatterError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'FrontmatterError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause, configurable: true });
    }
  }
}

export interface ParsedFrontmatter {
  readonly data: unknown;
  readonly body: string;
}

const FENCE = '---';

export function parseFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) {
    return { data: null, body: text };
  }

  const close = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE);
  if (close === -1) {
    throw new FrontmatterError('Missing closing frontmatter fence');
  }

  const yamlText = lines.slice(1, close).join('\n').trim();
  const body = lines.slice(close + 1).join('\n');
  if (yamlText === '') {
    return { data: {}, body };
  }

  try {
    return { data: loadYaml(yamlText) ?? {}, body };
  } catch (error) {
    const relaxed = parseRelaxedFlatFrontmatter(yamlText);
    if (relaxed !== undefined) return { data: relaxed, body };
    const message = error instanceof Error ? error.message : String(error);
    throw new FrontmatterError(message, error);
  }
}

/**
 * Rescue the one invalid-YAML shape the skill ecosystem produces constantly:
 * a flat `key: value` block whose value is an unquoted sentence containing
 * `": "` — e.g. `description: Use when X. Triggers: user says ...`, which
 * js-yaml rejects as "bad indentation of a mapping entry". Authors write it
 * because the reference implementation accepts it, and a strict parser then
 * drops the skill silently, indistinguishable from it never being installed.
 *
 * Mirrors `parseRelaxedFlatFrontmatter` in agent-core's `skill/parser.ts`.
 * Deliberately narrow: only after strict parsing has failed, and only when
 * EVERY line is a simple top-level `key: value` pair. Anything nested, quoted
 * but unterminated, or carrying YAML syntax defers to the original error.
 */
function parseRelaxedFlatFrontmatter(yamlText: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const raw of yamlText.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    if (raw !== raw.trimStart()) return undefined;
    const match = /^([A-Za-z0-9_][A-Za-z0-9_-]*):[ \t]+(\S.*)$/.exec(raw);
    if (match === null) return undefined;
    const [, key, value] = match;
    if (key === undefined || value === undefined) return undefined;
    const first = value[0];
    if (first !== undefined && '|>&*!%@`[{#'.includes(first)) return undefined;
    if (Object.hasOwn(out, key)) return undefined;
    if (first === '"' || first === "'") {
      if (value.length < 2 || !value.endsWith(first)) return undefined;
      out[key] = value.slice(1, -1);
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
