/**
 * WhoamiTool — report the model the agent is currently running as.
 *
 * Lets the model answer "what model are you?" by actively querying its own
 * identity, instead of guessing from training data. It reads the resolved
 * model alias from the live agent config and the human-facing display name
 * from that model's catalog entry — the same `displayName ?? model` the
 * harness banner shows — so the model reports exactly what the harness does.
 *
 * Read-only: no mutation, no approval required.
 */

import type { Agent } from '#/agent';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './whoami.md?raw';

export const WhoamiInputSchema = z.object({}).strict();
export type WhoamiInput = z.infer<typeof WhoamiInputSchema>;

export class WhoamiTool implements BuiltinTool<WhoamiInput> {
  readonly name = 'Whoami' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WhoamiInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(_args: WhoamiInput): ToolExecution {
    return {
      description: 'Report the current model',
      approvalRule: this.name,
      execute: async (): Promise<ExecutableToolResult> => this.report(),
    };
  }

  private report(): ExecutableToolResult {
    const alias = this.agent.config.modelAlias;
    if (alias === undefined) {
      return { isError: false, output: 'No model is currently configured.' };
    }
    // Same source the model catalog / harness banner uses: the alias's catalog
    // entry, with display_name falling back to the upstream model name.
    const entry = this.agent.kimiConfig?.models?.[alias];
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
