/**
 * `tools` domain (L7) — `WhoamiTool` implementation (the `Whoami` tool).
 *
 * Lets the model answer "what model are you?" by actively querying its own
 * identity, instead of guessing from training data. It reads the resolved
 * model alias from the bound profile (`IAgentProfileService.data().modelAlias`)
 * and the human-facing display name from that alias's `models` config entry —
 * the same `displayName ?? model` the harness banner shows — so the model
 * reports exactly what the harness does.
 *
 * Read-only: no mutation, no approval required.
 *
 * Registered via the module-level `registerAgentToolService(IWhoamiTool,
 * WhoamiTool)` at the bottom of this file — the same "import = register"
 * pattern used by every agent tool. Bound at Agent scope.
 */

import { toInputJsonSchema } from '#/tool/input-schema';
import { type ExecutableToolResult, type ToolExecution } from '#/tool/toolContract';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';

import { IAgentProfileService } from '#/agent/profile/profile';
import { IConfigService } from '#/app/config/config';
import { MODELS_SECTION } from '#/app/kosongConfig/configSection';
import type { ModelsSection } from '#/kosong/model/model';

import { IWhoamiTool, WhoamiInputSchema, type WhoamiInput } from './whoami';
import WHOAMI_DESCRIPTION from './whoami.md?raw';


export class WhoamiTool implements IWhoamiTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Whoami' as const;
  readonly description = WHOAMI_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WhoamiInputSchema);

  constructor(
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IConfigService private readonly config: IConfigService,
  ) {}

  resolveExecution(_args: WhoamiInput): ToolExecution {
    return {
      description: 'Report the current model',
      approvalRule: this.name,
      execute: async (): Promise<ExecutableToolResult> => this.report(),
    };
  }

  private report(): ExecutableToolResult {
    const alias = this.profile.data().modelAlias;
    if (alias === undefined) {
      return { isError: false, output: 'No model is currently configured.' };
    }
    // Same source the model catalog / harness banner uses: the alias's config
    // entry, with display_name falling back to the upstream model name.
    const entry = this.config.get<ModelsSection | undefined>(MODELS_SECTION)?.[alias];
    const displayName = entry?.displayName ?? entry?.model ?? alias;

    const lines = [`model: ${displayName}`, `model_id: ${alias}`];
    if (entry?.model !== undefined && entry.model !== displayName) {
      lines.push(`upstream_model: ${entry.model}`);
    }
    if (entry?.provider !== undefined) {
      lines.push(`provider: ${entry.provider}`);
    }
    return { isError: false, output: lines.join('\n') };
  }
}

registerAgentToolService(IWhoamiTool, WhoamiTool, { name: 'Whoami', domain: 'profile' });
