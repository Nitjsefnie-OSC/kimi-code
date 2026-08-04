import { describe, expect, it } from 'vitest';

import { FrontmatterError, parseFrontmatter } from '../../src/skill/parser';

describe('parseFrontmatter', () => {
  it('parses a leading YAML block and discards it from body', () => {
    const text = ['---', 'name: test-skill', 'description: A test skill', 'extra: 123', '---', '', '# Body', ''].join(
      '\n',
    );

    const { data, body } = parseFrontmatter(text);

    expect(data).toEqual({
      name: 'test-skill',
      description: 'A test skill',
      extra: 123,
    });
    expect(body).not.toContain('extra: 123');
    expect(body).toContain('# Body');
  });

  it('throws FrontmatterError on invalid YAML', () => {
    const text = ['---', 'name: "unterminated', 'description: oops', '---', ''].join('\n');

    expect(() => parseFrontmatter(text)).toThrow(FrontmatterError);
  });

  // A description carrying a second `": "` is not valid YAML, but it is what
  // skill authors write, because the reference implementation accepts it. A
  // strict parser drops the skill silently, which is indistinguishable from
  // the skill not being installed: on one box 23 of 28 skills vanished this way.
  it('accepts an unquoted description containing a colon', () => {
    const text = [
      '---',
      'name: kvalita-prompt-handler',
      'description: Use ONLY when a task is running. Triggers: user says "start import".',
      '---',
      '# Body',
      '',
    ].join('\n');

    const { data, body } = parseFrontmatter(text);

    expect(data).toEqual({
      name: 'kvalita-prompt-handler',
      description: 'Use ONLY when a task is running. Triggers: user says "start import".',
    });
    expect(body).toContain('# Body');
  });

  it('leaves structured frontmatter to the strict parser', () => {
    const nested = ['---', 'name: x', 'meta:', '  a: 1', '---', ''].join('\n');
    expect(parseFrontmatter(nested).data).toEqual({ name: 'x', meta: { a: 1 } });

    // Indentation means nesting, so a broken nested doc must still throw
    // rather than be flattened by the relaxed path.
    const brokenNested = ['---', 'name: x', 'meta:', '  - [unclosed', '---', ''].join('\n');
    expect(() => parseFrontmatter(brokenNested)).toThrow(FrontmatterError);
  });

  it('does not rescue a malformed quoted scalar', () => {
    const text = ['---', "name: 'unterminated", 'description: ok', '---', ''].join('\n');
    expect(() => parseFrontmatter(text)).toThrow(FrontmatterError);
  });
});
