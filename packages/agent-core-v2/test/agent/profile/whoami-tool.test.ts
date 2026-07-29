/**
 * Covers: WhoamiTool.
 */

import { describe, expect, it } from 'vitest';

import type { IConfigService } from '#/app/config/config';
import type { IAgentProfileService } from '#/agent/profile/profile';
import { WhoamiTool } from '#/agent/tools/state/whoami/whoamiTool';
import { WhoamiTool as V1WhoamiTool } from '../../../../agent-core/src/tools/builtin/state/whoami';
import { executeTool } from '../../tools/fixtures/execute-tool';

const signal = new AbortController().signal;

interface FakeModelEntry {
  readonly displayName?: string;
  readonly model?: string;
  readonly provider?: string;
}

function fakeProfile(modelAlias: string | undefined): IAgentProfileService {
  return {
    data: () => ({ modelAlias }),
  } as unknown as IAgentProfileService;
}

function fakeConfig(models: Record<string, FakeModelEntry> | undefined): IConfigService {
  return {
    get: (section: string) => (section === 'models' ? models : undefined),
  } as unknown as IConfigService;
}

function report(
  modelAlias: string | undefined,
  models: Record<string, FakeModelEntry> | undefined,
): Promise<{ readonly isError?: boolean; readonly output: unknown }> {
  const tool = new WhoamiTool(fakeProfile(modelAlias), fakeConfig(models));
  return executeTool(tool, { turnId: 0, toolCallId: 'call-1', args: {}, signal });
}

interface ModelFacingToolContract {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

function expectModelFacingParity(
  actual: ModelFacingToolContract,
  expected: ModelFacingToolContract,
): void {
  expect(actual.name).toBe(expected.name);
  expect(actual.description).toBe(expected.description);
  expect(JSON.stringify(actual.parameters)).toBe(JSON.stringify(expected.parameters));
}

describe('WhoamiTool', () => {
  it('reports that no model is configured when the profile has no model alias', async () => {
    const result = await report(undefined, undefined);

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('No model is currently configured.');
  });

  it('reports display name, id, upstream model, and provider from the models config', async () => {
    const result = await report('fixture-model', {
      'fixture-model': {
        displayName: 'Kimi For Coding',
        model: 'kimi-for-coding',
        provider: 'fixture-provider',
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe(
      'model: Kimi For Coding\n' +
        'model_id: fixture-model\n' +
        'upstream_model: kimi-for-coding\n' +
        'provider: fixture-provider',
    );
  });

  it('falls back to the upstream model name when the entry has no display name', async () => {
    const result = await report('fixture-model', {
      'fixture-model': { model: 'kimi-for-coding' },
    });

    expect(result.isError).toBeFalsy();
    // model === displayName, so no upstream_model line; no provider configured.
    expect(result.output).toBe('model: kimi-for-coding\nmodel_id: fixture-model');
  });

  it('falls back to the alias when the model has no config entry', async () => {
    const result = await report('fixture-model', {});

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('model: fixture-model\nmodel_id: fixture-model');
  });

  it('matches the v1 model-facing contract exactly', () => {
    expectModelFacingParity(
      new WhoamiTool(fakeProfile(undefined), fakeConfig(undefined)),
      new V1WhoamiTool({} as never),
    );
  });
});
